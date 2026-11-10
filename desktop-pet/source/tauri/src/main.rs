// EchoBot desktop pet, light build: a tiny native core around the same EchoBot code the full build runs.
// The pet's logic lives in a hidden "brain" web page; this file only provides what a web page can't do:
// moving windows, reading the cursor and other windows' rectangles, CPU load, encrypting the API key,
// reading/writing the settings file, and listening to the PC's sound for the music reaction.
#![windows_subsystem = "windows"]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Dwm::*;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::HiDpi::*;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

fn hwnd_of(app: &AppHandle, label: &str) -> Option<HWND> {
    app.get_webview_window(label).and_then(|w| w.hwnd().ok()).map(|h| h.0 as HWND)
}

// ---------- windows ----------
#[tauri::command]
fn set_bounds(app: AppHandle, label: String, x: i32, y: i32, w: i32, h: i32) {
    if let Some(hwnd) = hwnd_of(&app, &label) {
        unsafe { SetWindowPos(hwnd, std::ptr::null_mut(), x, y, w, h, SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER); }
    }
}
#[tauri::command]
fn show_inactive(app: AppHandle, label: String) {
    if let Some(hwnd) = hwnd_of(&app, &label) { unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE); } }
}
#[tauri::command]
fn set_topmost(app: AppHandle, label: String, on: bool) {
    if let Some(hwnd) = hwnd_of(&app, &label) {
        let after = if on { HWND_TOPMOST } else { HWND_NOTOPMOST };
        unsafe { SetWindowPos(hwnd, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
    }
}
#[tauri::command]
fn cursor_pos() -> (i32, i32) {
    let mut p = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut p); }
    (p.x, p.y)
}

#[derive(serde::Serialize, Clone)]
struct Mon { x: i32, y: i32, w: i32, h: i32, wx: i32, wy: i32, ww: i32, wh: i32, scale: f64, primary: bool }
unsafe extern "system" fn mon_cb(hm: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let list = &mut *(data as *mut Vec<Mon>);
    let mut mi: MONITORINFO = std::mem::zeroed();
    mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if GetMonitorInfoW(hm, &mut mi) != 0 {
        let (mut dx, mut dy) = (96u32, 96u32);
        GetDpiForMonitor(hm, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        let (r, wa) = (mi.rcMonitor, mi.rcWork);
        list.push(Mon { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top, wx: wa.left, wy: wa.top, ww: wa.right - wa.left,
            wh: wa.bottom - wa.top, scale: dx as f64 / 96.0, primary: mi.dwFlags & 1 != 0 });
    }
    1
}
#[tauri::command]
fn monitors() -> Vec<Mon> {
    let mut list: Vec<Mon> = Vec::new();
    unsafe { EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(mon_cb), &mut list as *mut _ as LPARAM); }
    list
}

// ---------- the window watcher (same JSON lines as winwatch.exe in the full build) ----------
unsafe fn class_name(h: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = GetClassNameW(h, buf.as_mut_ptr(), 64);
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}
const SHELL: [&str; 8] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
    "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland", "XamlExplorerHostIslandWindow"];
