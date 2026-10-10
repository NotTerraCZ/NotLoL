using System.Reflection;
using Velopack;
using Velopack.Sources;

namespace NotLoL;

/// <summary>
/// Automatické aktualizace (Velopack) z GitHub Releases: github.com/NotTerraCZ/NotLoL.
/// Funguje jen v nainstalované verzi (NotLoL-Setup.exe) – spuštěná z dist\ nebo z Visual Studia nic nedělá.
/// Nová verze se stáhne na pozadí a nainstaluje se při restartu: tlačítkem v appce,
/// nebo sama při dalším spuštění (Velopack ji použije hned na startu, viz Program.cs).
/// </summary>
sealed class AppUpdater
{
    public const string RepoUrl = "https://github.com/NotTerraCZ/NotLoL";

    readonly UpdateManager? manager;
    VelopackAsset? downloaded;
    Task? running;
    int lastReported;

    /// <summary>off (nenainstalovaná verze) · idle · checking · downloading · ready · latest · error</summary>
    public string State { get; private set; } = "off";
    public string CurrentVersion { get; }
    public string? NewVersion { get; private set; }
    public int Progress { get; private set; }
    public DateTime? CheckedAt { get; private set; }
    public string? Error { get; private set; }
    public bool Installed => manager != null;
    public bool Ready => downloaded != null;

    /// <summary>Změna stavu. Může přijít i z jiného vlákna (průběh stahování).</summary>
    public event Action? Changed;

    public AppUpdater()
    {
        try
        {
            var m = new UpdateManager(new GithubSource(RepoUrl, null, false));
            if (m.IsInstalled) manager = m;
        }
        catch { /* bez instalace (vývojová nebo přenosná verze) */ }

        CurrentVersion = manager?.CurrentVersion?.ToString() ?? AssemblyVersion();
        if (manager == null) return;
        State = "idle";

        // Stažená verze, která se ještě nenainstalovala (normálně ji Velopack použije už při startu)
        if (manager.UpdatePendingRestart is { } pending)
        {
            downloaded = pending;
            NewVersion = pending.Version.ToString();
            State = "ready";
        }
    }

    static string AssemblyVersion()
    {
        var v = typeof(AppUpdater).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "";
        int plus = v.IndexOf('+'); // "1.1.0+commit" → "1.1.0"
        return plus >= 0 ? v[..plus] : v;
    }

    /// <summary>Zkontroluje GitHub a novou verzi rovnou stáhne. Když už kontrola běží, vrátí tu běžící.</summary>
    public Task CheckAsync()
    {
        if (manager == null || downloaded != null) return Task.CompletedTask;
        if (running is { IsCompleted: false }) return running;
        return running = RunAsync(manager);
    }

    async Task RunAsync(UpdateManager m)
    {
        try
        {
            Error = null;
            Set("checking");
            var info = await m.CheckForUpdatesAsync();
            CheckedAt = DateTime.Now;
            if (info == null)
            {
                Set("latest");
                return;
            }

            NewVersion = info.TargetFullRelease.Version.ToString();
            Progress = lastReported = 0;
            Set("downloading");
            await m.DownloadUpdatesAsync(info, p =>
            {
                Progress = p;
                // Průběh posílej jen po 5 %, ať se rozhraní zbytečně nepřekresluje
                if (p < 100 && p - lastReported < 5) return;
                lastReported = p;
                Changed?.Invoke();
            });
            downloaded = info.TargetFullRelease;
            Set("ready");
        }
        catch (Exception ex)
        {
            // Bez internetu, GitHub nejde, limit dotazů… – zkusí se to při další kontrole
            Error = ex.Message;
            Set("error");
        }
    }

    void Set(string state)
    {
        State = state;
        Changed?.Invoke();
    }

    /// <summary>
    /// Připraví instalaci stažené verze: Velopack počká, až se NotLoL zavře, nainstaluje ji
    /// (s malým oknem s průběhem) a appku znovu spustí. Volající pak musí appku hned ukončit.
    /// </summary>
    public bool PrepareRestart()
    {
        if (manager == null || downloaded == null) return false;
        try
        {
            manager.WaitExitThenApplyUpdates(downloaded, silent: false, restart: true, restartArgs: []);
            return true;
        }
        catch (Exception ex)
        {
            // Stažená verze zůstává – nainstaluje se při dalším spuštění
            Error = ex.Message;
            Changed?.Invoke();
            return false;
        }
    }

    /// <summary>
    /// Odinstalace (Velopack ji volá před smazáním appky): vypne spouštění s Windows
    /// a smaže data appky v %LOCALAPPDATA%\NotLoL (nastavení, záloha dat, WebView2).
    /// </summary>
    public static void CleanupOnUninstall()
    {
        AutoStart.RemoveIfOurs();

        var dir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(MainForm.DataDir));
        // Pojistka: nikdy nemazat složku, ve které je appka sama nainstalovaná
        if (Environment.ProcessPath is { } exe && exe.StartsWith(dir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return;
        for (int i = 0; i < 6 && Directory.Exists(dir); i++)
        {
            try { Directory.Delete(dir, recursive: true); }
            catch { Thread.Sleep(500); } // WebView2 může soubory chvíli po zavření appky ještě držet
        }
    }
}
