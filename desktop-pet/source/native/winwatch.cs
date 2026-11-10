// winwatch: a tiny helper the desktop pet runs in the background.
// Ten times a second it prints one JSON line describing the visible app windows (so EchoBot can sit on
// their title bars), whether the active app is fullscreen (so EchoBot can hide), and when the last
// keyboard/mouse input happened (so EchoBot can tell you're typing). It never reads keys or window
// contents: only rectangles and a timestamp.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class WinWatch {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("kernel32.dll")] static extern uint GetTickCount();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);

  const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000, WS_CAPTION = 0x00C00000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

  static uint ownPid;
  static string Cls(IntPtr h) { var s = new StringBuilder(64); GetClassName(h, s, 64); return s.ToString(); }
  static RECT Bounds(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;   // the visible frame, without the invisible resize border Windows 10/11 adds
  }
  static readonly HashSet<string> Shell = new HashSet<string> { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
    "Windows.UI.Core.CoreWindow", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland", "XamlExplorerHostIslandWindow" };

  static void Main(string[] args) {
    if (args.Length > 0) uint.TryParse(args[0], out ownPid);
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }   // per-monitor aware: physical pixels everywhere
    var sb = new StringBuilder(4096);
    var stdout = Console.Out;
    while (true) {
      sb.Clear();
      var li = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO)) };
      GetLastInputInfo(ref li);
      IntPtr fg = GetForegroundWindow();
      bool fs = false;
      if (fg != IntPtr.Zero) {
        uint fpid; GetWindowThreadProcessId(fg, out fpid);
        string c = Cls(fg);
        if (fpid != ownPid && !Shell.Contains(c)) {
          RECT r; GetWindowRect(fg, out r);
          var mi = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
          if (GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi))
            fs = r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
        }
      }
      sb.Append("{\"t\":").Append(GetTickCount()).Append(",\"li\":").Append(li.dwTime)
        .Append(",\"fs\":").Append(fs ? "true" : "false").Append(",\"fg\":").Append(fg.ToInt64()).Append(",\"w\":[");
      int n = 0;
      EnumWindows((h, l) => {   // top of the stack first
        if (n >= 40 || !IsWindowVisible(h) || IsIconic(h)) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == ownPid) return true;
        int ex = GetWindowLong(h, GWL_EXSTYLE), st = GetWindowLong(h, GWL_STYLE);
        if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
        int cloaked; if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
        if (Shell.Contains(Cls(h)) || GetWindowTextLength(h) == 0) return true;
        RECT r = Bounds(h);
        if (r.R - r.L < 160 || r.B - r.T < 80) return true;
        if (n++ > 0) sb.Append(',');
        sb.Append('[').Append(h.ToInt64()).Append(',').Append(r.L).Append(',').Append(r.T).Append(',').Append(r.R - r.L).Append(',')
          .Append(r.B - r.T).Append(',').Append(IsZoomed(h) ? 1 : 0).Append(',').Append((st & WS_CAPTION) == WS_CAPTION ? 1 : 0).Append(']');
        return true;
      }, IntPtr.Zero);
      sb.Append("]}");
      try { stdout.WriteLine(sb.ToString()); stdout.Flush(); } catch { return; }   // the pet closed: exit with it
      Thread.Sleep(100);
    }
  }
}
