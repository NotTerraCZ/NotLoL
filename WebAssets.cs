using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace NotLoL;

/// <summary>
/// Webové rozhraní zabalené v .exe (složka web/) servírované pod virtuální adresou https://notlol.example/.
/// Používá ho hlavní okno i herní panel.
/// </summary>
static class WebAssets
{
    public const string Origin = "https://notlol.example/";

    // "js/app.js" -> název embedded resource
    static readonly Dictionary<string, string> Files = typeof(WebAssets).Assembly
        .GetManifestResourceNames()
        .Where(n => n.StartsWith("web/"))
        .ToDictionary(n => n["web/".Length..].Replace('\\', '/'), n => n, StringComparer.OrdinalIgnoreCase);

    public static void Attach(CoreWebView2 core)
    {
#if !DEBUG
        core.Settings.AreDevToolsEnabled = false;
#endif
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;

        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            // Stejnou událost dostává i záloha dat (u.gg apod.) – tady jen soubory appky
            if (e.Request.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) Serve(core, e);
        };

        // Odkazy mimo aplikaci (u.gg apod.) otevřít ve výchozím prohlížeči
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            OpenExternal(args.Uri);
        };
        core.NavigationStarting += (_, args) =>
        {
            if (args.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) return;
            args.Cancel = true;
            OpenExternal(args.Uri);
        };
        // Kontextové menu jen v textových polích (kopírovat/vložit)
        core.ContextMenuRequested += (_, args) =>
        {
            if (!args.ContextMenuTarget.IsEditable && !args.ContextMenuTarget.HasSelection) args.Handled = true;
        };
    }

    static void Serve(CoreWebView2 core, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var path = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
        if (path.Length == 0) path = "index.html";

        var stream = Files.TryGetValue(path, out var name)
            ? typeof(WebAssets).Assembly.GetManifestResourceStream(name)
            : null;
        e.Response = stream == null
            ? core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "")
            : core.Environment.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {MimeType(path)}\r\nCache-Control: no-cache");
    }

    static string MimeType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json",
        ".png" => "image/png",
        ".svg" => "image/svg+xml",
        ".ico" => "image/x-icon",
        _ => "application/octet-stream",
    };

    public static void OpenExternal(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp)) return;
        try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); }
        catch { /* bez výchozího prohlížeče nic neotevřeme */ }
    }
}
