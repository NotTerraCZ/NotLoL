using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NotLoL;

/// <summary>
/// Herní overlay: malé okno vždy navrchu, myš jím prochází (nepřekáží ve hře).
/// Ukazuje, kterou schopnost vylepšit, a core build s odškrtnutými koupenými itemy.
/// Funguje, když hra běží v režimu okna „Bez okrajů“ (v exkluzivním fullscreenu ho Windows nevykreslí).
/// </summary>
sealed class OverlayForm : Form
{
    const int LogicalWidth = 300;
    static readonly string PositionFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NotLoL", "overlay.json");
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    // Barvy ve stylu rozhraní (tmavé pozadí, neonové zvýraznění)
    static readonly Color Bg = Color.FromArgb(16, 13, 21);
    static readonly Color Line = Color.FromArgb(46, 39, 57);
    static readonly Color Fg = Color.FromArgb(242, 240, 247);
    static readonly Color Muted = Color.FromArgb(155, 147, 172);
    static readonly Color Hint = Color.FromArgb(104, 96, 121);
    static readonly Color Ink = Color.FromArgb(13, 11, 18); // text na barevných štítcích
    static readonly Color Good = Color.FromArgb(62, 224, 160);

    /// <summary>Barvy zvýraznění z Nastavení → Vzhled (stejné jako ve style.css).</summary>
    public static readonly Dictionary<string, Color> Accents = new()
    {
        ["red"] = Color.FromArgb(250, 30, 78),
        ["orange"] = Color.FromArgb(255, 122, 26),
        ["blue"] = Color.FromArgb(108, 140, 255),
        ["hextech"] = Color.FromArgb(31, 195, 217),
        ["violet"] = Color.FromArgb(159, 123, 255),
        ["gold"] = Color.FromArgb(214, 173, 85),
        ["rose"] = Color.FromArgb(255, 92, 138),
        ["emerald"] = Color.FromArgb(44, 207, 150),
    };
    Color accentColor = Accents["red"];
    static readonly Dictionary<string, Color> SkillColors = new()
    {
        ["Q"] = Color.FromArgb(108, 140, 255),
        ["W"] = Color.FromArgb(79, 209, 139),
        ["E"] = Color.FromArgb(255, 154, 60),
        ["R"] = Color.FromArgb(255, 78, 90),
    };

    // Step, Note a Tier: pořadí nákupu, cena a tier itemu pro hrdinu (Deadlock; TierCls = barva jako v rozhraní)
    sealed record Pic(int Id, string Name, string Url, string Rarity = "", int Step = 0, string Note = "", string Tier = "", string TierCls = "");

    static readonly Dictionary<string, Color> RarityColors = new()
    {
        ["kPrismatic"] = Color.FromArgb(197, 139, 255),
        ["kGold"] = Color.FromArgb(242, 193, 78),
        ["kSilver"] = Color.FromArgb(183, 189, 207),
        // Deadlock: typ itemu (zbraň, vitalita, duch)
        ["weapon"] = Color.FromArgb(232, 145, 60),
        ["vitality"] = Color.FromArgb(124, 194, 68),
        ["spirit"] = Color.FromArgb(176, 125, 219),
    };
    // Deadlock: fáze pořadí nákupu (stejné barvy na stránce hrdiny a u čísel v obchodě) a cena v duších
    public static readonly Dictionary<string, Color> PhaseColors = new()
    {
        ["early"] = Color.FromArgb(62, 224, 160),
        ["mid"] = Color.FromArgb(242, 193, 78),
        ["late"] = Color.FromArgb(255, 92, 138),
    };
    static readonly Color Souls = Color.FromArgb(127, 214, 194);

    sealed class Build
    {
        public string Name = "", Subtitle = "", Icon = "", Priority = "";
        public string[] Order = [];
        public Dictionary<string, string> SkillIcons = new();
        public List<Pic> Start = [], Core = [], Next = [], Spells = [], Augments = [], Prism = [];
        // Seznamy s názvy (Deadlock: pořadí nákupu po fázích early / mid / late) – [{label, phase, items}]
        public List<(string Label, string Phase, List<Pic> Items)> Lists = [];
        public Pic? Keystone;

