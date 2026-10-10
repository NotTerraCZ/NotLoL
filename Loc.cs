namespace NotLoL;

/// <summary>
/// Texty desktopové části (ikona v oznamovací oblasti, overlay, hlášky z LoL klienta) v jazyce appky.
/// Překlady posílá rozhraní (web/js/i18n.js, klíče "n.*") a ukládají se do app.json,
/// takže po startu na pozadí jsou správně hned. Bez nich se použije čeština z kódu.
/// </summary>
static class Loc
{
    static Dictionary<string, string> map = new();

    public static event Action? Changed;

    public static void Set(Dictionary<string, string>? strings)
    {
        map = strings ?? new();
        Changed?.Invoke();
    }

    public static string T(string key, string fallback, params object[] args)
    {
        var s = map.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v : fallback;
        if (args.Length == 0) return s;
        try { return string.Format(s, args); }
        catch (FormatException) { return string.Format(fallback, args); }
    }
}