struct Enum { own: u32, out: Vec<String> }
unsafe extern "system" fn win_cb(h: HWND, data: LPARAM) -> BOOL {
    let e = &mut *(data as *mut Enum);
    if e.out.len() >= 40 || IsWindowVisible(h) == 0 || IsIconic(h) != 0 { return 1; }
    let mut pid = 0u32; GetWindowThreadProcessId(h, &mut pid);
    if pid == e.own { return 1; }
    let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32; let st = GetWindowLongW(h, GWL_STYLE) as u32;
    if ex & WS_EX_TOOLWINDOW != 0 || ex & WS_EX_NOACTIVATE != 0 { return 1; }
    let mut cloaked: u32 = 0;
    if DwmGetWindowAttribute(h, DWMWA_CLOAKED as u32, &mut cloaked as *mut _ as *mut _, 4) == 0 && cloaked != 0 { return 1; }
    if SHELL.contains(&class_name(h).as_str()) || GetWindowTextLengthW(h) == 0 { return 1; }
    let mut r: RECT = std::mem::zeroed();
    if DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS as u32, &mut r as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32) != 0 { GetWindowRect(h, &mut r); }
    if r.right - r.left < 160 || r.bottom - r.top < 80 { return 1; }
    e.out.push(format!("[{},{},{},{},{},{},{}]", h as isize, r.left, r.top, r.right - r.left, r.bottom - r.top,
        (IsZoomed(h) != 0) as i32, (st & WS_CAPTION == WS_CAPTION) as i32));
    1
}
fn watch_line(own: u32) -> String {
    unsafe {
        let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        GetLastInputInfo(&mut li);
        let fg = GetForegroundWindow();
        let mut fs = false;
        if !fg.is_null() {
            let mut fpid = 0u32; GetWindowThreadProcessId(fg, &mut fpid);
            if fpid != own && !SHELL.contains(&class_name(fg).as_str()) {
                let mut r: RECT = std::mem::zeroed(); GetWindowRect(fg, &mut r);
                let mut mi: MONITORINFO = std::mem::zeroed(); mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                if GetMonitorInfoW(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST), &mut mi) != 0 {
                    let m = mi.rcMonitor;
                    fs = r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
                }
            }
        }
        let mut e = Enum { own, out: Vec::new() };
        EnumWindows(Some(win_cb), &mut e as *mut _ as LPARAM);
        format!("{{\"t\":{},\"li\":{},\"fs\":{},\"fg\":{},\"w\":[{}]}}", windows_sys::Win32::System::SystemInformation::GetTickCount(), li.dwTime, fs, fg as isize, e.out.join(","))
    }
}
fn cpu_times() -> (u64, u64, u64) {
    unsafe {
        let (mut i, mut k, mut u) = (std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>());
        windows_sys::Win32::System::Threading::GetSystemTimes(&mut i, &mut k, &mut u);
        let f = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
        (f(i) / 10000, f(k) / 10000, f(u) / 10000)   // ms: idle, kernel (includes idle), user
    }
}
static WATCHING: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn watch_start(app: AppHandle) {
    if WATCHING.swap(true, Ordering::SeqCst) { return; }
    let own = unsafe { GetCurrentProcessId() };
    let app1 = app.clone();
    std::thread::spawn(move || {
        let mut n = 0u32;
        loop {
            let _ = app1.emit_to("brain", "winwatch", watch_line(own));
            if n % 10 == 0 { let _ = app1.emit_to("brain", "cpu", cpu_times()); }
            n += 1;
            std::thread::sleep(Duration::from_millis(100));
        }
    });
    // the cursor, ~60 times a second, so the brain can read it without waiting
    std::thread::spawn(move || loop {
        let _ = app.emit_to("brain", "cursor", cursor_pos());
        std::thread::sleep(Duration::from_millis(16));
    });
}

// ---------- files and the API key ----------
#[tauri::command]
fn user_data_dir(app: AppHandle) -> String {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("EchoBot"));
    let _ = std::fs::create_dir_all(&dir);
    dir.to_string_lossy().to_string()
}
#[tauri::command]
fn read_text(path: String) -> Result<String, String> { std::fs::read_to_string(&path).map_err(|e| e.to_string()) }
#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    if let Some(p) = std::path::Path::new(&path).parent() { let _ = std::fs::create_dir_all(p); }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}
#[tauri::command]
fn list_dir(path: String) -> Vec<String> {
    std::fs::read_dir(&path).map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default()
}
#[tauri::command]
fn remove_file(path: String) { let _ = std::fs::remove_file(path); }
#[tauri::command]
fn env_var(name: String) -> String { std::env::var(name).unwrap_or_default() }

fn dpapi(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::*;
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = if protect { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) }
                 else { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out) };
        if ok == 0 { return Err("Windows couldn't encrypt/decrypt".into()); }
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as _);
        Ok(v)
    }
}
#[tauri::command]
fn protect(text: String) -> Result<Vec<u8>, String> { dpapi(text.as_bytes(), true) }
#[tauri::command]
fn unprotect(data: Vec<u8>) -> Result<String, String> { dpapi(&data, false).map(|v| String::from_utf8_lossy(&v).to_string()) }

