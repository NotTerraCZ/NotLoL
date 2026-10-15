using System.Diagnostics;
using System.Text.Json.Nodes;

namespace NotLoL;

/// <summary>
/// Deadlock (Valve): pozná se podle procesu deadlock.exe (starší verze hry project8.exe; hledá se jednou za 5 s).
/// Rozhraní (deadlock.js) pošle pořadí nákupu pro hrdinu, za kterého hraješ („Hraju za…“; bez něj pro všechny
/// hrdiny) – overlay ho ukazuje, dokud hra běží. Po stisku B (obchod) ve hře se chvíli čte obrazovka a nad itemy
/// z pořadí se ukážou čísla kroků; čte se jen tehdy, ať to během hraní nebere výkon.
/// </summary>
public sealed partial class MainForm
{
    static readonly string[] DeadlockProcesses = ["deadlock", "project8"];
    const int VK_B = 0x42, VK_ESCAPE = 0x1B;

    int deadlockPid;
    long deadlockCheckedAt;
    JsonNode? dlBuild;
    bool overlayIsDeadlock; // overlay právě ukazuje build z Deadlocku

    readonly ShopScanner shopScanner = new();
    readonly System.Windows.Forms.Timer shopTimer = new() { Interval = 700 };
    readonly List<ShopStepForm> shopLabels = [];
    // Pořadí nákupu: id itemu → krok a fáze. Id itemů jsou 32bitová čísla bez znaménka (3077079169…) – do int se nevejdou
    Dictionary<long, (int Step, string Phase)> shopSteps = new();
    bool shopBusy;
    int shopMisses;
    long shopUntil;

    bool DeadlockRunning => deadlockPid != 0;

    void InitDeadlock()
    {
        shopTimer.Tick += (_, _) => ShopTick();
        keyHook.WatchKeys.Add(VK_B);
        keyHook.WatchKeys.Add(VK_ESCAPE);
        keyHook.KeyPressed += vk => BeginInvoke(() => OnShopKey(vk));
    }

    static int FindProcess(string name)
    {
        try
        {
            var procs = Process.GetProcessesByName(name);
            int pid = procs.FirstOrDefault()?.Id ?? 0;
            foreach (var p in procs) p.Dispose();
            return pid;
        }
        catch
        {
            return 0;
        }
    }

    static int FindDeadlockPid()
    {
        foreach (var name in DeadlockProcesses)
            if (FindProcess(name) is int pid and not 0) return pid;
        return 0;
    }

    bool DeadlockInForeground()
    {
        if (deadlockPid == 0) return false;
        GetWindowThreadProcessId(GetForegroundWindow(), out uint pid);
        return pid == deadlockPid;
    }

    // Každé kolo sledování (TickAsync); proces se ale hledá jen jednou za 5 s
    void CheckDeadlock()
    {
        long now = Environment.TickCount64;
        if (now - deadlockCheckedAt < 5000) return;
        deadlockCheckedAt = now;
        bool was = DeadlockRunning;
        deadlockPid = FindDeadlockPid();
        if (was != DeadlockRunning)
        {
            PostToWeb(new { type = "deadlock", running = DeadlockRunning });
            if (DeadlockRunning)
            {
                keyHook.Install(); // obchod (B) a zkratky overlaye, když má focus hra
            }
            else
            {
                EndShopSession();
                if (gameKey == null) keyHook.Uninstall();
            }
            ApplyDeadlockOverlay();
        }
        // Windows hooky občas tiše odpojí – obnovovat (během zápasu v LoL to dělá TickAsync)
        else if (DeadlockRunning && gameKey == null && now - keyHook.InstalledAt > 30000)
        {
            keyHook.Install();
        }
    }

    // Pořadí nákupu od rozhraní (hrdina z „Hraju za…“, jinak všichni hrdinové)
    void SetDeadlockData(JsonNode msg)
    {
        dlBuild = msg["build"]?.DeepClone();
        shopSteps = new();
        var list = new List<(long, string)>();
        if (msg["shop"] is JsonObject shop)
        {
            foreach (var entry in shop["names"]?.AsArray() ?? new JsonArray())
            {
                if (entry is not JsonArray arr || arr.Count < 2 || arr[0] is not JsonValue idv || !idv.TryGetValue<long>(out var id)) continue;
                foreach (var n in arr.Skip(1))
                    if (n is JsonValue v && v.TryGetValue<string>(out var s)) list.Add((id, s));
            }
            // [[id, krok, fáze], …]
            foreach (var entry in shop["order"]?.AsArray() ?? new JsonArray())
            {
                if (entry is not JsonArray arr || arr.Count < 3 || arr[0] is not JsonValue idv || !idv.TryGetValue<long>(out var id)
                    || arr[1] is not JsonValue sv || !sv.TryGetValue<int>(out var step)) continue;
                shopSteps[id] = (step, Str(arr[2]));
            }
        }
        shopScanner.SetNames(list);
        HideShopLabels();
        ApplyDeadlockOverlay();
    }

