using System.Diagnostics;
using System.Text.Json.Nodes;

namespace NotLoL;

/// <summary>
/// Deadlock (Valve): pozná se podle procesu project8.exe (hledá se jednou za 5 s). Rozhraní (deadlock.js) pošle
/// build hrdiny, za kterého hraješ („Hraju za…“) – overlay ho ukazuje, dokud hra běží – a hodnocení itemů.
/// Po stisku B (obchod) ve hře se chvíli čte obrazovka a k názvům itemů se přidají štítky; čte se jen tehdy,
/// ať to během hraní nebere výkon.
/// </summary>
public sealed partial class MainForm
{
    const string DeadlockProcess = "project8";
    const int VK_B = 0x42, VK_ESCAPE = 0x1B;

    int deadlockPid;
    long deadlockCheckedAt;
    JsonNode? dlBuild;
    bool overlayIsDeadlock; // overlay právě ukazuje build z Deadlocku

    readonly ShopScanner shopScanner = new();
    readonly System.Windows.Forms.Timer shopTimer = new() { Interval = 700 };
    readonly List<AugmentLabelForm> shopLabels = [];
    Dictionary<int, JsonNode> shopRatings = new();
    string shopNoData = "";
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
        deadlockPid = FindProcess(DeadlockProcess);
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

    // Build a hodnocení itemů od rozhraní – null = nehraješ za žádného hrdinu
    void SetDeadlockData(JsonNode msg)
    {
        dlBuild = msg["build"]?.DeepClone();
        shopRatings = new();
        var list = new List<(int, string)>();
        if (msg["shop"] is JsonObject shop)
        {
            foreach (var entry in shop["names"]?.AsArray() ?? new JsonArray())
            {
                if (entry is not JsonArray arr || arr.Count < 2 || arr[0] is not JsonValue idv || !idv.TryGetValue<int>(out var id)) continue;
                foreach (var n in arr.Skip(1))
                    if (n is JsonValue v && v.TryGetValue<string>(out var s)) list.Add((id, s));
            }
            foreach (var (k, v) in shop["ratings"]?.AsObject() ?? new JsonObject())
                if (int.TryParse(k, out var id) && v != null) shopRatings[id] = v.DeepClone();
            shopNoData = Str(shop["noData"]);
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

    // ---------- Obchod: štítky u itemů ----------

    void OnShopKey(int vk)
    {
        if (!DeadlockRunning || !DeadlockInForeground()) return;
        // Esc nebo B při otevřeném obchodě = obchod se zavírá
        if (vk == VK_ESCAPE || shopLabels.Any(l => l.Visible))
        {
            EndShopSession();
            return;
        }
        if (!cardLabelsEnabled || !shopScanner.HasNames) return;
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

    void ShowShopLabels(List<ShopScanner.Found> found)
    {
        double ScoreOf(int id) => shopRatings.TryGetValue(id, out var v) && v["score"] is JsonValue sv && sv.TryGetValue<double>(out var d) ? d : 0;
        // Zlatý rámeček: nejlepší item z toho, co je vidět
        int best = found.Where(f => ScoreOf(f.Id) > 0).OrderByDescending(f => ScoreOf(f.Id)).Select(f => f.Id).FirstOrDefault(-1);
        int i = 0;
        foreach (var f in found.Take(48))
        {
            if (shopLabels.Count <= i) shopLabels.Add(new AugmentLabelForm());
            var label = shopLabels[i++];
            shopRatings.TryGetValue(f.Id, out var info);
            var cls = Str(info?["cls"]);
            var verdict = Str(info?["verdict"]);
            label.SetContent(Str(info?["tier"]), cls.Length > 0 ? cls : "none", verdict.Length > 0 ? verdict : shopNoData, Str(info?["stat"]), f.Id == best);
            // Štítek pod názvem itemu, velikost podle písma
            int h = (int)Math.Clamp(f.Name.Height * 1.9f, 24, 46);
            int w = (int)Math.Max(f.Name.Width + h, h * 4.4f);
            label.Bounds = new Rectangle((int)(f.Name.Left + f.Name.Width / 2 - w / 2f), (int)f.Name.Bottom + 2, w, h);
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
