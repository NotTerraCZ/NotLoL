using System.Runtime.InteropServices;

namespace NotLoL;

/// <summary>
/// Zkratky, když má focus okno hry. LoL si běžné zkratky ostatních programů (RegisterHotKey) vypíná,
/// proto během hry sledujeme klávesnici nízkoúrovňovým hookem – stejně jako push-to-talk v Discordu.
/// Hook nic neblokuje ani nemění, jen pozná Ctrl+X, Ctrl+Shift+H a Ctrl+Shift+M.
/// </summary>
sealed class GameKeyHook : IDisposable
{
    public const int TogglePanel = 3, ToggleOverlay = 1, MoveOverlay = 2;

    readonly HookProc proc;
    readonly HashSet<int> down = [];
    IntPtr hook;

    /// <summary>Kdy na zkratku reagovat (např. jen když je v popředí hra).</summary>
    public Func<bool>? Filter { get; set; }
    public event Action<int>? Pressed;

    public GameKeyHook() => proc = Callback;

    public bool Installed => hook != IntPtr.Zero;
    public long InstalledAt { get; private set; }

    // Instaluje se až při startu hry, aby byl náš hook v řetězu před případným hookem hry
    public void Install()
    {
        Uninstall();
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        InstalledAt = Environment.TickCount64;
    }

    public void Uninstall()
    {
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
        down.Clear();
    }

    public void Dispose() => Uninstall();

    IntPtr Callback(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            int msg = (int)wParam;
            int vk = Marshal.ReadInt32(lParam); // KBDLLHOOKSTRUCT.vkCode
            if (msg is WM_KEYUP or WM_SYSKEYUP)
            {
                down.Remove(vk);
            }
            else if ((msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) && down.Add(vk) && (vk == VK_X || vk == VK_H || vk == VK_M))
            {
                bool ctrl = IsDown(VK_CONTROL, 0xA2, 0xA3);
                bool shift = IsDown(VK_SHIFT, 0xA0, 0xA1);
                bool alt = IsDown(VK_MENU, 0xA4, 0xA5);
                int id = !ctrl || alt ? 0
                    : vk == VK_X && !shift ? TogglePanel
                    : vk == VK_H && shift ? ToggleOverlay
                    : vk == VK_M && shift ? MoveOverlay
                    : 0;
                // Rychle vrátit – samotná akce proběhne až po návratu z hooku
                if (id != 0 && (Filter?.Invoke() ?? true)) Pressed?.Invoke(id);
            }
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }

    bool IsDown(int vk, int left, int right) =>
        down.Contains(left) || down.Contains(right) || (GetAsyncKeyState(vk) & 0x8000) != 0;

    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
    const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_H = 0x48, VK_M = 0x4D, VK_X = 0x58;

    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr hMod, uint threadId);

    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vk);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string? name);
}
