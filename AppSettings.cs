using System.Text.Json;
using Microsoft.Win32;

namespace NotLoL;

/// <summary>Nastavení desktopové části (spouštění se systémem, poslední záloha, jazyk).</summary>
sealed class AppSettings
{
    static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NotLoL", "app.json");

    public bool AutostartInitialized { get; set; }
    public bool TrayHintShown { get; set; }
    public DateTime? LastBackup { get; set; }

    // Jazyk a barva z rozhraní + přeložené texty pro tray a overlay (viz Loc)
    public string? Lang { get; set; }
    public string? Accent { get; set; }
    public Dictionary<string, string>? Native { get; set; }

    public static AppSettings Load()
    {
        try { return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new(); }
        catch { return new(); }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
        }
        catch { /* nevadí */ }
    }
}

/// <summary>Spouštění při startu Windows (HKCU\...\Run, bez práv správce).</summary>
static class AutoStart
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string Name = "NotLoL";

    static string Command => $"\"{Environment.ProcessPath}\" --background";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(Name) is string;
        }
        catch
        {
            return false;
        }
    }

    public static void Set(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (enabled) key.SetValue(Name, Command);
            else key.DeleteValue(Name, false);
        }
        catch { /* bez přístupu do registru */ }
    }

    /// <summary>Když se .exe přesune, opraví cestu v záznamu.</summary>
    public static void RefreshPath()
    {
        if (IsEnabled()) Set(true);
    }
}
