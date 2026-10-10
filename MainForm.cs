using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NotLoL;

/// <summary>
/// Hlavní okno: WebView2 zobrazuje rozhraní zabalené v .exe (složka web/)
/// pod virtuální adresou https://notlol.example/. Data se stahují z u.gg a Data Dragonu.
/// </summary>
public sealed class MainForm : Form
{
    static readonly Color Background = Color.FromArgb(10, 13, 22);
    static readonly string DataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NotLoL");
    static readonly string WindowFile = Path.Combine(DataDir, "window.json");

    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Background };
    CoreWebView2Environment? env;

    // Herní panel (Ctrl+X)
    InGameForm? panel;
    JsonNode? panelInfo;
    bool panelDemo;
    readonly Dictionary<string, JsonObject?> ranks = new();

    // Zkratky, když má focus hra (ta běžné zkratky jiných programů vypíná)
    readonly GameKeyHook keyHook = new();
    readonly Dictionary<int, long> lastHotkey = new();
    int gamePid;

    // Hra (v režimu bez okrajů) si vrací své okno navrch – overlay a panel kontrolujeme a vracíme nad ni
    readonly System.Windows.Forms.Timer keepOnTop = new() { Interval = 150 };

    // Napojení na LoL klient a hru
    readonly LeagueClient lcu = new();
    readonly LiveGame liveGame = new();
    OverlayForm? overlay;
    bool connected;
    string phase = "None";
    string gameMode = "";
    int queueId;
    LeagueClient.ChampSelectState? champSelect;
    LiveGame.Snapshot? game;
    string? gameKey;
    bool overlayEnabled = true;
    bool overlayHidden;
    bool overlayDemo;
    bool hotkeys;

    record SavedWindow(int X, int Y, int Width, int Height, bool Maximized);

    // Běh na pozadí: ikona v oznamovací oblasti, zavření okna appku jen schová
    readonly NotifyIcon tray = new();
    readonly ToolStripMenuItem openItem = new();
    readonly ToolStripMenuItem settingsItem = new();
    readonly ToolStripMenuItem autostartItem = new();
    readonly ToolStripMenuItem backupItem = new();
    readonly ToolStripMenuItem exitItem = new();
    readonly AppSettings settings = AppSettings.Load();
    bool startHidden;
    bool exiting;
    bool initStarted;

    // Jazyk a barva z Nastavení (posílá se i hernímu panelu)
    string uiLang = "cs";
    string uiAccent = "blue";

    // Přihlášený účet v LoL klientovi (profil vpravo nahoře)
    JsonObject? me;
    long meTriedAt;
    bool meStale = true;
    string? clientLocale; // jazyk hry, např. "cs_CZ"

    // Hodnocení nabízených karet přímo na obrazovce (Arena, ARAM: Mayhem)
    readonly AugmentScanner augScanner = new();
    readonly System.Windows.Forms.Timer augTimer = new() { Interval = 1000 };
    readonly List<AugmentLabelForm> augLabels = [];
    Dictionary<int, JsonNode> augRatings = new();
    string augNoData = "";
    bool augBusy;
    int augMisses;
    List<PointF> augLastCenters = [];
    bool cardLabelsEnabled = true;
    readonly string? augLog = Environment.GetEnvironmentVariable("NOTLOL_AUG_LOG");

    // Záloha dat (u.gg apod.) na disk + obnova každou hodinu
    readonly DataCache dataCache = new();
    readonly System.Windows.Forms.Timer backupTimer = new() { Interval = 60 * 60 * 1000 };
    readonly System.Windows.Forms.Timer firstBackup = new() { Interval = 90 * 1000 };
    bool backupRunning;

    public MainForm(bool background = false)
    {
        startHidden = background;
        Text = "NotLoL";
        BackColor = Background;
        MinimumSize = new Size(520, 480);
        StartPosition = FormStartPosition.Manual;
        using (var ico = typeof(MainForm).Assembly.GetManifestResourceStream("app.ico"))
        {
            if (ico != null) Icon = new Icon(ico);
        }
        RestoreWindow();
        Controls.Add(web);
        keepOnTop.Tick += (_, _) => BringOverlaysToTop();
        augTimer.Tick += (_, _) => AugTick();
        winEventProc = (_, _, _, _, _, _, _) => BringOverlaysToTop();
        keyHook.Filter = GameInForeground;
        keyHook.Pressed += id => BeginInvoke(() => HotkeyAction(id));

        // Spouštění se systémem: při prvním spuštění zapnout, jinak jen opravit cestu k .exe
        if (!settings.AutostartInitialized)
        {
            AutoStart.Set(true);
            settings.AutostartInitialized = true;
            settings.Save();
        }
        AutoStart.RefreshPath();

        // Texty v jazyce appky z minula (rozhraní je po načtení pošle znovu)
        Loc.Set(settings.Native);
        uiLang = settings.Lang ?? uiLang;
        uiAccent = settings.Accent ?? uiAccent;
        SetupTray();

        // Hodinová záloha: první chvíli po startu, pak každou hodinu
        firstBackup.Tick += (_, _) =>
        {
            firstBackup.Stop();
            RequestBackup(manual: false);
        };
        backupTimer.Tick += (_, _) => RequestBackup(manual: false);
        ListenForShowRequests();
    }

    // ---------- Oznamovací oblast (tray) ----------

    void SetupTray()
    {
        var menu = new ContextMenuStrip();
        openItem.Font = new Font(SystemFonts.MenuFont ?? Font, FontStyle.Bold);
        openItem.Click += (_, _) => ShowFromTray();
        settingsItem.Click += (_, _) =>
        {
            ShowFromTray();
            PostToWeb(new { type = "navigate", hash = "#/settings" });
        };
        autostartItem.Checked = AutoStart.IsEnabled();
        autostartItem.Click += (_, _) => SetAutostart(!AutoStart.IsEnabled());
        backupItem.Click += (_, _) => RequestBackup();
        exitItem.Click += (_, _) => ExitApp();
        menu.Items.Add(openItem);
        menu.Items.Add(settingsItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(autostartItem);
        menu.Items.Add(backupItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exitItem);
        LabelTray();

        tray.Icon = Icon;
        tray.Text = "NotLoL";
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (_, _) => ShowFromTray();
        tray.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) ShowFromTray();
        };
        tray.Visible = true;
    }

    void LabelTray()
    {
        openItem.Text = Loc.T("trayOpen", "Otevřít NotLoL");
        settingsItem.Text = Loc.T("traySettings", "Nastavení");
        autostartItem.Text = Loc.T("trayAutostart", "Spouštět při startu Windows");
        backupItem.Text = Loc.T("trayBackup", "Zálohovat data teď");
        exitItem.Text = Loc.T("trayExit", "Ukončit NotLoL");
    }

    // Jazyk / barva / texty z rozhraní: uložit, přeložit tray a overlay, poslat hernímu panelu
    void ApplyUiSettings(JsonNode msg)
    {
        var lang = msg["lang"]?.GetValue<string>();
        var accent = msg["accent"]?.GetValue<string>();
        Dictionary<string, string>? native = null;
        if (msg["native"] is JsonObject n)
        {
            native = new();
            foreach (var (key, value) in n)
                if (value is JsonValue v && v.TryGetValue<string>(out var s)) native[key] = s;
        }
        if (lang != null) uiLang = lang;
        if (accent != null) uiAccent = accent;
        if (native != null) Loc.Set(native);

        bool changed = settings.Lang != uiLang || settings.Accent != uiAccent
            || (native != null && (settings.Native == null || !settings.Native.OrderBy(kv => kv.Key).SequenceEqual(native.OrderBy(kv => kv.Key))));
        if (changed)
        {
            settings.Lang = uiLang;
            settings.Accent = uiAccent;
            if (native != null) settings.Native = native;
            settings.Save();
        }
        LabelTray();
        overlay?.Invalidate();
        panel?.Post(new { type = "prefs", lang = uiLang, accent = uiAccent });
    }

    void PostMe()
    {
        if (me != null) PostToWeb(new { type = "me", me });
    }

    void SetAutostart(bool enabled)
    {
        AutoStart.Set(enabled);
        autostartItem.Checked = AutoStart.IsEnabled();
        PostAppStatus();
    }

    // Okno se při startu na pozadí vůbec neukáže, ale handle (a tím i WebView2) se vytvoří
    protected override void SetVisibleCore(bool value)
    {
        if (startHidden)
        {
            value = false;
            if (!IsHandleCreated) CreateHandle();
        }
        base.SetVisibleCore(value);
    }

    void ShowFromTray()
    {
        startHidden = false;
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    void ExitApp()
    {
        exiting = true;
        Close();
    }

    // Druhé spuštění appky (nebo klik na zástupce) jen ukáže tohle okno
    void ListenForShowRequests()
    {
        var ev = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
        var thread = new Thread(() =>
        {
            while (ev.WaitOne())
            {
                try { BeginInvoke(ShowFromTray); }
                catch { return; }
            }
        }) { IsBackground = true };
        thread.Start();
    }

    // ---------- Záloha dat ----------

    void RequestBackup(bool manual = true)
    {
        if (backupRunning || web.CoreWebView2 == null) return;
        // Během hry automatickou zálohu přeskoč (ať nic nebere síť), zkusí se za hodinu
        if (!manual && gameKey != null) return;
        backupRunning = true;
        PostAppStatus();
        PostToWeb(new { type = "backup" });
    }

    void PostAppStatus()
    {
        var (files, bytes) = DataCache.Stats();
        PostToWeb(new
        {
            type = "appStatus",
            autostart = AutoStart.IsEnabled(),
            backup = new { last = settings.LastBackup, files, bytes, running = backupRunning },
        });
    }

    bool GameInForeground()
    {
        if (gamePid == 0) return false;
        GetWindowThreadProcessId(GetForegroundWindow(), out uint pid);
        return pid == gamePid;
    }

    static int FindGamePid()
    {
        var procs = Process.GetProcessesByName("League of Legends");
        int pid = procs.FirstOrDefault()?.Id ?? 0;
        foreach (var p in procs) p.Dispose();
        return pid;
    }

    // Stejná zkratka může přijít dvakrát (RegisterHotKey i hook) – druhou do 0,4 s ignorujeme
    void HotkeyAction(int id)
    {
        long now = Environment.TickCount64;
        if (lastHotkey.TryGetValue(id, out var last) && now - last < 400) return;
        lastHotkey[id] = now;

        switch (id)
        {
            case GameKeyHook.TogglePanel:
                TogglePanel();
                break;
            case GameKeyHook.ToggleOverlay:
                overlayHidden = !overlayHidden;
                UpdateOverlay();
                break;
            case GameKeyHook.MoveOverlay when overlay != null:
                overlayHidden = false;
                UpdateOverlay();
                overlay.ToggleMoveMode();
                break;
        }
    }

    // ---------- Overlay a panel nad hrou ----------

    readonly WinEventDelegate winEventProc;
    readonly List<IntPtr> winEventHooks = [];

    // Při přepnutí do hry (změna okna v popředí) nebo změně pořadí oken se hned vrátíme navrch
    void SetWinEventHooks(bool on)
    {
        foreach (var h in winEventHooks) UnhookWinEvent(h);
        winEventHooks.Clear();
        if (!on) return;
        winEventHooks.Add(SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, winEventProc, 0, 0, WINEVENT_OUTOFCONTEXT));
        winEventHooks.Add(SetWinEventHook(EVENT_OBJECT_REORDER, EVENT_OBJECT_REORDER, IntPtr.Zero, winEventProc, 0, 0, WINEVENT_OUTOFCONTEXT));
    }

    /// <summary>Vrátí overlay a panel navrch, ale jen když je zakrývá cizí okno (jinak nic nedělá).</summary>
    void BringOverlaysToTop()
    {
        var ours = new List<(IntPtr handle, Rectangle bounds)>();
        if (overlay?.Visible == true) ours.Add((overlay.Handle, overlay.Bounds));
        if (panel?.Visible == true) ours.Add((panel.Handle, panel.Bounds));
        foreach (var l in augLabels) if (l.Visible) ours.Add((l.Handle, l.Bounds));
        if (ours.Count == 0) return;

        // Projdi okna shora dolů: dokud nenarazíme na všechna naše, nesmí nás překrývat nic cizího
        var seen = new HashSet<IntPtr>();
        for (var h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero && seen.Count < ours.Count; h = GetWindow(h, GW_HWNDNEXT))
        {
            if (ours.Any(o => o.handle == h))
            {
                seen.Add(h);
                continue;
            }
            if (!IsWindowVisible(h) || !GetWindowRect(h, out var r)) continue;
            var rect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
            if (ours.Any(o => !seen.Contains(o.handle) && o.bounds.IntersectsWith(rect)))
            {
                overlay?.KeepOnTop();
                panel?.KeepOnTop();
                foreach (var l in augLabels) l.KeepOnTop();
                return;
            }
        }
    }

    // ---------- Hodnocení karet na obrazovce (Arena, ARAM: Mayhem) ----------

    // Data od rozhraní: názvy augmentů (jazyk hry + angličtina) a hodnocení pro tvého šampiona
    void SetAugmentData(JsonNode? scan)
    {
        augRatings = new();
        var list = new List<(int, string)>();
        if (scan != null)
        {
            foreach (var entry in scan["names"]?.AsArray() ?? new JsonArray())
            {
                if (entry is not JsonArray arr || arr.Count < 2 || arr[0] is not JsonValue idv || !idv.TryGetValue<int>(out var id)) continue;
                foreach (var n in arr.Skip(1))
                    if (n is JsonValue v && v.TryGetValue<string>(out var s)) list.Add((id, s));
            }
            foreach (var (k, v) in scan["ratings"]?.AsObject() ?? new JsonObject())
                if (int.TryParse(k, out var id) && v != null) augRatings[id] = v.DeepClone();
            augNoData = Str(scan["noData"]);
        }
        augScanner.SetNames(list);
        augScanner.SetLanguage(clientLocale);
        HideAugLabels();
        UpdateAugScan();
    }

    // Čtení obrazovky běží jen ve hře (Arena/Mayhem – jinak rozhraní data nepošle) nebo v ukázce overlaye
    void UpdateAugScan()
    {
        bool on = cardLabelsEnabled && augScanner.HasNames && (gameKey != null || overlayDemo);
        if (on && !augTimer.Enabled) augTimer.Start();
        if (!on && augTimer.Enabled)
        {
            augTimer.Stop();
            HideAugLabels();
        }
    }

    // Obrazovka, na které se mají hledat karty: okno hry v popředí (v ukázce jakékoli cizí okno v popředí)
    Rectangle? AugScreen()
    {
        var fg = GetForegroundWindow();
        if (gameKey != null && !overlayDemo)
        {
            if (!GameInForeground()) return null;
        }
        else
        {
            GetWindowThreadProcessId(fg, out uint pid);
            if (pid == Environment.ProcessId) return null;
        }
        if (!GetWindowRect(fg, out var r)) return null;
        var rect = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        return rect.Width > 600 && rect.Height > 400 ? rect : null;
    }

    async void AugTick()
    {
        if (augBusy) return;
        var screen = AugScreen();
        if (screen == null)
        {
            HideAugLabels();
            return;
        }
        augBusy = true;
        try
        {
            long t0 = Environment.TickCount64;
            var r = await augScanner.ScanAsync(screen.Value);
            var sc = screen.Value;
            // Jistota: aspoň 2 karty v řadě; jedna stačí, jen když je na místě karty, která už štítek má
            // (např. právě přehozená karta, u které se ostatní zrovna nepřečetly)
            bool samePlace = r != null && r.Cards.Count == 1 && augLabels.Any(l => l.Visible) && augLastCenters.Any(p =>
                Math.Abs(p.X - (r.Cards[0].Name.Left + r.Cards[0].Name.Width / 2)) < sc.Width * 0.04f
                && Math.Abs(p.Y - (r.Cards[0].Name.Top + r.Cards[0].Name.Height / 2)) < sc.Height * 0.03f);
            bool sure = r != null && (r.Cards.Count >= 2 || (samePlace && r.Cards[0].Score >= 0.85));
            if (augLog != null)
            {
                try
                {
                    File.AppendAllText(augLog, $"{DateTime.Now:HH:mm:ss.fff} {Environment.TickCount64 - t0} ms screen={screen} sure={sure} "
                        + string.Join(" | ", r?.Cards.Select(c => $"{c.Id} {c.Score:0.00} {Rectangle.Round(c.Name)}") ?? []) + $" spacing={r?.Spacing:0}\n");
                }
                catch { /* log je jen pro ladění */ }
            }
            if (sure)
            {
                augMisses = 0;
                ShowAugLabels(r!);
            }
            else if (++augMisses >= 2)
            {
                HideAugLabels();
            }
        }
        catch
        {
            HideAugLabels();
        }
        finally
        {
            augBusy = false;
            // Když karty svítí, kontroluj častěji (přehození karty, výběr)
            augTimer.Interval = augLabels.Any(l => l.Visible) ? 500 : 1000;
        }
    }

    void ShowAugLabels(AugmentScanner.Result r)
    {
        float s = r.Spacing;
        if (r.Cards.Count >= 2) augLastCenters = r.Cards.Select(c => new PointF(c.Name.Left + c.Name.Width / 2, c.Name.Top + c.Name.Height / 2)).ToList();
        double ScoreOf(int id) => augRatings.TryGetValue(id, out var v) && v["score"] is JsonValue sv && sv.TryGetValue<double>(out var d) ? d : 0;
        var scores = r.Cards.Select(c => ScoreOf(c.Id)).ToList();
        double max = scores.Max();
        // Nejlepší z nabídky jen když je jasně nejlepší (a jsou vidět aspoň 2 karty)
        int bestIdx = r.Cards.Count >= 2 && max > 0 && scores.Count(x => Math.Abs(x - max) < 1e-9) == 1 ? scores.IndexOf(max) : -1;

        for (int i = 0; i < 3; i++)
        {
            if (augLabels.Count <= i) augLabels.Add(new AugmentLabelForm());
            var label = augLabels[i];
            if (i >= r.Cards.Count)
            {
                label.Hide();
                continue;
            }
            var c = r.Cards[i];
            augRatings.TryGetValue(c.Id, out var info);
            var cls = Str(info?["cls"]);
            var verdict = Str(info?["verdict"]);
            label.SetContent(Str(info?["tier"]), cls.Length > 0 ? cls : "none", verdict.Length > 0 ? verdict : augNoData, Str(info?["stat"]), i == bestIdx);

            // Spodní volná část karty (pod popisem, nad okrajem karty); prizmatické itemy mají delší popis → níž
            float cx = c.Name.Left + c.Name.Width / 2, cy = c.Name.Top + c.Name.Height / 2;
            int w = (int)(s * 0.76f), h = (int)Math.Max(40, s * 0.15f);
            float below = Str(info?["kind"]) == "item" ? 0.555f : 0.50f;
            label.Bounds = new Rectangle((int)(cx - w / 2f), (int)(cy + s * below), w, h);
            if (!label.Visible) label.Show();
            label.KeepOnTop();
        }
    }

    void HideAugLabels()
    {
        augMisses = 0;
        foreach (var l in augLabels) if (l.Visible) l.Hide();
    }

    static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Tmavý titulek okna ve stejné barvě jako aplikace (Windows 11)
        int on = 1;
        DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
        int caption = Background.R | (Background.G << 8) | (Background.B << 16);
        DwmSetWindowAttribute(Handle, DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
        BeginInvoke(InitAsync);
    }

    // Inicializace po vytvoření okna – funguje i při startu na pozadí, kdy se okno neukáže
    async void InitAsync()
    {
        if (initStarted) return;
        initStarted = true;
        try
        {
            env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "WebView2"));
            _ = web.Handle; // ve skrytém okně se handle ovládacího prvku jinak nevytvoří
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            // Rozhraní neběží, takže překlad z něj nemáme – čeština/slovenština, jinak angličtina
            bool czech = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName is "cs" or "sk";
            MessageBox.Show(this, czech
                    ? "Chybí Microsoft Edge WebView2 Runtime.\n\nStáhni ho z https://go.microsoft.com/fwlink/p/?LinkId=2124703 a spusť NotLoL znovu."
                    : "Microsoft Edge WebView2 Runtime is missing.\n\nDownload it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start NotLoL again.",
                "NotLoL", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = web.CoreWebView2;
        WebAssets.Attach(core);
        dataCache.Attach(core);
        core.DocumentTitleChanged += (_, _) => Text = core.DocumentTitle;
        core.WebMessageReceived += OnWebMessage;

        core.Navigate(WebAssets.Origin + "index.html");
        _ = WatchLeagueAsync();
#if DEBUG
        // Test zkratek bez skutečné hry: 1 = hook + RegisterHotKey, 2 = jen RegisterHotKey
        var test = Environment.GetEnvironmentVariable("NOTLOL_HOOK_TEST");
        if (test is "1" or "2")
        {
            panelDemo = true;
            SetHotkeys(true);
            if (test == "1") keyHook.Install();
            var t = new System.Windows.Forms.Timer { Interval = 300, Enabled = true };
            t.Tick += (_, _) => gamePid = FindGamePid();
        }
#endif
    }

    // ---------- Zprávy z rozhraní ----------

    void PostToWeb(object message)
    {
        try { web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json)); }
        catch { /* okno se zavírá */ }
    }

    async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonNode? msg;
        try { msg = JsonNode.Parse(e.WebMessageAsJson); }
        catch { return; }

        switch (msg?["type"]?.GetValue<string>())
        {
            case "ready":
                // Stránka se (znovu) načetla – pošli jí aktuální stav
                PostClientStatus();
                PostAppStatus();
                PostMe();
                if (champSelect != null) PostChampSelect();
                if (game != null) PostGame(game);
                backupRunning = false;
                if (!backupTimer.Enabled)
                {
                    backupTimer.Start();
                    // Poslední záloha je starší než hodina (nebo žádná)? Udělej ji chvíli po startu
                    if (settings.LastBackup == null || DateTime.Now - settings.LastBackup > TimeSpan.FromMinutes(55)) firstBackup.Start();
                }
                break;
            case "setAutostart":
                SetAutostart(msg["enabled"]?.GetValue<bool>() ?? false);
                break;
            case "backupNow":
                RequestBackup();
                break;
            case "backupDone":
                backupRunning = false;
                if ((msg["ok"]?.GetValue<int>() ?? 0) > 0)
                {
                    settings.LastBackup = DateTime.Now;
                    settings.Save();
                }
                PostAppStatus();
                break;
            case "settings":
                overlayEnabled = msg["overlay"]?.GetValue<bool>() ?? true;
                cardLabelsEnabled = msg["cards"]?.GetValue<bool>() ?? true;
                ApplyUiSettings(msg);
                UpdateOverlay();
                UpdateAugScan();
                break;
            case "overlayBuild":
                SetAugmentData(msg["augScan"]);
                overlay ??= new OverlayForm();
                overlay.SetBuild(msg["build"]);
                if (game != null) overlay.SetLive(game);
                UpdateOverlay();
                panelInfo = msg["ingame"]?.DeepClone();
                if (panelInfo != null) panel?.Post(new { type = "info", info = panelInfo });
                break;
            case "panelDemo":
                // Ukázka herního panelu mimo hru (Ctrl+X ho pak přepíná)
                var info = msg["info"];
                panelDemo = info != null;
                if (panelDemo)
                {
                    var p = EnsurePanel();
                    if (p == null) break;
                    p.Post(new { type = "info", info = info!.DeepClone() });
                    p.Post(new { type = "live", live = msg["live"]?.DeepClone() });
                    p.Post(new { type = "ranks", ranks = msg["ranks"]?.DeepClone() });
                    p.ShowOn(Screen.FromControl(this));
                }
                else
                {
                    panel?.Hide();
                }
                UpdateHotkeys();
                break;
            case "lookup":
            {
                var id = msg["id"]?.GetValue<int>() ?? 0;
                if (!lcu.Connected)
                {
                    PostToWeb(new { type = "result", id, ok = false, message = Loc.T("lookupNeedClient", "Na hledání hráčů musí běžet LoL klient.") });
                    break;
                }
                try
                {
                    var (found, text, data) = await lcu.LookupPlayerAsync(
                        msg["gameName"]?.GetValue<string>() ?? "", msg["tagLine"]?.GetValue<string>() ?? "");
                    PostToWeb(new { type = "result", id, ok = found, message = text, data });
                }
                catch (Exception ex)
                {
                    PostToWeb(new { type = "result", id, ok = false, message = Loc.T("clientError", "Chyba při komunikaci s klientem: {0}", ex.Message) });
                }
                break;
            }
            case "overlayDemo":
                // Ukázka mimo hru – overlay jde rovnou přetáhnout na místo
                var demoBuild = msg["build"];
                overlayDemo = demoBuild != null;
                overlay ??= new OverlayForm();
                if (overlayDemo)
                {
                    overlay.SetBuild(demoBuild);
                    overlay.SetLive(DemoSnapshot(demoBuild!));
                    overlay.SetMoveMode(true);
                    // V ukázce se hledají karty i na obrazovce (pro šampiona v Areně / Mayhemu)
                    SetAugmentData(msg["augScan"]);
                }
                else
                {
                    overlay.SetMoveMode(false);
                    overlay.SetBuild(null);
                    SetAugmentData(null);
                    if (game != null) PostGame(game); // vrátit skutečný build
                }
                UpdateOverlay();
                UpdateHotkeys();
                break;
            case "import":
                var (ok, message) = await ImportAsync(msg);
                PostToWeb(new { type = "result", id = msg["id"]?.GetValue<int>() ?? 0, ok, message });
                break;
        }
    }

    async Task<(bool ok, string message)> ImportAsync(JsonNode msg)
    {
        if (!lcu.Connected) return (false, Loc.T("notConnected", "LoL klient není připojený."));
        try
        {
            switch (msg["what"]?.GetValue<string>())
            {
                case "runes":
                    return await lcu.ImportRunesAsync(msg["page"]!);
                case "spells":
                    var ids = msg["spells"]!.AsArray().Select(n => n!.GetValue<int>()).ToArray();
                    return await lcu.ImportSpellsAsync(ids[0], ids[1]);
                case "itemset":
                    return await lcu.ImportItemSetAsync(msg["set"]!);
                default:
                    return (false, Loc.T("unknownImport", "Neznámý import."));
            }
        }
        catch (Exception ex)
        {
            return (false, Loc.T("clientError", "Chyba při komunikaci s klientem: {0}", ex.Message));
        }
    }

    void PostClientStatus() => PostToWeb(new { type = "client", connected, phase });

    void PostChampSelect()
    {
        if (champSelect == null) return;
        PostToWeb(new
        {
            type = "champSelect",
            championId = champSelect.ChampionId,
            locked = champSelect.Locked,
            position = champSelect.Position,
            gameMode,
            queueId,
            bench = champSelect.Bench,
            team = champSelect.Team,
        });
    }

    void PostGame(LiveGame.Snapshot s) => PostToWeb(new
    {
        type = "game",
        champion = s.Champion,
        position = s.Position,
        gameMode = s.GameMode,
        queueId,
        locale = clientLocale,
        me = s.RiotId,
        players = (s.Players ?? []).Select(p => new { riotId = p.RiotId, champion = p.Champion, team = p.Team, position = p.Position }),
    });

    // ---------- Herní panel (Ctrl+X) ----------

    InGameForm? EnsurePanel()
    {
        if (panel != null) return panel;
        if (env == null) return null;
        panel = new InGameForm(env);
        panel.CloseRequested += () =>
        {
            panel?.Hide();
            if (panelDemo && gameKey == null) panelDemo = false;
            UpdateHotkeys();
        };
        panel.Post(new { type = "prefs", lang = uiLang, accent = uiAccent });
        return panel;
    }

    void TogglePanel()
    {
        var p = EnsurePanel();
        if (p == null) return;
        if (p.Visible)
        {
            p.Hide();
            return;
        }
        if (game != null && !panelDemo)
        {
            if (panelInfo != null) p.Post(new { type = "info", info = panelInfo });
            p.Post(new { type = "ranks", ranks });
            p.Post(new { type = "live", live = game });
        }
        p.ShowOn(Screen.FromHandle(GetForegroundWindow()));
    }

    // Ranky všech hráčů v zápase (přes LoL klient), postupně jak přicházejí
    async Task FetchRanksAsync(string key, List<LiveGame.Player> players)
    {
        foreach (var pl in players)
        {
            if (gameKey != key) return;
            if (pl.IsBot || !pl.RiotId.Contains('#') || ranks.ContainsKey(pl.RiotId)) continue;
            JsonObject? r = null;
            try { if (lcu.Connected) r = await lcu.GetRankAsync(pl.RiotId); }
            catch { /* klient neodpověděl */ }
            ranks[pl.RiotId] = r;
            panel?.Post(new { type = "ranks", ranks });
        }
    }

    // ---------- Sledování klienta a hry ----------

    async Task WatchLeagueAsync()
    {
        while (!IsDisposed)
        {
            try { await TickAsync(); }
            catch { /* klient se zrovna zavírá/otevírá – zkusíme příště */ }
            await Task.Delay(phase is "ChampSelect" or "InProgress" ? 1000 : 2500);
        }
    }

    async Task TickAsync()
    {
        bool wasConnected = connected;
        string oldPhase = phase;
        connected = lcu.TryConnect();
        if (connected)
        {
            try { phase = (await lcu.GetAsync("/lol-gameflow/v1/gameflow-phase"))?.GetValue<string>() ?? "None"; }
            catch { connected = false; }
        }
        if (!connected) phase = "None";
        if (connected != wasConnected || phase != oldPhase) PostClientStatus();

        // Přihlášený účet: po připojení, po hře (nový rank/úroveň) a dokud se nepřihlásí
        if (!connected)
        {
            me = null;
            meStale = true;
        }
        else
        {
            if (phase != oldPhase && (phase == "EndOfGame" || oldPhase is "EndOfGame" or "PreEndOfGame" or "WaitingForStats")) meStale = true;
            long now = Environment.TickCount64;
            if ((meStale || me == null) && now - meTriedAt > 5000)
            {
                meTriedAt = now;
                try
                {
                    var m = await lcu.GetMeAsync();
                    if (m != null)
                    {
                        me = m;
                        meStale = false;
                        clientLocale = Str(m["locale"]) is { Length: > 0 } loc ? loc : clientLocale;
                        augScanner.SetLanguage(clientLocale);
                        PostMe();
                    }
                }
                catch { /* klient se ještě načítá */ }
            }
        }

        // Výběr šampiona
        if (phase == "ChampSelect")
        {
            if (oldPhase != "ChampSelect") (gameMode, queueId) = await lcu.GetGameModeAsync();
            var cs = await lcu.GetChampSelectAsync();
            if (cs != null && (champSelect == null || cs.Key != champSelect.Key))
            {
                champSelect = cs;
                PostChampSelect();
            }
        }
        else
        {
            champSelect = null;
        }

        // Běžící hra (Live Client Data API)
        bool maybeInGame = phase is "InProgress" or "GameStart" or "Reconnect" || (!connected && GameProcessRunning());
        var snap = maybeInGame ? await liveGame.GetAsync() : null;
        if (snap != null)
        {
            var key = $"{snap.Champion}|{snap.Position}|{snap.GameMode}";
            game = snap;
            if (key != gameKey)
            {
                gameKey = key;
                if (connected)
                {
                    try { (gameMode, queueId) = await lcu.GetGameModeAsync(); }
                    catch { queueId = 0; }
                }
                overlayDemo = false;
                overlay?.SetMoveMode(false);
                overlay?.SetBuild(null);
                SetAugmentData(null); // hodnocení karet přijde s buildem pro nového šampiona
                panelDemo = false;
                panelInfo = null;
                panel?.Hide();
                ranks.Clear();
                // Hook až teď, ať je v řetězu před případným hookem hry
                gamePid = FindGamePid();
                keyHook.Install();
                PostGame(snap);
                _ = FetchRanksAsync(key, snap.Players ?? []);
            }
            overlay?.SetLive(snap);
            overlay?.KeepOnTop();
            // Windows hooky občas tiše odpojí a hra si může přidat vlastní – obnovuj
            if (Environment.TickCount64 - keyHook.InstalledAt > 30000)
            {
                if (gamePid == 0) gamePid = FindGamePid();
                keyHook.Install();
            }
            if (panel?.Visible == true && !panelDemo) panel.Post(new { type = "live", live = snap });
        }
        else if (gameKey != null && !maybeInGame)
        {
            gameKey = null;
            game = null;
            gamePid = 0;
            keyHook.Uninstall();
            overlay?.SetBuild(null);
            if (!panelDemo) panel?.Hide();
        }
        UpdateOverlay();
        UpdateHotkeys();
        UpdateAugScan();
    }

    static bool GameProcessRunning()
    {
        var procs = Process.GetProcessesByName("League of Legends");
        foreach (var p in procs) p.Dispose();
        return procs.Length > 0;
    }

    // Ukázkový stav: 3. úroveň, jeden bod nerozdělený, koupené startovní itemy
    static LiveGame.Snapshot DemoSnapshot(JsonNode build)
    {
        var start = build["start"]?.AsArray().Select(n => n?["id"]?.GetValue<int>() ?? 0) ?? [];
        return new LiveGame.Snapshot("", "", "", 60, 3,
            new Dictionary<string, int> { ["Q"] = 1, ["W"] = 1, ["E"] = 0, ["R"] = 0 }, start.ToHashSet());
    }

    void UpdateOverlay()
    {
        if (overlay == null) return;
        bool show = overlay.HasBuild && (overlayDemo || (overlayEnabled && !overlayHidden && gameKey != null));
        if (show && !overlay.Visible) overlay.Show();
        else if (!show && overlay.Visible) overlay.Hide();
    }

    // Zkratky platí jen během hry (nebo ukázky), jinak zůstanou Windows a ostatním appkám:
    // Ctrl+X = herní panel, Ctrl+Shift+H = skrýt/zobrazit overlay, Ctrl+Shift+M = přesouvání overlaye
    void UpdateHotkeys() => SetHotkeys(gameKey != null || overlayDemo || panelDemo);

    void SetHotkeys(bool on)
    {
        if (on == hotkeys) return;
        hotkeys = on;
        keepOnTop.Enabled = on;
        SetWinEventHooks(on);
        if (on)
        {
            RegisterHotKey(Handle, 1, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, (uint)Keys.H);
            RegisterHotKey(Handle, 2, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, (uint)Keys.M);
            RegisterHotKey(Handle, 3, MOD_CONTROL | MOD_NOREPEAT, (uint)Keys.X);
        }
        else
        {
            UnregisterHotKey(Handle, 1);
            UnregisterHotKey(Handle, 2);
            UnregisterHotKey(Handle, 3);
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY) HotkeyAction((int)m.WParam);
        base.WndProc(ref m);
    }

    // ---------- Pozice a velikost okna ----------

    void RestoreWindow()
    {
        try
        {
            var saved = JsonSerializer.Deserialize<SavedWindow>(File.ReadAllText(WindowFile));
            if (saved != null)
            {
                var rect = new Rectangle(saved.X, saved.Y, saved.Width, saved.Height);
                if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect)))
                {
                    Bounds = rect;
                    if (saved.Maximized) WindowState = FormWindowState.Maximized;
                    return;
                }
            }
        }
        catch { /* první spuštění nebo poškozený soubor */ }

        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        var size = new Size((int)(area.Width * 0.72), (int)(area.Height * 0.86));
        Bounds = new Rectangle(area.X + (area.Width - size.Width) / 2, area.Y + (area.Height - size.Height) / 2, size.Width, size.Height);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (Visible) SaveWindow();

        // Křížek okno jen schová – NotLoL běží dál v oznamovací oblasti (overlay, import, záloha)
        if (!exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            if (!settings.TrayHintShown)
            {
                tray.ShowBalloonTip(5000, Loc.T("balloonTitle", "NotLoL běží dál na pozadí"),
                    Loc.T("balloonText", "Najdeš ho v oznamovací oblasti vpravo dole. Úplně ho vypneš pravým klikem na ikonu → Ukončit."), ToolTipIcon.Info);
                settings.TrayHintShown = true;
                settings.Save();
            }
            return;
        }

        SetHotkeys(false);
        keyHook.Dispose();
        augTimer.Stop();
        foreach (var l in augLabels) l.Close();
        overlay?.Close();
        panel?.Close();
        lcu.Dispose();
        liveGame.Dispose();
        tray.Visible = false;
        tray.Dispose();
        base.OnFormClosing(e);
    }

    void SaveWindow()
    {
        var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        try
        {
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(WindowFile, JsonSerializer.Serialize(
                new SavedWindow(b.X, b.Y, b.Width, b.Height, WindowState == FormWindowState.Maximized)));
        }
        catch { /* nevadí */ }
    }

    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    const int DWMWA_CAPTION_COLOR = 35;
    const int WM_HOTKEY = 0x0312;
    const uint MOD_CONTROL = 0x2, MOD_SHIFT = 0x4, MOD_NOREPEAT = 0x4000;

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("user32.dll")]
    static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);

    [DllImport("user32.dll")]
    static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    delegate void WinEventDelegate(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    const uint EVENT_SYSTEM_FOREGROUND = 0x0003, EVENT_OBJECT_REORDER = 0x8004, WINEVENT_OUTOFCONTEXT = 0;
    const uint GW_HWNDNEXT = 2;

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmod, WinEventDelegate proc, uint processId, uint threadId, uint flags);

    [DllImport("user32.dll")]
    static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll")]
    static extern IntPtr GetTopWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