        public Build(JsonNode n)
        {
            Name = Str(n["champion"]?["name"]);
            Icon = Str(n["champion"]?["icon"]);
            Subtitle = Str(n["subtitle"]);
            Priority = Str(n["skills"]?["priority"]);
            Order = n["skills"]?["order"]?.AsArray().Select(Str).ToArray() ?? [];
            foreach (var kv in n["skills"]?["icons"]?.AsObject() ?? new JsonObject()) SkillIcons[kv.Key] = Str(kv.Value);
            Start = Pics(n["start"]);
            Core = Pics(n["core"]);
            Next = Pics(n["next"]);
            Spells = Pics(n["spells"]);
            Augments = Pics(n["augments"]);
            Prism = Pics(n["prism"]);
            foreach (var l in n["lists"]?.AsArray().OfType<JsonNode>() ?? [])
                Lists.Add((Str(l["label"]), Str(l["phase"]), Pics(l["items"])));
            var k = n["keystone"];
            if (k != null) Keystone = new Pic(0, Str(k["name"]), Str(k["icon"]));
        }

        public IEnumerable<string> Urls() =>
            new[] { Icon, Keystone?.Url ?? "" }.Concat(SkillIcons.Values)
                .Concat(Start.Concat(Core).Concat(Next).Concat(Spells).Concat(Augments).Concat(Prism).Concat(Lists.SelectMany(l => l.Items)).Select(p => p.Url))
                .Where(u => u.Length > 0).Distinct();

        static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
        static List<Pic> Pics(JsonNode? n) => n?.AsArray().OfType<JsonNode>()
            .Select(p => new Pic(p["id"] is JsonValue v && v.TryGetValue<int>(out var id) ? id : 0, Str(p["name"]), Str(p["icon"]), Str(p["rarity"]),
                p["step"] is JsonValue sv && sv.TryGetValue<int>(out var step) ? step : 0, Str(p["note"]), Str(p["tier"]), Str(p["cls"])))
            .ToList() ?? [];
    }

    Build? build;
    LiveGame.Snapshot? live;
    bool moveMode;
    readonly Dictionary<string, Image?> images = new();

    public bool HasBuild => build != null;

    public OverlayForm()
    {
        Text = "NotLoL overlay";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Bg;
        Opacity = 0.93; // zároveň z okna dělá "layered", takže jím může procházet myš
        DoubleBuffered = true;
        RestorePosition();
    }

    // ---------- Okno ----------

