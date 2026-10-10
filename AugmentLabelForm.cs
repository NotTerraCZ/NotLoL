using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace NotLoL;

/// <summary>
/// Štítek ve spodní části nabízené karty: tier, jak je karta dobrá pro tvého šampiona a statistika.
/// Nejlepší karta z nabídky má zlatý rámeček. Kliknutí prochází do hry.
/// </summary>
sealed class AugmentLabelForm : Form
{
    static readonly Color Bg = Color.FromArgb(11, 15, 26);
    static readonly Color Fg = Color.FromArgb(237, 240, 247);
    static readonly Color Muted = Color.FromArgb(150, 160, 186);
    static readonly Color Gold = Color.FromArgb(240, 200, 100);
    static readonly Dictionary<string, Color> TierColors = new()
    {
        ["splus"] = Color.FromArgb(255, 78, 90),
        ["s"] = Color.FromArgb(255, 154, 60),
        ["a"] = Color.FromArgb(79, 157, 255),
        ["b"] = Color.FromArgb(79, 209, 139),
        ["c"] = Color.FromArgb(183, 189, 207),
        ["d"] = Color.FromArgb(122, 128, 153),
    };

    string tier = "", cls = "none", verdict = "", stat = "";
    bool best;

    public AugmentLabelForm()
    {
        Text = "NotLoL augment";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Bg;
        Opacity = 0.95; // layered okno – myš jím prochází (WS_EX_TRANSPARENT)
        DoubleBuffered = true;
    }

    const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT;
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

    public void SetContent(string tier, string cls, string verdict, string stat, bool best)
    {
        if (this.tier == tier && this.cls == cls && this.verdict == verdict && this.stat == stat && this.best == best) return;
        (this.tier, this.cls, this.verdict, this.stat, this.best) = (tier, cls, verdict, stat, best);
        Invalidate();
    }

    public void KeepOnTop()
    {
        if (Visible) SetWindowPos(Handle, new IntPtr(-1) /* HWND_TOPMOST */, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 /* NOSIZE|NOMOVE|NOACTIVATE */);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        float W = ClientSize.Width, H = ClientSize.Height;
        var tc = TierColors.GetValueOrDefault(cls, Color.FromArgb(93, 101, 130));

        // Rámeček: nejlepší karta zlatě, ostatní barvou tieru
        using (var pen = new Pen(best ? Gold : Color.FromArgb(170, tc), best ? Math.Max(2f, H / 22f) : Math.Max(1.5f, H / 40f)))
            g.DrawRectangle(pen, pen.Width / 2, pen.Width / 2, W - pen.Width, H - pen.Width);

        // Odznak s tierem
        float pad = H * 0.14f, side = H - 2 * pad;
        var badge = new RectangleF(pad, pad, side * 1.08f, side);
        using (var path = Rounded(badge, side * 0.22f))
        using (var brush = new LinearGradientBrush(badge, Lighter(tc), tc, 60f))
            g.FillPath(brush, path);
        using (var fTier = new Font("Segoe UI", Math.Max(8f, side * (tier.Length > 1 ? 0.38f : 0.46f)), FontStyle.Bold, GraphicsUnit.Pixel))
        using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
        using (var tb = new SolidBrush(Color.FromArgb(10, 13, 22)))
            g.DrawString(tier.Length > 0 ? tier : "–", fTier, tb, badge, sf);

        // Texty vpravo od odznaku
        float x = badge.Right + pad * 0.9f, tw = W - x - pad * 0.6f;
        using var fVerdict = new Font("Segoe UI", Math.Max(9f, H * 0.21f), FontStyle.Bold, GraphicsUnit.Pixel);
        using var fStat = new Font("Segoe UI", Math.Max(8f, H * 0.165f), FontStyle.Regular, GraphicsUnit.Pixel);
        using var fBest = new Font("Segoe UI", Math.Max(8f, H * 0.15f), FontStyle.Bold, GraphicsUnit.Pixel);
        using var fmt = new StringFormat(StringFormatFlags.NoWrap) { Trimming = StringTrimming.EllipsisCharacter, LineAlignment = StringAlignment.Near };

        float hv = fVerdict.GetHeight(g), hs = stat.Length > 0 ? fStat.GetHeight(g) : 0, hb = best ? fBest.GetHeight(g) : 0;
        float y = (H - (hb + hv + hs)) / 2;
        if (best)
        {
            using var gb = new SolidBrush(Gold);
            g.DrawString("★ " + Loc.T("augBest", "NEJLEPŠÍ VOLBA"), fBest, gb, new RectangleF(x, y, tw, hb), fmt);
            y += hb;
        }
        using (var fb = new SolidBrush(best ? Gold : Fg))
            g.DrawString(verdict, fVerdict, fb, new RectangleF(x, y, tw, hv), fmt);
        using (var mb = new SolidBrush(Muted))
            g.DrawString(stat, fStat, mb, new RectangleF(x, y + hv, tw, hs), fmt);
    }

    static Color Lighter(Color c) => Color.FromArgb(c.A, Math.Min(255, c.R + 40), Math.Min(255, c.G + 40), Math.Min(255, c.B + 40));

    static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var p = new GraphicsPath();
        float d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
