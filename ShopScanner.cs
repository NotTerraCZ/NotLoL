using System.Drawing.Imaging;
using Windows.Globalization;
using Windows.Media.Ocr;

namespace NotLoL;

/// <summary>
/// Obchod v Deadlocku: hra nabídku itemů nikam neposílá, takže se vyfotí okno hry, přečte text (Windows OCR)
/// a porovná se s názvy itemů (v jazyce appky i anglicky). Stejný princip jako karty v LoL (AugmentScanner),
/// jen itemů je na obrazovce víc a jsou rozházené po celém obchodě.
/// </summary>
sealed class ShopScanner
{
    /// <summary>Nalezený item: id, obdélník jeho názvu v souřadnicích obrazovky (i dvouřádkového) a výška jednoho řádku.</summary>
    public sealed record Found(long Id, RectangleF Name, double Score, float LineHeight);

    readonly Dictionary<string, long> exact = new();
    readonly List<(string norm, long id)> names = new();
    OcrEngine? engine;

    public bool HasNames => names.Count > 0;

    public void SetNames(IEnumerable<(long id, string name)> list)
    {
        exact.Clear();
        names.Clear();
        foreach (var (id, name) in list)
        {
            var n = AugmentScanner.Norm(name);
            if (n.Length < 3 || exact.ContainsKey(n)) continue;
            exact[n] = id;
            names.Add((n, id));
        }
    }

    // Jazyk Windows (hra ho většinou používá taky), jinak angličtina
    OcrEngine? Engine() =>
        engine ??= OcrEngine.TryCreateFromUserProfileLanguages() ?? OcrEngine.TryCreateFromLanguage(new Language("en-US"));

    /// <summary>
    /// Přečte názvy itemů v okně hry. Null = žádný item (obchod je zavřený). Text v <paramref name="exclude"/> (okna
    /// NotLoL – overlay s pořadím nákupu má stejné názvy itemů) se přeskočí, jinak by čísla skákala i na ně.
    /// </summary>
    public async Task<List<Found>?> ScanAsync(Rectangle screen, IReadOnlyList<Rectangle> exclude)
    {
        if (names.Count == 0 || Engine() is not { } ocrEngine) return null;
        if (screen.Width < 400 || screen.Height < 300) return null;

        // Písmo v obchodě je malé – zmenšuje se jen nad 1440 px výšky
        float scale = screen.Height > 1440 ? 1440f / screen.Height : 1f;
        int w = Math.Max(1, (int)(screen.Width * scale)), h = Math.Max(1, (int)(screen.Height * scale));
        Windows.Graphics.Imaging.SoftwareBitmap sb;
        using (var shot = new Bitmap(w, h, PixelFormat.Format32bppPArgb))
        {
            using (var g = Graphics.FromImage(shot))
            {
                if (scale == 1f)
                {
                    g.CopyFromScreen(screen.Location, Point.Empty, screen.Size);
                }
                else
                {
                    using var full = new Bitmap(screen.Width, screen.Height, PixelFormat.Format32bppPArgb);
                    using (var fg = Graphics.FromImage(full)) fg.CopyFromScreen(screen.Location, Point.Empty, screen.Size);
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                    g.DrawImage(full, 0, 0, w, h);
                }
            }
            sb = AugmentScanner.ToSoftwareBitmap(shot);
        }

        OcrResult ocr;
        using (sb) ocr = await ocrEngine.RecognizeAsync(sb);

        // Řádky textu → úseky (velká mezera mezi slovy = jiný item) v souřadnicích obrazovky
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
                    split = b.X - (a.X + a.Width) > Math.Max(a.Height, b.Height) * 1.6;
                }
                if (!split) continue;
                var part = words.Skip(start).Take(i - start).ToList();
                start = i;
                float x0 = (float)part.Min(x => x.BoundingRect.X), y0 = (float)part.Min(x => x.BoundingRect.Y);
                float x1 = (float)part.Max(x => x.BoundingRect.X + x.BoundingRect.Width);
                float y1 = (float)part.Max(x => x.BoundingRect.Y + x.BoundingRect.Height);
                var rect = new RectangleF(screen.X + x0 / scale, screen.Y + y0 / scale, (x1 - x0) / scale, (y1 - y0) / scale);
                if (rect.Height < screen.Height * 0.007f) continue; // drobné popisky a čísla
                if (exclude.Any(e => e.IntersectsWith(Rectangle.Round(rect)))) continue;
                segs.Add((AugmentScanner.Norm(string.Join(" ", part.Select(x => x.Text))), rect));
            }
        }

        // Kandidáti: úseky + dvojice pod sebou (dlouhý název na dva řádky); každý item jen jednou (nejjistější)
        var best = new Dictionary<long, Found>();
        void Add(string norm, RectangleF rect, float lineHeight)
        {
            var (id, score) = Match(norm);
            if (id < 0) return;
            if (!best.TryGetValue(id, out var old) || score > old.Score) best[id] = new Found(id, rect, score, lineHeight);
        }
        for (int i = 0; i < segs.Count; i++)
        {
            Add(segs[i].norm, segs[i].rect, segs[i].rect.Height);
            for (int j = 0; j < segs.Count; j++)
            {
                if (j == i) continue;
                var (ra, rb) = (segs[i].rect, segs[j].rect);
                float lh = Math.Max(ra.Height, rb.Height);
                bool below = rb.Top > ra.Top && rb.Top - ra.Bottom < lh * 0.9f;
                bool aligned = Math.Abs((ra.Left + ra.Right) / 2 - (rb.Left + rb.Right) / 2) < Math.Max(ra.Width, rb.Width) * 0.6f;
                if (below && aligned) Add(segs[i].norm + segs[j].norm, RectangleF.Union(ra, rb), lh);
            }
        }

        // Dva nálezy na stejném místě (název i jeho kus) – nech jistější
        var found = new List<Found>();
        foreach (var f in best.Values.OrderByDescending(f => f.Score))
            if (!found.Any(o => o.Name.IntersectsWith(f.Name))) found.Add(f);
        return found.Count == 0 ? null : found;
    }

    (long id, double score) Match(string norm)
    {
        if (norm.Length < 3) return (-1, 0);
        if (exact.TryGetValue(norm, out var e)) return (e, 1);
        if (norm.Length < 5) return (-1, 0);
        long id = -1;
        double score = 0;
        foreach (var (n, nid) in names)
        {
            if (Math.Abs(n.Length - norm.Length) > Math.Max(2, n.Length / 4)) continue;
            double s = 1 - (double)AugmentScanner.Levenshtein(norm, n) / Math.Max(norm.Length, n.Length);
            if (s > score) (score, id) = (s, nid);
        }
        return score >= (norm.Length >= 8 ? 0.8 : 0.88) ? (id, score) : (-1, 0);
    }
}