    const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            if (!moveMode) cp.ExStyle |= WS_EX_TRANSPARENT; // klikání projde do hry
            return cp;
        }
    }

    protected override bool ShowWithoutActivation => true;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int round = 3; // DWMWCP_ROUNDSMALL – ostřejší rohy jako v rozhraní
        DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        Relayout();
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Relayout();
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        Relayout();
    }

    public void SetAccent(string? name)
    {
        var color = Accents.GetValueOrDefault(name ?? "", Accents["red"]);
        if (color == accentColor) return;
        accentColor = color;
        Invalidate();
    }

    public void ToggleMoveMode() => SetMoveMode(!moveMode);

    public void SetMoveMode(bool on)
    {
        if (on == moveMode) return;
        moveMode = on;
        UpdateStyles();
        if (!moveMode) SavePosition();
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (!moveMode || e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, 0xA1 /* WM_NCLBUTTONDOWN */, 2 /* HTCAPTION */, 0);
    }

    public void KeepOnTop()
    {
        if (Visible) SetWindowPos(Handle, new IntPtr(-1) /* HWND_TOPMOST */, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 /* NOSIZE|NOMOVE|NOACTIVATE */);
    }

    // ---------- Data ----------

    public void SetBuild(JsonNode? node)
    {
        build = node == null ? null : new Build(node);
        foreach (var url in build?.Urls() ?? []) _ = LoadImageAsync(url);
        Relayout();
        Invalidate();
    }

    public void SetLive(LiveGame.Snapshot snap)
    {
        var old = live;
        live = snap;
        bool startChanged = (old?.GameTime < 150) != (snap.GameTime < 150);
        if (old == null || startChanged || old.Level != snap.Level || !old.Items.SetEquals(snap.Items)
            || !old.Skills.OrderBy(k => k.Key).SequenceEqual(snap.Skills.OrderBy(k => k.Key)))
        {
            if (startChanged) Relayout();
            Invalidate();
        }
    }

    async Task LoadImageAsync(string url)
    {
        if (images.ContainsKey(url)) return;
        images[url] = null;
        try
        {
            var bytes = await Http.GetByteArrayAsync(url);
            using var ms = new MemoryStream(bytes);
            using var src = Image.FromStream(ms);
            images[url] = new Bitmap(src);
            Invalidate();
        }
        catch { /* ikona se nevykreslí, nevadí */ }
    }

    // ---------- Vykreslení ----------

    float S => DeviceDpi / 96f;
    int Px(float v) => (int)Math.Round(v * S);

    void Relayout()
    {
        if (!IsHandleCreated) return;
        ClientSize = new Size(Px(LogicalWidth), Px(Draw(null)));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        g.ScaleTransform(S, S);
        Draw(g);
        g.ResetTransform();
        using var border = new Pen(moveMode ? accentColor : Line, moveMode ? 2 : 1) { DashStyle = moveMode ? DashStyle.Dash : DashStyle.Solid };
        g.DrawRectangle(border, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        // Neonový proužek nahoře a zkosený roh vlevo nahoře
        g.SmoothingMode = SmoothingMode.None;
        using var accent = new SolidBrush(accentColor);
        int stripe = Math.Max(2, Px(2));
        g.FillRectangle(accent, 0, 0, ClientSize.Width, stripe);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float c = Px(14);
        g.FillPolygon(accent, new[] { new PointF(0, 0), new PointF(c, 0), new PointF(0, c) });
    }

    /// <summary>Vykreslí obsah (g == null jen změří) a vrátí výšku v logických pixelech.</summary>
    float Draw(Graphics? g)
    {
        const float pad = 12, w = LogicalWidth;
        using var fTitle = new Font("Segoe UI", 15, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fText = new Font("Segoe UI", 12, FontStyle.Regular, GraphicsUnit.Pixel);
        using var fBold = new Font("Segoe UI", 13, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fSmall = new Font("Segoe UI", 10, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fCell = new Font("Segoe UI", 9, FontStyle.Bold, GraphicsUnit.Pixel);

        if (build == null)
        {
            DrawText(g, Loc.T("ovLoading", "NotLoL: načítám build…"), fText, Muted, pad, pad);
            return 40;
        }
        var b = build;
        float y = pad;

        // Hlavička: šampion, role, runa a kouzla
        DrawImage(g, b.Icon, pad, y, 36);
        DrawText(g, b.Name, fTitle, Fg, pad + 44, y - 1);
        DrawText(g, b.Subtitle, fText, Muted, pad + 44, y + 19);
        float x = w - pad;
        foreach (var sp in Enumerable.Reverse(b.Spells))
        {
            x -= 22;
            DrawImage(g, sp.Url, x, y + 7, 22, 4);
            x -= 4;
        }
        if (b.Keystone != null)
        {
            x -= 28;
            DrawImage(g, b.Keystone.Url, x, y + 4, 28, 14);
        }
        y += 46;
        Separator(g, pad, y, w);
        y += 8;

        // Schopnosti
        if (b.Order.Length > 0)
        {
            int level = live?.Level ?? 1;
            int spent = live?.Skills.Values.Sum() ?? 0;
            bool pending = live != null && spent < level;
            int idx = live == null ? 0 : pending ? spent : level;
            string? next = idx < b.Order.Length ? b.Order[idx] : null;

            DrawText(g, Loc.T("ovSkills", "SCHOPNOSTI"), fSmall, Muted, pad, y);
            y += 16;
            if (next != null)
            {
                DrawSkill(g, b, next, pad, y, 32, fSmall);
                var head = live == null ? Loc.T("ovFirst", "1. úroveň: {0}", next)
                    : pending ? Loc.T("ovNow", "Teď vylepši {0}", next)
                    : Loc.T("ovAt", "Na {0}. úrovni: {1}", Math.Min(level + 1, 18), next);
                DrawText(g, head, fBold, pending ? Good : Fg, pad + 42, y);
            }
            else
            {
                DrawText(g, Loc.T("ovDone", "Všechno vylepšeno"), fBold, Fg, pad, y);
            }
            if (b.Priority.Length > 0)
                DrawText(g, Loc.T("ovPriority", "Priorita: {0}", string.Join(" › ", b.Priority.ToCharArray())), fText, Muted, pad + (next != null ? 42 : 0), y + 17);
            y += 40;

            // Pás 18 úrovní
            float cw = (w - 2 * pad) / 18f;
            for (int i = 0; i < 18 && i < b.Order.Length; i++)
            {
                var key = b.Order[i];
                var col = SkillColors.GetValueOrDefault(key, Muted);
                bool done = live != null && i < spent;
                bool current = live != null && i == idx;
                var rect = new RectangleF(pad + i * cw + 1, y, cw - 2, 17);
                if (g != null)
                {
                    using var brush = new SolidBrush(Color.FromArgb(done ? 60 : 200, col));
                    FillRounded(g, brush, rect, 3);
                    if (current)
                    {
                        using var pen = new Pen(Color.White, 1.5f);
                        g.DrawRectangle(pen, rect.X, rect.Y, rect.Width, rect.Height);
                    }
                    using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                    using var tb = new SolidBrush(done ? Muted : Ink);
                    g.DrawString(key, fCell, tb, rect, sf);
                }
            }
            y += 25;
            Separator(g, pad, y, w);
            y += 8;
        }

        // Augmenty (Arena, ARAM: Mayhem) – ikona s rámečkem podle vzácnosti + název,
        // ať jde při výběru karet hned poznat, kterou vzít
        if (b.Augments.Count > 0)
        {
            DrawText(g, Loc.T("ovAugments", "NEJLEPŠÍ AUGMENTY"), fSmall, Muted, pad, y);
            y += 17;
            foreach (var a in b.Augments)
            {
                DrawImage(g, a.Url, pad, y, 24, 5);
                var color = RarityColors.GetValueOrDefault(a.Rarity, Line);
                if (g != null)
                {
                    using var pen = new Pen(color, 2f);
                    using var path = Rounded(new RectangleF(pad, y, 24, 24), 5);
                    g.DrawPath(pen, path);
                }
                DrawText(g, a.Name, fText, Fg, pad + 32, y + 4);
                y += 28;
            }
            y += 6;
        }

        // Arena: nejlepší prizmatické itemy
        if (b.Prism.Count > 0)
        {
            DrawText(g, Loc.T("ovPrism", "PRIZMATICKÉ ITEMY"), fSmall, Muted, pad, y);
            y += 17;
            foreach (var it in b.Prism)
            {
                bool owned = live?.Items.Contains(it.Id) == true;
                DrawImage(g, it.Url, pad, y, 24, 5, owned ? 0.45f : 1f);
                if (g != null)
                {
                    using var pen = new Pen(RarityColors["kPrismatic"], 2f);
                    using var path = Rounded(new RectangleF(pad, y, 24, 24), 5);
                    g.DrawPath(pen, path);
                }
                DrawText(g, (owned ? "✓ " : "") + it.Name, fText, owned ? Good : Fg, pad + 32, y + 4);
                y += 28;
            }
            y += 6;
        }

        // Pořadí nákupu (Deadlock): číslo kroku v barvě fáze, ikona s rámečkem v barvě typu itemu, název a cena
        foreach (var (label, phase, items) in b.Lists)
        {
            var pc = PhaseColors.GetValueOrDefault(phase, Muted);
            DrawText(g, label, fSmall, pc, pad, y);
            y += 17;
            foreach (var it in items)
            {
                float ix = pad;
                if (it.Step > 0)
                {
                    DrawTextIn(g, it.Step.ToString(), fBold, pc, new RectangleF(pad, y, 22, 24), StringAlignment.Center);
                    ix += 26;
                }
                DrawImage(g, it.Url, ix, y, 24, 4);
                if (g != null)
                {
                    using var pen = new Pen(RarityColors.GetValueOrDefault(it.Rarity, Line), 2f);
                    using var path = Rounded(new RectangleF(ix, y, 24, 24), 4);
                    g.DrawPath(pen, path);
                }
                // Vpravo cena a před ní tier
                float right = w - pad;
                float noteW = it.Note.Length > 0 && g != null ? g.MeasureString(it.Note, fText).Width : 0;
                if (noteW > 0)
                {
                    DrawTextIn(g, it.Note, fText, Souls, new RectangleF(right - noteW, y, noteW, 24), StringAlignment.Far);
                    right -= noteW + 6;
                }
                if (it.Tier.Length > 0)
                {
                    var tc = AugmentLabelForm.TierColors.GetValueOrDefault(it.TierCls, Muted);
                    var badge = new RectangleF(right - 24, y + 4, 24, 16);
                    if (g != null)
                    {
                        using var brush = new SolidBrush(tc);
                        using var path = Rounded(badge, 3);
                        g.FillPath(brush, path);
                    }
                    DrawTextIn(g, it.Tier, fSmall, Ink, badge, StringAlignment.Center);
                    right -= 24 + 6;
                }
                DrawTextIn(g, it.Name, fText, Fg, new RectangleF(ix + 32, y, right - (ix + 32), 24), StringAlignment.Near);
                y += 28;
            }
            y += 6;
        }

        // Itemy
        bool early = live == null || live.GameTime < 150;
        if (early && b.Start.Count > 0) y = ItemRow(g, Loc.T("ovStart", "START"), b.Start, pad, y, 28, fSmall);
        if (b.Core.Count > 0) y = ItemRow(g, Loc.T("ovCore", "CORE BUILD"), b.Core, pad, y, 36, fSmall);
        if (b.Next.Count > 0) y = ItemRow(g, Loc.T("ovNext", "DALŠÍ ITEMY"), b.Next, pad, y, 32, fSmall);

        string hide = Hotkeys.Get(Hotkeys.Overlay).Label, move = Hotkeys.Get(Hotkeys.Move).Label;
        var hint = moveMode ? Loc.T("ovHintMove", "Přetáhni myší · {0} hotovo", move) : Loc.T("ovHint", "{0} skrýt · {1} přesunout", hide, move);
        DrawText(g, hint, fSmall, moveMode ? accentColor : Hint, pad, y);
        return y + 14 + pad;
    }

    float ItemRow(Graphics? g, string label, List<Pic> items, float x0, float y, float size, Font fLabel)
    {
        DrawText(g, label, fLabel, Muted, x0, y);
        y += 16;
        float x = x0;
        foreach (var it in items)
        {
            if (x + size > LogicalWidth - x0) break;
            bool owned = live?.Items.Contains(it.Id) == true;
            DrawImage(g, it.Url, x, y, size, 5, owned ? 0.45f : 1f);
            if (owned && g != null)
            {
                float r = size * 0.34f;
                using var brush = new SolidBrush(Good);
                g.FillEllipse(brush, x + size - r - 1, y + size - r - 1, r, r);
                using var pen = new Pen(Ink, 2f);
                float cx = x + size - r - 1, cy = y + size - r - 1;
                g.DrawLines(pen, new[] { new PointF(cx + r * .25f, cy + r * .52f), new PointF(cx + r * .45f, cy + r * .72f), new PointF(cx + r * .78f, cy + r * .3f) });
            }
            x += size + 6;
        }
        return y + size + 10;
    }

    void DrawSkill(Graphics? g, Build b, string key, float x, float y, float size, Font f)
    {
        if (b.SkillIcons.TryGetValue(key, out var url)) DrawImage(g, url, x, y, size, 6);
        if (g == null) return;
        var badge = new RectangleF(x + size - 13, y + size - 13, 15, 15);
        using var brush = new SolidBrush(SkillColors.GetValueOrDefault(key, accentColor));
        FillRounded(g, brush, badge, 4);
        using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        using var tb = new SolidBrush(Ink);
        g.DrawString(key, f, tb, badge, sf);
    }

    void DrawImage(Graphics? g, string url, float x, float y, float size, float radius = 6, float alpha = 1f)
    {
        if (g == null) return;
        var rect = new RectangleF(x, y, size, size);
        using var path = Rounded(rect, radius);
        if (images.GetValueOrDefault(url) is Image img)
        {
            var clip = g.Clip;
            g.SetClip(path);
            if (alpha < 1f)
            {
                using var attrs = new System.Drawing.Imaging.ImageAttributes();
                attrs.SetColorMatrix(new System.Drawing.Imaging.ColorMatrix { Matrix33 = alpha });
                g.DrawImage(img, Rectangle.Round(rect), 0, 0, img.Width, img.Height, GraphicsUnit.Pixel, attrs);
            }
            else
            {
                g.DrawImage(img, rect);
            }
            g.Clip = clip;
        }
        else
        {
            using var brush = new SolidBrush(Line);
            g.FillPath(brush, path);
        }
    }

    static void DrawText(Graphics? g, string text, Font font, Color color, float x, float y)
    {
        if (g == null || text.Length == 0) return;
        using var brush = new SolidBrush(color);
        g.DrawString(text, font, brush, x, y);
    }

    // Jeden řádek v obdélníku, svisle na střed; co se nevejde, skončí „…“
    static void DrawTextIn(Graphics? g, string text, Font font, Color color, RectangleF rect, StringAlignment align)
    {
        if (g == null || text.Length == 0 || rect.Width <= 0) return;
        using var brush = new SolidBrush(color);
        using var fmt = new StringFormat(StringFormatFlags.NoWrap) { Alignment = align, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter };
        g.DrawString(text, font, brush, rect, fmt);
    }

    static void Separator(Graphics? g, float pad, float y, float w)
    {
        if (g == null) return;
        using var pen = new Pen(Line);
        g.DrawLine(pen, pad, y, w - pad, y);
    }

    static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var path = new GraphicsPath();
        float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
        if (d <= 0) { path.AddRectangle(r); return path; }
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    static void FillRounded(Graphics g, Brush brush, RectangleF r, float radius)
    {
        using var path = Rounded(r, radius);
        g.FillPath(brush, path);
    }

    // ---------- Pozice ----------

    sealed record SavedPosition(int X, int Y);

    void RestorePosition()
    {
        try
        {
            var p = JsonSerializer.Deserialize<SavedPosition>(File.ReadAllText(PositionFile));
            if (p != null && Screen.AllScreens.Any(s => s.WorkingArea.Contains(p.X + 20, p.Y + 20)))
            {
                Location = new Point(p.X, p.Y);
                return;
            }
        }
        catch { /* výchozí pozice */ }
        var area = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
        Location = new Point(area.Right - (int)(LogicalWidth * DeviceDpi / 96f) - 24, area.Top + (int)(area.Height * 0.3));
    }

    void SavePosition()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PositionFile)!);
            File.WriteAllText(PositionFile, JsonSerializer.Serialize(new SavedPosition(Left, Top)));
        }
        catch { /* nevadí */ }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            foreach (var img in images.Values) img?.Dispose();
        base.Dispose(disposing);
    }

    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
