namespace NotLoL;

/// <summary>
/// Kde mají v obchodě Deadlocku být čísla kroků (čistá logika bez oken – dá se otestovat). Číslo sedí nad názvem
/// itemu (na spodku jeho ikony) a drží se na místě: OCR vrací pokaždé o pár pixelů jiný obdélník a občas item
/// přehlédne, takže malý posun se ignoruje a číslo vydrží jedno čtení bez itemu. Když se ale změnila skoro celá
/// nabídka (jiná záložka, posunutý obchod), čísla itemů, které zmizely, jdou pryč hned.
/// </summary>
sealed class ShopLabelLayout
{
    /// <summary>Přečtený item: id, obdélník názvu na obrazovce a výška jednoho řádku názvu.</summary>
    public sealed record Item(long Id, RectangleF Name, float LineHeight);

    readonly Dictionary<long, Rectangle> shown = new();
    readonly Dictionary<long, int> misses = new(); // kolik čtení po sobě item na obrazovce nebyl
    HashSet<long> lastSeen = [];
    int size;

    /// <summary>
    /// Další čtení obchodu. <paramref name="wanted"/> = itemy z pořadí nákupu (jen ty mají číslo). Vrátí, kde má
    /// které číslo být (id → obdélník na obrazovce); čísla, která ve výsledku nejsou, se schovají.
    /// </summary>
    public IReadOnlyDictionary<long, Rectangle> Update(IReadOnlyList<Item> found, Func<long, bool> wanted, int max = 24)
    {
        if (found.Count == 0)
        {
            Clear();
            return shown;
        }
        // Všechna čísla stejně velká podle písma v obchodě (medián výšky řádku – OCR občas jeden řádek nafoukne);
        // velikost se mění jen při znatelné změně, ne o pixel sem a tam
        var heights = found.Select(f => f.LineHeight).Order().ToList();
        int target = (int)Math.Clamp(heights[heights.Count / 2] * 1.8f, 20, 40);
        if (size == 0 || Math.Abs(target - size) > size * 0.2) size = target;
        int s = size;

        var seen = found.Select(f => f.Id).ToHashSet();
        bool newView = lastSeen.Count > 0 && seen.Count(lastSeen.Contains) < Math.Min(seen.Count, lastSeen.Count) / 2;
        lastSeen = seen;

        foreach (var f in found.Where(f => wanted(f.Id)).Take(max))
        {
            misses[f.Id] = 0;
            var rect = new Rectangle((int)(f.Name.Left + f.Name.Width / 2 - s / 2f), (int)(f.Name.Top - s - Math.Max(2, s / 8)), s, s);
            if (!shown.TryGetValue(f.Id, out var cur) || cur.Size != rect.Size
                || Math.Abs(cur.X - rect.X) > s / 3 || Math.Abs(cur.Y - rect.Y) > s / 3)
                shown[f.Id] = rect;
        }
        foreach (var id in shown.Keys.Where(id => !seen.Contains(id)).ToList())
        {
            int m = misses.GetValueOrDefault(id) + 1;
            misses[id] = m;
            if (newView || m >= 2)
            {
                shown.Remove(id);
                misses.Remove(id);
            }
        }
        return shown;
    }

    /// <summary>Obchod zavřený – žádná čísla.</summary>
    public void Clear()
    {
        shown.Clear();
        misses.Clear();
        lastSeen = [];
    }
}