    // Overlay s buildem, když běží Deadlock (zápas v LoL a ukázka overlaye mají přednost)
    void ApplyDeadlockOverlay()
    {
        bool want = DeadlockRunning && gameKey == null && !overlayDemo && dlBuild != null;
        if (want)
        {
            overlay ??= new OverlayForm();
            overlay.SetAccent(uiAccent);
            overlay.SetBuild(dlBuild);
            overlayIsDeadlock = true;
        }
        else if (overlayIsDeadlock && !overlayDemo && gameKey == null)
        {
            overlay?.SetBuild(null);
            overlayIsDeadlock = false;
        }
        UpdateOverlay();
        UpdateHotkeys();
    }

    // ---------- Obchod: čísla kroků u itemů ----------

    void OnShopKey(int vk)
    {
        if (!DeadlockRunning || !DeadlockInForeground()) return;
        // Esc nebo B při otevřeném obchodě = obchod se zavírá
        if (vk == VK_ESCAPE || shopLabels.Any(l => l.Visible))
        {
            EndShopSession();
            return;
        }
        if (!cardLabelsEnabled || !shopScanner.HasNames || shopSteps.Count == 0) return;
        shopMisses = 0;
        shopUntil = Environment.TickCount64 + 90_000; // nejdéle minutu a půl, pak zase až po dalším B
        if (!shopTimer.Enabled) shopTimer.Start();
        ShopTick();
    }

    async void ShopTick()
    {
        if (shopBusy) return;
        if (!DeadlockRunning || Environment.TickCount64 > shopUntil)
        {
            EndShopSession();
            return;
        }
        var screen = DeadlockScreen();
        if (screen == null)
        {
            HideShopLabels(); // jiné okno v popředí
            return;
        }
        shopBusy = true;
        try
        {
            var found = await shopScanner.ScanAsync(screen.Value);
            // Jistota, že je otevřený obchod: aspoň 3 itemy
            if (found != null && found.Count >= 3)
            {
                shopMisses = 0;
                ShowShopLabels(found);
            }
            else if (++shopMisses >= 3)
            {
                EndShopSession();
            }
        }
        catch
        {
            HideShopLabels();
        }
        finally
        {
            shopBusy = false;
        }
    }

    Rectangle? DeadlockScreen()
    {
        if (!DeadlockInForeground() || !GetWindowRect(GetForegroundWindow(), out var r)) return null;
        var rect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        return rect.Width > 600 && rect.Height > 400 ? rect : null;
    }

    // Čísla kroků jen u itemů z pořadí nákupu – nad názvem itemu (na spodku jeho ikony). Všechna stejně velká podle
    // písma v obchodě (medián výšky řádku – OCR občas jeden řádek nafoukne)
    void ShowShopLabels(List<ShopScanner.Found> found)
    {
        var heights = found.Select(f => f.LineHeight).Order().ToList();
        int s = (int)Math.Clamp(heights[heights.Count / 2] * 1.8f, 20, 40);
        int i = 0;
        foreach (var f in found.Where(f => shopSteps.ContainsKey(f.Id)).OrderBy(f => shopSteps[f.Id].Step).Take(24))
        {
            var (step, phase) = shopSteps[f.Id];
            if (shopLabels.Count <= i) shopLabels.Add(new ShopStepForm());
            var label = shopLabels[i++];
            label.SetContent(step, phase);
            label.Bounds = new Rectangle((int)(f.Name.Left + f.Name.Width / 2 - s / 2f), (int)(f.Name.Top - s - Math.Max(2, s / 8)), s, s);
            if (!label.Visible) label.Show();
            label.KeepOnTop();
        }
        for (; i < shopLabels.Count; i++)
            if (shopLabels[i].Visible) shopLabels[i].Hide();
    }

    void HideShopLabels()
    {
        foreach (var l in shopLabels)
            if (l.Visible) l.Hide();
    }

    void EndShopSession()
    {
        shopTimer.Stop();
        shopMisses = 0;
        HideShopLabels();
    }
}