// ---------- sound: loudness, bass and voice-band level, measured live and never stored ----------
struct Audio { stop: Option<mpsc::Sender<()>> }
#[derive(serde::Serialize, Clone)]
struct Level { level: f32, bass: f32, voice: f32 }
#[tauri::command]
fn audio_start(app: AppHandle, state: tauri::State<'_, Arc<Mutex<Audio>>>, mode: String) -> Result<(), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    if let Some(tx) = state.lock().unwrap().stop.take() { let _ = tx.send(()); }
    let (tx, rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        let host = cpal::default_host();
        // "music": WASAPI loopback (open the speakers as an input); "mic": the default microphone
        let device = if mode == "music" { host.default_output_device() } else { host.default_input_device() };
        let Some(device) = device else { let _ = ready_tx.send(Err("no audio device".into())); return; };
        let cfg = if mode == "music" { device.default_output_config() } else { device.default_input_config() };
        let Ok(cfg) = cfg else { let _ = ready_tx.send(Err("audio device has no usable format".into())); return; };
        let rate = cfg.sample_rate().0 as f32;
        let ch = cfg.channels() as usize;
        let a_bass = 1.0 - (-2.0 * std::f32::consts::PI * 150.0 / rate).exp();
        let a_lo = 1.0 - (-2.0 * std::f32::consts::PI * 300.0 / rate).exp();
        let a_hi = 1.0 - (-2.0 * std::f32::consts::PI * 3000.0 / rate).exp();
        let (mut lp_bass, mut lp_lo, mut lp_hi) = (0f32, 0f32, 0f32);
        let (mut s_all, mut s_bass, mut s_voice, mut count) = (0f32, 0f32, 0f32, 0usize);
        let block = (rate / 60.0) as usize;
        let app2 = app.clone();
        let mut on_samples = move |data: &[f32]| {
            for frame in data.chunks(ch) {
                let x = frame.iter().sum::<f32>() / ch as f32;
                lp_bass += a_bass * (x - lp_bass);
                lp_lo += a_lo * (x - lp_lo);
                lp_hi += a_hi * (x - lp_hi);
                let voice = lp_hi - lp_lo;            // roughly 300 Hz – 3 kHz
                s_all += x * x; s_bass += lp_bass * lp_bass; s_voice += voice * voice; count += 1;
                if count >= block {
                    let n = count as f32;
                    let _ = app2.emit("audio", Level { level: (s_all / n).sqrt(), bass: (s_bass / n).sqrt(), voice: (s_voice / n).sqrt() });
                    s_all = 0.0; s_bass = 0.0; s_voice = 0.0; count = 0;
                }
            }
        };
        let err = |e| eprintln!("audio: {e}");
        let fmt = cfg.sample_format();
        let scfg: cpal::StreamConfig = cfg.into();
        let stream = match fmt {
            cpal::SampleFormat::F32 => device.build_input_stream(&scfg, move |d: &[f32], _: &_| on_samples(d), err, None),
            cpal::SampleFormat::I16 => device.build_input_stream(&scfg, move |d: &[i16], _: &_| { let v: Vec<f32> = d.iter().map(|s| *s as f32 / 32768.0).collect(); on_samples(&v) }, err, None),
            _ => { let _ = ready_tx.send(Err("unsupported audio format".into())); return; }
        };
        match stream {
            Ok(s) => { if let Err(e) = s.play() { let _ = ready_tx.send(Err(e.to_string())); return; } let _ = ready_tx.send(Ok(())); let _ = rx.recv(); drop(s); }
            Err(e) => { let _ = ready_tx.send(Err(e.to_string())); }
        }
    });
    let r = ready_rx.recv_timeout(Duration::from_secs(5)).unwrap_or(Err("audio didn't start".into()));
    if r.is_ok() { state.lock().unwrap().stop = Some(tx); }
    r
}
#[tauri::command]
fn audio_stop(state: tauri::State<'_, Arc<Mutex<Audio>>>) {
    if let Some(tx) = state.lock().unwrap().stop.take() { let _ = tx.send(()); }
}

#[tauri::command]
fn quit(app: AppHandle) { app.exit(0); }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| { let _ = app.emit_to("brain", "second-instance", ()); }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(Arc::new(Mutex::new(Audio { stop: None })))
        .invoke_handler(tauri::generate_handler![set_bounds, show_inactive, set_topmost, cursor_pos, monitors, watch_start, user_data_dir,
            read_text, write_text, list_dir, remove_file, env_var, protect, unprotect, audio_start, audio_stop, quit])
        .run(tauri::generate_context!())
        .expect("EchoBot couldn't start");
}
