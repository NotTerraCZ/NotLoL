using System.Diagnostics;
using System.Text.Json.Nodes;

namespace NotLoL;

/// <summary>
/// Deadlock (Valve): pozná se podle procesu deadlock.exe (starší verze hry project8.exe; hledá se jednou za 5 s).
/// Rozhraní (deadlock.js) pošle pořadí nákupu s tierem každého itemu pro hrdinu, za kterého hraješ („Hraju za…“;
/// bez něj pro všechny hrdiny) – overlay ho ukazuje, dokud hra běží.
/// </summary>
public sealed partial class MainForm
{
    static readonly string[] DeadlockProcesses = ["deadlock", "project8"];

    int deadlockPid;
    long deadlockCheckedAt;
    JsonNode? dlBuild;
    bool overlayIsDeadlock; // overlay právě ukazuje build z Deadlocku

    bool DeadlockRunning => deadlockPid != 0;

    static int FindProcess(string name)
    {
        try
        {
            var procs = Process.GetProcessesByName(name);
            int pid = procs.FirstOrDefault()?.Id ?? 0;
            foreach (var p in procs) p.Dispose();
            return pid;
        }
        catch
        {
            return 0;
        }
    }

    static int FindDeadlockPid()
    {
        foreach (var name in DeadlockProcesses)
            if (FindProcess(name) is int pid and not 0) return pid;
        return 0;
    }

    bool DeadlockInForeground()
    {
        if (deadlockPid == 0) return false;
        GetWindowThreadProcessId(GetForegroundWindow(), out uint pid);
        return pid == deadlockPid;
    }

    // Každé kolo sledování (TickAsync); proces se ale hledá jen jednou za 5 s
    void CheckDeadlock()
    {
        long now = Environment.TickCount64;
        if (now - deadlockCheckedAt < 5000) return;
        deadlockCheckedAt = now;
        bool was = DeadlockRunning;
        deadlockPid = FindDeadlockPid();
        if (was != DeadlockRunning)
        {
            PostToWeb(new { type = "deadlock", running = DeadlockRunning });
            if (DeadlockRunning) keyHook.Install(); // zkratky overlaye (skrýt, přesunout), když má focus hra
            else if (gameKey == null) keyHook.Uninstall();
            ApplyDeadlockOverlay();
        }
        // Windows hooky občas tiše odpojí – obnovovat (během zápasu v LoL to dělá TickAsync)
        else if (DeadlockRunning && gameKey == null && now - keyHook.InstalledAt > 30000)
        {
            keyHook.Install();
        }
    }

    // Pořadí nákupu od rozhraní (hrdina z „Hraju za…“, jinak všichni hrdinové)
    void SetDeadlockData(JsonNode msg)
    {
        dlBuild = msg["build"]?.DeepClone();
        ApplyDeadlockOverlay();
    }

    // Overlay s pořadím nákupu, když běží Deadlock (zápas v LoL a ukázka overlaye mají přednost)
    void ApplyDeadlockOverlay()
    {
        bool want = DeadlockRunning && gameKey == null && !overlayDemo && dlBuild != null;
        if (want)
        {
            overlay ??= new OverlayForm();
            overlay.SetAccent(uiAccent);
            overlay.SetBuild(dlBuild);
            overlayIsDeadlock = true;
        }
        else if (overlayIsDeadlock && !overlayDemo && gameKey == null)
        {
            overlay?.SetBuild(null);
            overlayIsDeadlock = false;
        }
        UpdateOverlay();
        UpdateHotkeys();
    }
}
