using System.Text.Json.Nodes;

namespace NotLoL;

/// <summary>
/// Zkratky ve hře: herní panel, skrytí overlaye a jeho přesouvání. Výchozí Ctrl+X, Ctrl+Shift+H a Ctrl+Shift+M,
/// vlastní nastavuje rozhraní (Nastavení → Zkratky ve hře) a posílá je se zprávou "settings".
/// Platí pro RegisterHotKey (MainForm) i pro hook klávesnice ve hře (GameKeyHook).
/// </summary>
static class Hotkeys
{
    public const int Overlay = 1, Move = 2, Panel = 3; // id pro RegisterHotKey a GameKeyHook

    /// <summary>Vk = virtuální klávesa Windows, Label = text pro nápovědy (v jazyce appky, např. "Strg+X").</summary>
    public sealed record Binding(int Id, int Vk, bool Ctrl, bool Shift, bool Alt, string Label)
    {
        public bool SameKeys(Binding o) => Vk == o.Vk && Ctrl == o.Ctrl && Shift == o.Shift && Alt == o.Alt;
    }

    static readonly Binding[] Defaults =
    [
        new(Panel, 0x58, true, false, false, "Ctrl+X"),
        new(Overlay, 0x48, true, true, false, "Ctrl+Shift+H"),
        new(Move, 0x4D, true, true, false, "Ctrl+Shift+M"),
    ];

    /// <summary>Aktuální zkratky (pole se při změně celé vymění, takže ho jde číst kdykoli).</summary>
    public static Binding[] All { get; private set; } = Defaults;

    /// <summary>Zkratky se změnily (vlastní z rozhraní nebo návrat k výchozím).</summary>
    public static event Action? Changed;

    public static Binding Get(int id) => All.First(b => b.Id == id);

    /// <summary>
    /// Zkratky z rozhraní: [{id, vk, ctrl, shift, alt, label}]. Neplatná zkratka (bez Ctrl/Alt, neznámá klávesa,
    /// stejná jako jiná) zůstane výchozí.
    /// </summary>
    public static void Set(JsonNode? list)
    {
        var next = new List<Binding>();
        foreach (var def in Defaults)
        {
            var b = (list as JsonArray)?.OfType<JsonObject>().FirstOrDefault(x => Int(x["id"]) == def.Id) is { } o
                ? new Binding(def.Id, Int(o["vk"]), Bool(o["ctrl"]), Bool(o["shift"]), Bool(o["alt"]), Str(o["label"]))
                : null;
            bool valid = b != null && b.Vk is > 0 and < 255 && (b.Ctrl || b.Alt) && !next.Any(x => x.SameKeys(b));
            next.Add(valid ? b! with { Label = b!.Label.Length > 0 ? b.Label : def.Label } : def);
        }
        if (next.SequenceEqual(All)) return;
        All = [.. next];
        Changed?.Invoke();
    }

    static int Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) ? i : 0;
    static bool Bool(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s.Trim() : "";
}
