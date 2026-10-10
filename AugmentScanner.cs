using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

namespace NotLoL;

/// <summary>
/// Pozná karty (augmenty), které hra zrovna nabízí (Arena, ARAM: Mayhem). Hra je nikam neposílá,
/// takže se vyfotí pás uprostřed obrazovky, kde jsou názvy karet, přečte se text (Windows OCR)
/// a porovná se s názvy augmentů (v jazyce hry i anglicky).
/// </summary>
sealed class AugmentScanner
{
    /// <summary>Nalezená karta: id augmentu a obdélník jejího názvu v souřadnicích obrazovky.</summary>
    public sealed record Card(int Id, RectangleF Name, double Score);

    /// <summary>Spacing = vzdálenost středů sousedních karet (podle ní se počítá velikost štítků).</summary>
    public sealed record Result(List<Card> Cards, float Spacing);

    readonly Dictionary<string, int> exact = new();
    readonly List<(string norm, int id)> names = new();
    OcrEngine? engine;
    string? engineFor;

    public bool HasNames => names.Count > 0;

    public void SetNames(IEnumerable<(int id, string name)> list)
    {
        exact.Clear();
        names.Clear();
        foreach (var (id, name) in list)
        {
            var n = Norm(name);
            if (n.Length < 3 || exact.ContainsKey(n)) continue;
            exact[n] = id;
            names.Add((n, id));
        }
    }

    /// <summary>OCR v jazyce hry ("cs_CZ"), jinak v jazycích Windows, jinak anglicky.</summary>
    public void SetLanguage(string? locale)
    {
        if (engine != null && engineFor == locale) return;
        engineFor = locale;
        engine = null;
        var tag = locale?.Replace('_', '-');
        foreach (var t in new[] { tag, tag?.Split('-')[0] })
        {
            if (string.IsNullOrEmpty(t)) continue;
            try
            {
                var lang = new Language(t);
                if (OcrEngine.IsLanguageSupported(lang)) engine = OcrEngine.TryCreateFromLanguage(lang);
            }
            catch { /* neplatný jazyk */ }
            if (engine != null) return;
        }
        engine = OcrEngine.TryCreateFromUserProfileLanguages() ?? OcrEngine.TryCreateFromLanguage(new Language("en-US"));
    }

    /// <summary>Přečte karty na dané obrazovce (obdélník okna hry). Null = žádná karta.</summary>
    public async Task<Result?> ScanAsync(Rectangle screen, Bitmap? testImage = null)
    {
        if (names.Count == 0) return null;
        if (engine == null) SetLanguage(engineFor);
        if (engine == null) return null;

        // Názvy karet jsou zhruba v polovině výšky obrazovky – stačí pás 28–66 % výšky, 6–94 % šířky
        var band = Rectangle.FromLTRB(
            screen.Left + screen.Width * 6 / 100, screen.Top + screen.Height * 28 / 100,
            screen.Right - screen.Width * 6 / 100, screen.Top + screen.Height * 66 / 100);
        if (band.Width < 100 || band.Height < 50) return null;

        // Velké rozlišení zmenšit (OCR je pak rychlejší a písmo má pořád dost pixelů)
        float scale = band.Height > 700 ? 700f / band.Height : 1f;
        int w = Math.Max(1, (int)(band.Width * scale)), h = Math.Max(1, (int)(band.Height * scale));
        SoftwareBitmap sb;
        using (var shot = new Bitmap(w, h, PixelFormat.Format32bppPArgb))
        {
            using (var g = Graphics.FromImage(shot))
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                if (testImage != null)
                {
                    var src = new Rectangle(band.X - screen.X, band.Y - screen.Y, band.Width, band.Height);
                    g.DrawImage(testImage, new Rectangle(0, 0, w, h), src, GraphicsUnit.Pixel);
                }
                else if (scale == 1f)
                {
                    g.CopyFromScreen(band.Location, Point.Empty, band.Size);
                }
                else
                {
                    using var full = new Bitmap(band.Width, band.Height, PixelFormat.Format32bppPArgb);
                    using (var fg = Graphics.FromImage(full)) fg.CopyFromScreen(band.Location, Point.Empty, band.Size);
                    g.DrawImage(full, 0, 0, w, h);
                }
            }
            sb = ToSoftwareBitmap(shot);
        }

        OcrResult ocr;
        using (sb) ocr = await engine.RecognizeAsync(sb);

        // Řádky textu → úseky (velká mezera mezi slovy = jiná karta) v souřadnicích obrazovky
        var segs = new List<(string norm, RectangleF rect)>();
        foreach (var line in ocr.Lines)
        {
            var words = line.Words.ToList();
            int start = 0;
            for (int i = 1; i <= words.Count; i++)
            {
                bool split = i == words.Count;
                if (!split)
                {
                    var a = words[i - 1].BoundingRect;
                    var b = words[i].BoundingRect;
                    split = b.X - (a.X + a.Width) > Math.Max(a.Height, b.Height) * 2.2;
                }
                if (!split) continue;
                var part = words.Skip(start).Take(i - start).ToList();
                start = i;
                var text = string.Join(" ", part.Select(x => x.Text));
                float x0 = (float)part.Min(x => x.BoundingRect.X), y0 = (float)part.Min(x => x.BoundingRect.Y);
                float x1 = (float)part.Max(x => x.BoundingRect.X + x.BoundingRect.Width);
                float y1 = (float)part.Max(x => x.BoundingRect.Y + x.BoundingRect.Height);
                var rect = new RectangleF(band.X + x0 / scale, band.Y + y0 / scale, (x1 - x0) / scale, (y1 - y0) / scale);
                // Názvy karet jsou velkým písmem – drobný text (lišty, chat, popisky jinde) ignoruj
                if (rect.Height < screen.Height * 0.011f) continue;
                segs.Add((Norm(text), rect));
            }
        }

