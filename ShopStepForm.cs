using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace NotLoL;

/// <summary>
/// Číslo kroku z pořadí nákupu nad názvem itemu v obchodě Deadlocku (1 = kupuje se první) v barvě fáze
/// (early / mid / late – stejné barvy jako overlay a stránka hrdiny). Kliknutí prochází do hry.
/// </summary>
sealed class ShopStepForm : Form
{
    static readonly Color Ink = Color.FromArgb(13, 11, 18);

    int step;
    string phase = "";

    public ShopStepForm()
    {
        Text = "NotLoL shop";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Ink;
        Opacity = 0.96; // layered okno – myš jím prochází (WS_EX_TRANSPARENT)
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

    public void SetContent(int step, string phase)
    {
        if (this.step == step && this.phase == phase) return;
        (this.step, this.phase) = (step, phase);
        Invalidate();
    }

    public void KeepOnTop()
    {
        if (Visible) SetWindowPos(Handle, new IntPtr(-1) /* HWND_TOPMOST */, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 /* NOSIZE|NOMOVE|NOACTIVATE */);
    }

    // Zkosené rohy (vlevo nahoře a vpravo dole) jako čísla kroků v rozhraní
    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        float c = Math.Max(3, Height * 0.22f);
        using var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(c, 0), new PointF(Width, 0), new PointF(Width, Height - c),
            new PointF(Width - c, Height), new PointF(0, Height), new PointF(0, c),
        });
        var old = Region;
        Region = new Region(path);
        old?.Dispose();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        var color = OverlayForm.PhaseColors.GetValueOrDefault(phase, Color.FromArgb(155, 147, 172));
        // Tmavý okraj, ať je číslo vidět i na světlých kartách obchodu
        float b = Math.Max(1.5f, Height / 14f);
        using (var brush = new SolidBrush(color))
            g.FillRectangle(brush, b, b, Width - 2 * b, Height - 2 * b);
        using var font = new Font("Segoe UI", Math.Max(9f, Height * (step >= 10 ? 0.5f : 0.58f)), FontStyle.Bold, GraphicsUnit.Pixel);
        using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        using var ink = new SolidBrush(Ink);
        g.DrawString(step.ToString(), font, ink, new RectangleF(0, 0, Width, Height + 1), sf);
    }

    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
