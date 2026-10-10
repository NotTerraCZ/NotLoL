using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NotLoL;

/// <summary>
/// Herní panel (Ctrl+X): větší okno nad hrou se všemi hráči, jejich ranky a tvým buildem.
/// Obsah vykresluje web/ingame.html, data posílá MainForm. Okno nebere hře fokus.
/// </summary>
sealed class InGameForm : Form
{
    static readonly Color Bg = Color.FromArgb(10, 13, 22);
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Bg };
    readonly CoreWebView2Environment env;
    readonly List<string> pending = [];
    bool ready;
    bool initStarted;

    public event Action? CloseRequested;

    public InGameForm(CoreWebView2Environment env)
    {
        this.env = env;
        Text = "NotLoL – herní panel";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Bg;
        Controls.Add(web);
    }

    const int WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation => true;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int round = 2; // DWMWCP_ROUND
        DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (initStarted) return;
        initStarted = true;
        try
        {
            await web.EnsureCoreWebView2Async(env);
        }
        catch
        {
            return;
        }
        var core = web.CoreWebView2;
        WebAssets.Attach(core);
        core.WebMessageReceived += (_, args) =>
        {
            string? type = null;
            try { type = JsonNode.Parse(args.WebMessageAsJson)?["type"]?.GetValue<string>(); } catch { }
            if (type == "ready")
            {
                ready = true;
                foreach (var json in pending) core.PostWebMessageAsJson(json);
                pending.Clear();
            }
            else if (type == "close")
            {
                CloseRequested?.Invoke();
            }
            else if (type == "focus")
            {
                ActivateForTyping();
            }
        };
        core.Navigate(WebAssets.Origin + "ingame.html");
    }

    public void Post(object message)
    {
        var json = JsonSerializer.Serialize(message, Json);
        if (!ready)
        {
            pending.Add(json);
            if (pending.Count > 40) pending.RemoveAt(0);
            return;
        }
        try { web.CoreWebView2?.PostWebMessageAsJson(json); }
        catch { /* okno se zavírá */ }
    }

    /// <summary>Zobrazí panel uprostřed obrazovky, na které běží hra.</summary>
    public void ShowOn(Screen? screen)
    {
        var area = (screen ?? Screen.PrimaryScreen)?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
        int w = Math.Min((int)(area.Width * 0.72), area.Width - 40);
        int h = Math.Min((int)(area.Height * 0.74), area.Height - 40);
        Bounds = new Rectangle(area.X + (area.Width - w) / 2, area.Y + (area.Height - h) / 2, w, h);
        if (!Visible) Show();
        // Okno hry je samo "vždy navrchu" – shození a znovu nastavení TOPMOST nás dostane nad něj
        SetWindowPos(Handle, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_FLAGS);
        SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS | SWP_SHOWWINDOW);
    }

    /// <summary>
    /// Kliknutí do vyhledávání karet: panel normálně nebere hře focus, ale na psaní ho potřebuje.
    /// Po zavření panelu se zase vrátí do režimu "nebrat focus".
    /// </summary>
    void ActivateForTyping()
    {
        int ex = GetWindowLong(Handle, GWL_EXSTYLE);
        SetWindowLong(Handle, GWL_EXSTYLE, ex & ~WS_EX_NOACTIVATE);
        SetForegroundWindow(Handle);
        web.Focus();
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (!Visible && IsHandleCreated)
            SetWindowLong(Handle, GWL_EXSTYLE, GetWindowLong(Handle, GWL_EXSTYLE) | WS_EX_NOACTIVATE);
    }

    const int GWL_EXSTYLE = -20;
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

    /// <summary>Hra si při focusu vrací své okno navrch, proto to MainForm volá pořád dokola.</summary>
    public void KeepOnTop()
    {
        if (Visible) SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS);
    }

    static readonly IntPtr HWND_TOPMOST = new(-1), HWND_NOTOPMOST = new(-2);
    const uint SWP_FLAGS = 0x0001 | 0x0002 | 0x0010; // NOSIZE | NOMOVE | NOACTIVATE
    const uint SWP_SHOWWINDOW = 0x0040;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
