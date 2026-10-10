namespace NotLoL;

static class Program
{
    public const string ShowEventName = "NotLoL.ShowWindow";

    [STAThread]
    static void Main(string[] args)
    {
        // Jen jedna instance: druhé spuštění jen ukáže okno té první (např. po startu na pozadí)
        using var mutex = new Mutex(true, "NotLoL.SingleInstance", out bool first);
        if (!first)
        {
            try { EventWaitHandle.OpenExisting(ShowEventName).Set(); } catch { /* první instance se ukončuje */ }
            return;
        }

        ApplicationConfiguration.Initialize();
        bool background = args.Any(a => a.Equals("--background", StringComparison.OrdinalIgnoreCase));
        Application.Run(new MainForm(background));
    }
}
