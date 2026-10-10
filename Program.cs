using System.Diagnostics;
using Velopack;
using Velopack.Locators;

namespace NotLoL;

static class Program
{
    public const string ShowEventName = "NotLoL.ShowWindow";
    const string MutexName = "NotLoL.SingleInstance";

    [STAThread]
    static void Main(string[] args)
    {
        // Instalátor a aktualizace (Velopack) – musí běžet úplně první. Spuštěné jen kvůli instalaci,
        // aktualizaci nebo odinstalaci appka tady skončí. Když je stažená novější verze, nainstaluje se
        // a NotLoL se sám znovu spustí (se stejnými argumenty, třeba --background). To ale ne, když už
        // NotLoL běží – druhé spuštění jen ukáže jeho okno a běžící appka se kvůli aktualizaci neshodí.
        bool alreadyRunning = Mutex.TryOpenExisting(MutexName, out var running);
        running?.Dispose();
        VelopackApp.Build()
            .SetAutoApplyOnStartup(!alreadyRunning)
            .OnBeforeUninstallFastCallback(_ => AppUpdater.CleanupOnUninstall())
            .Run();

        // Jen jedna instance: druhé spuštění jen ukáže okno té první (např. po startu na pozadí)
        using var mutex = new Mutex(true, MutexName, out bool first);

        // Nainstalovaná verze má přednost před jinou kopií – hlavně starou dist\NotLoL.exe, která se spouští
        // s Windows. Tu zavře a převezme po ní spouštění s Windows, jinak by se aktualizovaná verze nikdy nespustila.
        if (!first && IsInstalled() && CloseOtherCopies()) first = TakeOver(mutex);

        if (!first)
        {
            try { EventWaitHandle.OpenExisting(ShowEventName).Set(); } catch { /* první instance se ukončuje */ }
            return;
        }

        ApplicationConfiguration.Initialize();
        bool background = args.Any(a => a.Equals("--background", StringComparison.OrdinalIgnoreCase));
        Application.Run(new MainForm(background));
    }

    static bool IsInstalled()
    {
        try { return VelopackLocator.Current.CurrentlyInstalledVersion != null; }
        catch { return false; }
    }

    /// <summary>Ukončí NotLoL spuštěné odjinud než z téhle instalace. Vrátí true, když nějaké ukončil.</summary>
    static bool CloseOtherCopies()
    {
        string root;
        try { root = Path.TrimEndingDirectorySeparator(VelopackLocator.Current.RootAppDir ?? "") + Path.DirectorySeparatorChar; }
        catch { return false; }
        if (root.Length < 4) return false;

        bool closed = false;
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                // I přejmenované stažené soubory ("NotLoL (1).exe"), ale jen když je to opravdu NotLoL
                if (p.Id == Environment.ProcessId || !p.ProcessName.StartsWith("NotLoL", StringComparison.OrdinalIgnoreCase)) continue;
                var path = p.MainModule?.FileName;
                // Kopie z téhle instalace (běžící appka, spouštěč) nechat – ta se jen ukáže
                if (path == null || path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                if (FileVersionInfo.GetVersionInfo(path).ProductName != "NotLoL") continue;
                p.Kill();
                p.WaitForExit(5000);
                closed = true;
            }
            catch { /* proces mezitím skončil nebo k němu nemáme přístup */ }
            finally { p.Dispose(); }
        }
        return closed;
    }

    static bool TakeOver(Mutex mutex)
    {
        bool taken;
        try { taken = mutex.WaitOne(TimeSpan.FromSeconds(5)); }
        catch (AbandonedMutexException) { taken = true; } // ukončená kopie ho nestihla uvolnit – teď je náš
        // Chvilka pro procesy WebView2 ukončené kopie, ať se nepotkají se stejnou složkou dat
        if (taken) Thread.Sleep(1500);
        return taken;
    }
}