        // Kandidáti: jednotlivé úseky + dvojice pod sebou (dlouhý název se může zalomit na dva řádky)
        var found = new List<Card>();
        for (int i = 0; i < segs.Count; i++)
        {
            Consider(segs[i].norm, segs[i].rect, found);
            for (int j = 0; j < segs.Count; j++)
            {
                if (j == i) continue;
                var (ra, rb) = (segs[i].rect, segs[j].rect);
                float lh = Math.Max(ra.Height, rb.Height);
                bool below = rb.Top > ra.Top && rb.Top - ra.Bottom < lh * 0.9f;
                bool aligned = Math.Abs((ra.Left + ra.Right) / 2 - (rb.Left + rb.Right) / 2) < Math.Max(ra.Width, rb.Width) * 0.6f;
                if (below && aligned) Consider(segs[i].norm + segs[j].norm, RectangleF.Union(ra, rb), found);
            }
        }
        if (found.Count == 0) return null;

        // Názvy karet jsou v jedné řadě: vezmi řadu s nejvíc nálezy
        float rowTol = screen.Height * 0.05f;
        var row = found
            .Select(c => found.Where(o => Math.Abs(CenterY(o) - CenterY(c)) < rowTol).ToList())
            .OrderByDescending(r => r.Select(c => c.Id).Distinct().Count()).ThenByDescending(r => r.Sum(c => c.Score))
            .First();

        // Jedna karta = jeden nález (nejlepší v daném sloupci)
        float colTol = screen.Width * 0.07f;
        var cards = new List<Card>();
        foreach (var c in row.OrderByDescending(c => c.Score))
        {
            if (cards.Any(o => Math.Abs(CenterX(o) - CenterX(c)) < colTol || o.Id == c.Id)) continue;
            cards.Add(c);
        }
        cards = cards.OrderBy(CenterX).Take(3).ToList();

        // Rozestup karet: karty se zvětšují s výškou obrazovky (~0,44 výšky); 1. a 3. karta = 2 rozestupy
        float expected = screen.Height * 0.44f;
        float spacing = expected;
        if (cards.Count >= 2)
        {
            float d = Enumerable.Range(1, cards.Count - 1).Min(i => CenterX(cards[i]) - CenterX(cards[i - 1]));
            float k = Math.Max(1, MathF.Round(d / expected));
            float s = d / k;
            if (s > screen.Height * 0.22f && s < screen.Height * 0.8f) spacing = s;
        }
        return new Result(cards, spacing);
    }

    static float CenterX(Card c) => c.Name.Left + c.Name.Width / 2;
    static float CenterY(Card c) => c.Name.Top + c.Name.Height / 2;

    void Consider(string norm, RectangleF rect, List<Card> found)
    {
        if (norm.Length < 3) return;
        int id = -1;
        double score = 0;
        if (exact.TryGetValue(norm, out var e))
        {
            id = e;
            score = 1;
        }
        else if (norm.Length >= 5)
        {
            foreach (var (n, nid) in names)
            {
                if (Math.Abs(n.Length - norm.Length) > Math.Max(2, n.Length / 4)) continue;
                double s = 1 - (double)Levenshtein(norm, n) / Math.Max(norm.Length, n.Length);
                if (s > score) (score, id) = (s, nid);
            }
            double min = norm.Length >= 8 ? 0.78 : 0.86;
            if (score < min) id = -1;
        }
        if (id >= 0) found.Add(new Card(id, rect, score));
    }

    // Malá písmena bez diakritiky, jen písmena a číslice ("Quest: Ritus des…" → "questritusdes…")
    public static string Norm(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            var c = char.ToLowerInvariant(ch);
            if (c == 'ł') c = 'l';
            if (char.IsLetterOrDigit(c)) sb.Append(c);
        }
        return sb.ToString();
    }

    static int Levenshtein(string a, string b)
    {
        var prev = new int[b.Length + 1];
        var cur = new int[b.Length + 1];
        for (int j = 0; j <= b.Length; j++) prev[j] = j;
        for (int i = 1; i <= a.Length; i++)
        {
            cur[0] = i;
            for (int j = 1; j <= b.Length; j++)
                cur[j] = Math.Min(Math.Min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            (prev, cur) = (cur, prev);
        }
        return prev[b.Length];
    }

    static SoftwareBitmap ToSoftwareBitmap(Bitmap bmp)
    {
        var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
        try
        {
            var bytes = new byte[data.Stride * bmp.Height];
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
            // Stride = šířka * 4 (32bpp), takže buffer odpovídá přímo Bgra8
            return SoftwareBitmap.CreateCopyFromBuffer(bytes.AsBuffer(), BitmapPixelFormat.Bgra8, bmp.Width, bmp.Height, BitmapAlphaMode.Premultiplied);
        }
        finally
        {
            bmp.UnlockBits(data);
        }
    }
}
