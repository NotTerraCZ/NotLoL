using System.Runtime.InteropServices;

namespace NotLoL;

/// <summary>
/// Zkratky, když má focus okno hry. LoL si běžné zkratky ostatních programů (RegisterHotKey) vypíná,
/// proto během hry sledujeme klávesnici nízkoúrovňovým hookem – stejně jako push-to-talk v Discordu.
/// Hook nic neblokuje ani nemění, jen pozná zkratky z Hotkeys (výchozí Ctrl+X, Ctrl+Shift+H a Ctrl+Shift+M).
/// </summary>
sealed class GameKeyHook : IDisposable
{
    readonly HookProc proc;
    readonly HashSet<int> down = [];
    IntPtr hook;

    /// <summary>Kdy na zkratku reagovat (např. jen když je v popředí hra).</summary>
    public Func<bool>? Filter { get; set; }
    /// <summary>Stisknutá zkratka (id z Hotkeys).</summary>
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
            else if ((msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) && down.Add(vk) && Hotkeys.All.Any(b => b.Vk == vk))
            {
                bool ctrl = IsDown(VK_CONTROL, 0xA2, 0xA3);
                bool shift = IsDown(VK_SHIFT, 0xA0, 0xA1);
                bool alt = IsDown(VK_MENU, 0xA4, 0xA5);
                // Modifikátory musí sedět přesně (Ctrl+X není Ctrl+Shift+X)
                var hit = Hotkeys.All.FirstOrDefault(b => b.Vk == vk && b.Ctrl == ctrl && b.Shift == shift && b.Alt == alt);
                // Rychle vrátit – samotná akce proběhne až po návratu z hooku
                if (hit != null && (Filter?.Invoke() ?? true)) Pressed?.Invoke(hit.Id);
            }
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }

    bool IsDown(int vk, int left, int right) =>
        down.Contains(left) || down.Contains(right) || (GetAsyncKeyState(vk) & 0x8000) != 0;

    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
    const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;

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
