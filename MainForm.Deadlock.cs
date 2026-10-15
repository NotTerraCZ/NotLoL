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
    // Číslo kroku pro každý item zvlášť (podle id), ať si čísla mezi itemy nepřeskakují; kde mají být, určí shopLayout
    readonly Dictionary<long, ShopStepForm> shopLabels = new();
    readonly ShopLabelLayout shopLayout = new();
    // Pořadí nákupu: id itemu → krok a fáze. Id itemů jsou 32bitová čísla bez znaménka (3077079169…) – do int se nevejdou
    Dictionary<long, (int Step, string Phase)> shopSteps = new();
    bool shopBusy;
    int shopMisses;
    long shopUntil;
    const int MinShopItems = 4; // tolik názvů itemů na obrazovce = je otevřený obchod

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
        if (vk == VK_ESCAPE || shopLabels.Values.Any(l => l.Visible))
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
            var found = await shopScanner.ScanAsync(screen.Value, OwnWindowBounds());
            if (found != null && found.Count >= MinShopItems)
            {
                shopMisses = 0;
                ShowShopLabels(found);
            }
            else
            {
                // Žádný item = obchod je zavřený, čísla hned pryč; pár itemů může být jen chvilková chyba čtení
                if (found == null || shopMisses >= 1) HideShopLabels();
                if (++shopMisses >= 4) EndShopSession();
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

    // Okna NotLoL nad hrou – čtení obchodu je přeskočí (overlay s pořadím nákupu má stejné názvy itemů). Hlavní okno
    // ne: když má hra focus, je za ní, a otevřené přes celou obrazovku by vyřadilo celý obchod
    List<Rectangle> OwnWindowBounds()
    {
        var list = new List<Rectangle>();
        if (overlay?.Visible == true) list.Add(overlay.Bounds);
        if (panel?.Visible == true) list.Add(panel.Bounds);
        return list;
    }

    // Čísla kroků jen u itemů z pořadí nákupu (rozmístění a jeho ustálení: ShopLabelLayout)
    void ShowShopLabels(List<ShopScanner.Found> found)
    {
        var layout = shopLayout.Update(found.Select(f => new ShopLabelLayout.Item(f.Id, f.Name, f.LineHeight)).ToList(), shopSteps.ContainsKey);
        foreach (var (id, rect) in layout)
        {
            if (!shopSteps.TryGetValue(id, out var info)) continue;
            if (!shopLabels.TryGetValue(id, out var label)) shopLabels[id] = label = new ShopStepForm();
            label.SetContent(info.Step, info.Phase);
            if (label.Bounds != rect) label.Bounds = rect;
            if (!label.Visible) label.Show();
            label.KeepOnTop();
        }
        foreach (var (id, label) in shopLabels)
            if (label.Visible && !layout.ContainsKey(id)) label.Hide();
    }

    void HideShopLabels()
    {
        shopLayout.Clear();
        foreach (var l in shopLabels.Values)
            if (l.Visible) l.Hide();
    }

    void EndShopSession()
    {
        shopTimer.Stop();
        shopMisses = 0;
        HideShopLabels();
    }
}
