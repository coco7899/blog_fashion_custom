$ErrorActionPreference = 'SilentlyContinue'

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NaverLoginWindow {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);

    public static bool Show(uint targetPid) {
        bool found = false;
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid != targetPid) return true;

            int length = GetWindowTextLength(hWnd);
            if (length <= 0) return true;
            var title = new StringBuilder(length + 1);
            GetWindowText(hWnd, title, title.Capacity);
            string value = title.ToString();
            if (value.IndexOf("NAVER", StringComparison.OrdinalIgnoreCase) < 0 &&
                value.IndexOf("login", StringComparison.OrdinalIgnoreCase) < 0) return true;

            ShowWindowAsync(hWnd, 9);
            SetForegroundWindow(hWnd);
            found = true;
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
'@

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $browser = Get-CimInstance Win32_Process |
        Where-Object {
            ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and
            $_.CommandLine -like '*playwright_chromiumdev_profile-*' -and
            $_.CommandLine -notlike '*--type=*'
        } |
        Sort-Object CreationDate -Descending |
        Select-Object -First 1

    if ($browser -and [NaverLoginWindow]::Show([uint32]$browser.ProcessId)) {
        $shell = New-Object -ComObject WScript.Shell
        $shell.AppActivate([int]$browser.ProcessId) | Out-Null
        exit 0
    }

    Start-Sleep -Milliseconds 250
}

exit 0
