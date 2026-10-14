using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace NotLoL;

/// <summary>
/// Záloha dat na disk. Všechny JSON požadavky rozhraní na u.gg, Data Dragon a CommunityDragon
/// jdou přes tuhle třídu: stáhne se čerstvá verze (s dotazem "změnilo se to?", ať se zbytečně
/// nestahuje), uloží se do %LOCALAPPDATA%\NotLoL\cache a když server nejde, vrátí se uložená kopie.
/// </summary>
sealed class DataCache
{
    public static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NotLoL", "cache");

    // Které adresy se zálohují (jen data, ne obrázky)
    static readonly string[] Filters =
    [
        "https://stats2.u.gg/*",
        "https://static.bigbrain.gg/*",
        "https://ddragon.leagueoflegends.com/api/*",
        "https://ddragon.leagueoflegends.com/cdn/*/data/*",
        "https://raw.communitydragon.org/*.json",
        "https://lol-api-champion.op.gg/*", // Arena (prizmatické itemy, augmenty) – u.gg ji nemá aktuální
    ];

    readonly HttpClient http = new(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All })
    {
        Timeout = TimeSpan.FromSeconds(12),
        DefaultRequestHeaders = { { "User-Agent", "NotLoL/1.0" } },
    };

    sealed record Meta(string Url, DateTime SavedAt, string? ETag, string? LastModified, string ContentType);

    public void Attach(CoreWebView2 core)
    {
        foreach (var f in Filters) core.AddWebResourceRequestedFilter(f, CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += async (_, e) =>
        {
            if (e.Request.Method != "GET" || !IsData(e.Request.Uri)) return;
            var deferral = e.GetDeferral();
            try
            {
                var r = await GetAsync(e.Request.Uri);
                var headers = new StringBuilder()
                    .Append($"Content-Type: {r.ContentType}\r\n")
                    .Append("Access-Control-Allow-Origin: *\r\n")
                    .Append("Access-Control-Expose-Headers: X-NotLoL-Offline\r\n")
                    .Append("Cache-Control: no-store\r\n");
                // Server nejde a posíláme zálohu – rozhraní ukáže upozornění
                if (r.OfflineSavedAt is DateTime saved) headers.Append($"X-NotLoL-Offline: {saved:O}\r\n");
                e.Response = core.Environment.CreateWebResourceResponse(
                    r.Body == null ? null : new MemoryStream(r.Body), r.Status, r.Status == 200 ? "OK" : "Error", headers.ToString());
            }
            catch
            {
                // Necháme požadavek projít normálně do sítě
            }
            finally
            {
                deferral.Complete();
            }
        };
    }

    // Jen data (JSON) z těchhle serverů – obrázky necháváme prohlížeči
    static bool IsData(string url) =>
        url.StartsWith("https://lol-api-champion.op.gg/", StringComparison.OrdinalIgnoreCase)
        || (url.EndsWith(".json", StringComparison.OrdinalIgnoreCase) && !url.StartsWith(WebAssets.Origin, StringComparison.OrdinalIgnoreCase));

    // Servery, jejichž data appka zálohuje (stejné jako Filters) – rozhraní nemůže nechat stáhnout cokoli jiného
    static readonly string[] Hosts =
    [
        "https://stats2.u.gg/", "https://static.bigbrain.gg/", "https://ddragon.leagueoflegends.com/",
        "https://raw.communitydragon.org/", "https://lol-api-champion.op.gg/",
    ];
    static bool IsBackedUp(string url) =>
        IsData(url) && Hosts.Any(h => url.StartsWith(h, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Záloha bez rozhraní: stáhne adresy do zálohy, ale nic z nich nenačítá do paměti
    /// (nezměněná data jen potvrdí dotazem "změnilo se to?"). Vrátí stav každé adresy (200 = je v záloze).
    /// </summary>
    public async Task<int[]> WarmAsync(IReadOnlyList<string> urls)
    {
        var result = new int[urls.Count];
        using var gate = new SemaphoreSlim(4); // pár souběžných stahování, ať se servery nezahltí
        await Task.WhenAll(urls.Select(async (url, i) =>
        {
            if (!IsBackedUp(url)) return; // 0 = tohle se nezálohuje
            await gate.WaitAsync();
            try { result[i] = (await GetAsync(url, needBody: false)).Status; }
            catch { result[i] = 503; }
            finally { gate.Release(); }
        }));
        return result;
    }

    /// <summary>Smaže zálohy, které se dlouho nepoužily (data starých patchů), ať složka neroste donekonečna.</summary>
    public static void Prune(TimeSpan maxAge)
    {
        try
        {
            var limit = DateTime.UtcNow - maxAge;
            foreach (var meta in new DirectoryInfo(Dir).GetFiles("*.meta.json"))
            {
                // Meta se přepíše při každém úspěšném stažení i potvrzení "nezměněno"
                if (meta.LastWriteTimeUtc > limit) continue;
                var body = Path.Combine(Dir, meta.Name[..^".meta.json".Length] + ".gz");
                try
                {
                    File.Delete(body);
                    meta.Delete();
                }
                catch { /* soubor se zrovna používá – příště */ }
            }
            foreach (var tmp in new DirectoryInfo(Dir).GetFiles("*.tmp"))
                if (tmp.LastWriteTimeUtc < limit) tmp.Delete();
        }
        catch { /* záloha je jen bonus */ }
    }

    public sealed record Result(int Status, byte[]? Body, string ContentType, DateTime? OfflineSavedAt);

    /// <summary>needBody = false: jen uložit do zálohy (stav bez dat; když server nejde, vrátí jeho chybu).</summary>
    public async Task<Result> GetAsync(string url, bool needBody = true)
    {
        var meta = ReadMeta(url);
        try
        {
#if DEBUG
            // Test výpadku u.gg bez skutečného výpadku
            if (Environment.GetEnvironmentVariable("NOTLOL_OFFLINE") == "1") throw new HttpRequestException("simulovaný výpadek");
#endif
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            // Máme uloženou verzi? Zeptej se jen, jestli se změnila
            if (meta != null && File.Exists(BodyPath(url)))
            {
                if (meta.ETag != null) req.Headers.TryAddWithoutValidation("If-None-Match", meta.ETag);
                else if (meta.LastModified != null) req.Headers.TryAddWithoutValidation("If-Modified-Since", meta.LastModified);
            }
            using var r = await http.SendAsync(req);

            if (r.StatusCode == HttpStatusCode.NotModified && meta != null)
            {
                if (!needBody)
                {
                    WriteMeta(url, meta with { SavedAt = DateTime.Now });
                    return new Result(200, null, meta.ContentType, null);
                }
                var cached = ReadBody(url);
                if (cached != null)
                {
                    WriteMeta(url, meta with { SavedAt = DateTime.Now });
                    return new Result(200, cached, meta.ContentType, null);
                }
            }
            if (r.IsSuccessStatusCode)
            {
                var body = await r.Content.ReadAsByteArrayAsync();
                var type = r.Content.Headers.ContentType?.ToString() ?? "application/json";
                Save(url, body, new Meta(url, DateTime.Now, r.Headers.ETag?.ToString(),
                    r.Content.Headers.LastModified?.ToString("R"), type));
                return new Result(200, needBody ? body : null, type, null);
            }
            if (!needBody) return new Result((int)r.StatusCode, null, "text/plain", null);
            // Server odpověděl chybou: pokud máme zálohu, použij ji (soubor dřív existoval)
            var fallback = meta != null ? ReadBody(url) : null;
            if (fallback != null) return new Result(200, fallback, meta!.ContentType, meta.SavedAt);
            return new Result((int)r.StatusCode, null, "text/plain", null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            // Bez spojení nebo vypršel čas – vrať zálohu, pokud je
            if (!needBody) return new Result(503, null, "text/plain", null);
            var fallback = meta != null ? ReadBody(url) : null;
            if (fallback != null) return new Result(200, fallback, meta!.ContentType, meta.SavedAt);
            return new Result(503, null, "text/plain", null);
        }
    }

    // ---------- Soubory ----------

    static string Key(string url) => Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(url))).ToLowerInvariant();
    static string BodyPath(string url) => Path.Combine(Dir, Key(url) + ".gz");
    static string MetaPath(string url) => Path.Combine(Dir, Key(url) + ".meta.json");

    static Meta? ReadMeta(string url)
    {
        try { return JsonSerializer.Deserialize<Meta>(File.ReadAllText(MetaPath(url))); }
        catch { return null; }
    }

    static void WriteMeta(string url, Meta meta)
    {
        try { File.WriteAllText(MetaPath(url), JsonSerializer.Serialize(meta)); }
        catch { /* záloha je jen bonus */ }
    }

    static byte[]? ReadBody(string url)
    {
        try
        {
            using var file = File.OpenRead(BodyPath(url));
            using var gz = new GZipStream(file, CompressionMode.Decompress);
            using var ms = new MemoryStream();
            gz.CopyTo(ms);
            return ms.ToArray();
        }
        catch
        {
            return null;
        }
    }

    static void Save(string url, byte[] body, Meta meta)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            // Zapsat nejdřív do dočasného souboru, ať se při pádu nepoškodí stará záloha
            var path = BodyPath(url);
            var tmp = path + ".tmp";
            using (var file = File.Create(tmp))
            using (var gz = new GZipStream(file, CompressionLevel.Fastest))
                gz.Write(body);
            File.Move(tmp, path, overwrite: true);
            WriteMeta(url, meta);
        }
        catch { /* záloha je jen bonus */ }
    }

    /// <summary>Kolik souborů a dat je zálohováno.</summary>
    public static (int files, long bytes) Stats()
    {
        try
        {
            var files = new DirectoryInfo(Dir).GetFiles("*.gz");
            return (files.Length, files.Sum(f => f.Length));
        }
        catch
        {
            return (0, 0);
        }
    }
}
