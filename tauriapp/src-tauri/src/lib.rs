// RolePlayMaster 桌面化身版 —— Tauri 后端
//
// 职责：
// 1. 创建 macOS 透明无边框窗口（配置在 tauri.conf.json）
// 2. 启动时把窗口停靠到屏幕右下角
// 3. 提供系统托盘（显示/隐藏化身、置顶开关、退出）
// 4. 提供原生文件对话框命令：导出/导入数据、导出/导入角色、下载相册图片
// 5. 代发云端同步请求（cloud_get / cloud_post）—— WebView 受同源策略限制，
//    无法跨域访问云端接口，详见下方「云端同步」一段的说明
//
// 注意：前端业务逻辑（聊天、记忆、拍照等）全部在 WebView 侧复用网页版模块，
// 这里只做「桌面能力」的桥接，不掺入任何业务逻辑。

use base64::Engine;
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// 化身模式的兜底窗口尺寸。
/// 正常尺寸由前端按内容精确计算（命令 resize_avatar_window），
/// 这两个常量只在「没有记录过退出前状态」时兜底使用。
const AVATAR_W: f64 = 390.0;
const AVATAR_H: f64 = 560.0;

/// 进入面板模式前的窗口几何（x, y, w, h），退出时原样还原
type PanelReturn = Option<(f64, f64, f64, f64)>;

/// 全局状态：窗口是否置顶 + 进入面板模式前的窗口几何
struct ShellState {
    on_top: AtomicBool,
    pre_panel: Mutex<PanelReturn>,
}

/// 取当前显示器的工作区（逻辑像素）与原点。
/// 所有定位都基于「本次请求的目标尺寸」而不是 win.outer_size()——
/// 改尺寸后 outer_size 可能还没更新，用它算坐标会把窗口推出屏幕。
fn monitor_rect(win: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let monitor = win.current_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    Some((origin.x, origin.y, size.width, size.height))
}

/// 把请求的尺寸夹到屏幕内（留出安全边距），保证窗口不会被推出可见区域
fn clamp_to_screen(win: &tauri::WebviewWindow, w: f64, h: f64) -> (f64, f64) {
    match monitor_rect(win) {
        Some((_, _, sw, sh)) => {
            let max_w = (sw - 16.0).max(320.0);
            // 只留极小的安全边距：前端已经把高度夹在「屏幕工作区」内，
            // 这里若再砍掉几十像素，长得高的气泡堆就会被裁掉一条
            let max_h = (sh - 8.0).max(260.0);
            (w.min(max_w).max(300.0), h.min(max_h).max(240.0))
        }
        None => (w, h),
    }
}

/// 按给定尺寸把窗口停靠到屏幕右下角
fn place_bottom_right(win: &tauri::WebviewWindow, w: f64, h: f64) {
    if let Some((ox, oy, sw, sh)) = monitor_rect(win) {
        let x = ox + (sw - w - 24.0).max(0.0);
        let y = oy + (sh - h - 60.0).max(0.0);
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }
}

/// 按给定尺寸把窗口放到屏幕正中间
fn place_centered(win: &tauri::WebviewWindow, w: f64, h: f64) {
    if let Some((ox, oy, sw, sh)) = monitor_rect(win) {
        let x = ox + ((sw - w) / 2.0).max(0.0);
        let y = oy + ((sh - h) / 2.0).max(0.0);
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }
}

// ==================== 原生文件对话框命令 ====================

/// 弹出「保存」对话框并写入文本内容（导出聊天数据 / 导出角色）
#[tauri::command]
async fn save_text_file(
    content: String,
    default_name: String,
    filter_name: String,
    filter_ext: Vec<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_file_name(&default_name);
        let exts: Vec<&str> = filter_ext.iter().map(|s| s.as_str()).collect();
        if !exts.is_empty() {
            dialog = dialog.add_filter(&filter_name, &exts);
        }
        match dialog.save_file() {
            Some(path) => {
                std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
                Ok(Some(path.to_string_lossy().to_string()))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 弹出「打开」对话框并读取文本内容（导入聊天数据 / 导入角色）
#[tauri::command]
async fn open_text_file(
    filter_name: String,
    filter_ext: Vec<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new();
        let exts: Vec<&str> = filter_ext.iter().map(|s| s.as_str()).collect();
        if !exts.is_empty() {
            dialog = dialog.add_filter(&filter_name, &exts);
        }
        match dialog.pick_file() {
            Some(path) => std::fs::read_to_string(&path)
                .map(Some)
                .map_err(|e| e.to_string()),
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 保存二进制文件（相册照片下载）。`base64_data` 不含 `data:...;base64,` 前缀
#[tauri::command]
async fn save_binary_file(
    base64_data: String,
    default_name: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(base64_data.as_bytes())
            .map_err(|e| format!("图片数据解码失败: {e}"))?;
        let path: PathBuf = match rfd::FileDialog::new().set_file_name(&default_name).save_file() {
            Some(p) => p,
            None => return Ok(None),
        };
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ==================== 云端同步（原生代发请求） ====================
//
// 为什么必须放在原生侧：
// 桌面端 WebView 的来源是 tauri://localhost，云端接口在 https://poecurrency.top，
// 两者不同源；而带 Authorization 头的请求会先触发 CORS 预检（OPTIONS）。
// 该服务端既不处理预检（OPTIONS 被当成普通请求返回 401），也不返回任何
// Access-Control-Allow-Origin 头，于是 WebView 内核直接拦截请求，
// 前端只能拿到 onerror —— 表现为「网络错误，请检查云端地址是否可访问」。
//
// 网页版之所以正常，是因为它与接口同源，根本不涉及跨域。
// 原生（Rust）侧发起请求不受同源策略约束，所以由这里代理这两个接口。

/// 云端接口响应（前端按 { ok, status, body } 使用）
#[derive(serde::Serialize)]
struct CloudReply {
    status: u16,
    ok: bool,
    body: String,
}

/// 下载进度（通过 Channel 推给前端，仅 GET 用）
#[derive(Clone, serde::Serialize)]
struct CloudProgress {
    loaded: u64,
    total: u64,
}

/// 云端请求整体超时。同步数据可能很大（实测约 13MB），给足时间。
const CLOUD_TIMEOUT_SECS: u64 = 300;
/// 进度上报间隔，避免大响应产生过多 IPC 消息
const CLOUD_PROGRESS_STEP: u64 = 256 * 1024;

fn build_cloud_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(CLOUD_TIMEOUT_SECS))
        .user_agent(format!("RolePlayMaster-Desktop/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("初始化网络客户端失败: {e}"))
}

/// 只允许 http/https —— 云端地址来自用户设置，避免把任意协议交给原生层代发
fn ensure_http_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    if u.starts_with("http://") || u.starts_with("https://") {
        Ok(())
    } else {
        Err(format!("云端地址必须是 http/https：{u}"))
    }
}

fn describe_net_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "请求超时，数据量可能过大".to_string()
    } else if e.is_connect() {
        format!("无法连接云端服务器（请检查云端地址与网络）：{e}")
    } else {
        format!("网络错误：{e}")
    }
}

/// 读取响应体为 UTF-8 文本；按块上报下载进度。
/// 用不透明字节流自行拼接，最后统一按 UTF-8 解码，避免多字节字符被切断。
async fn read_body_with_progress(
    resp: reqwest::Response,
    progress: tauri::ipc::Channel<CloudProgress>,
) -> Result<String, String> {
    let total = resp.content_length().unwrap_or(0);

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(total.min(32 * 1024 * 1024) as usize);
    let mut reported: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| describe_net_error(&e))?;
        buf.extend_from_slice(&chunk);
        let loaded = buf.len() as u64;
        let reached_end = total > 0 && loaded >= total;
        if loaded.saturating_sub(reported) >= CLOUD_PROGRESS_STEP || reached_end {
            reported = loaded;
            let _ = progress.send(CloudProgress { loaded, total });
        }
    }

    String::from_utf8(buf).map_err(|e| format!("响应不是有效的 UTF-8 文本：{e}"))
}

/// 云端 GET（「从云端同步」）
///
/// 注意 `on_progress` 是**必需参数**：Tauri 的 `Channel` 没有实现 `Deserialize`，
/// 因此 `Option<Channel<T>>` 无法作为命令参数（编译期就会报错）。
/// 前端始终会传一个进度通道，不需要进度时忽略消息即可。
#[tauri::command]
async fn cloud_get(
    url: String,
    token: String,
    on_progress: tauri::ipc::Channel<CloudProgress>,
) -> Result<CloudReply, String> {
    ensure_http_url(&url)?;
    let client = build_cloud_client()?;
    let resp = client
        .get(url.trim())
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| describe_net_error(&e))?;

    let status = resp.status().as_u16();
    let body = read_body_with_progress(resp, on_progress).await?;
    Ok(CloudReply {
        status,
        ok: (200..300).contains(&status),
        body,
    })
}

/// 云端 POST（「同步到云端」）
#[tauri::command]
async fn cloud_post(url: String, token: String, body: String) -> Result<CloudReply, String> {
    ensure_http_url(&url)?;
    let client = build_cloud_client()?;
    let resp = client
        .post(url.trim())
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| describe_net_error(&e))?;

    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| describe_net_error(&e))?;
    Ok(CloudReply {
        status,
        ok: (200..300).contains(&status),
        body: text,
    })
}

// ==================== 窗口命令 ====================

/// 退出应用
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 由前端发起窗口拖拽（化身/气泡按住拖动）
#[tauri::command]
fn start_drag_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.start_dragging();
    }
}

/// 设置窗口是否置顶
#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, on_top: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.set_always_on_top(on_top).map_err(|e| e.to_string())?;
    }
    if let Some(state) = app.try_state::<ShellState>() {
        state.on_top.store(on_top, Ordering::Relaxed);
    }
    Ok(())
}

/// 进入面板模式：按请求尺寸放大窗口并精确居中（尺寸会被夹到屏幕内）
#[tauri::command]
fn enter_panel_mode(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;

    // 记住「进入面板前」的位置**和尺寸**，退出时两者一起还原。
    // 只记位置是不够的：退出时若先按别的尺寸改窗口，再按「底边不动」重新定位，
    // 底部就会整体漂移。尺寸也必须一并还原。
    // 只在第一次记录：fitPanelWindow 会多次调用本命令微调尺寸，那时窗口已经居中。
    if let (Some(state), Ok(pos), Ok(size), Ok(scale)) = (
        app.try_state::<ShellState>(),
        win.outer_position(),
        win.outer_size(),
        win.scale_factor(),
    ) {
        if let Ok(mut slot) = state.pre_panel.lock() {
            if slot.is_none() {
                let p = pos.to_logical::<f64>(scale);
                let sz = size.to_logical::<f64>(scale);
                *slot = Some((p.x, p.y, sz.width, sz.height));
            }
        }
    }

    let _ = win.set_resizable(true);
    let (w, h) = clamp_to_screen(&win, width, height);
    win.set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    place_centered(&win, w, h);
    let _ = win.set_focus();
    Ok(())
}

/// 退出面板模式：恢复化身模式尺寸并重新停靠右下角
#[tauri::command]
fn exit_panel_mode(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let _ = win.set_resizable(false);

    // 还原到进入面板前的尺寸与位置；只有从未记录过（例如刚启动）才退回右下角
    let remembered = match app.try_state::<ShellState>() {
        Some(state) => state.pre_panel.lock().ok().and_then(|mut slot| slot.take()),
        None => None,
    };
    match remembered {
        Some((x, y, w, h)) => {
            let _ = win.set_size(tauri::LogicalSize::new(w, h));
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        }
        None => {
            let _ = win.set_size(tauri::LogicalSize::new(AVATAR_W, AVATAR_H));
            place_bottom_right(&win, AVATAR_W, AVATAR_H);
        }
    }
    Ok(())
}

/// 把化身窗口重新停靠到屏幕右下角（按当前实际尺寸）
#[tauri::command]
fn dock_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(size) = win.outer_size() {
            let l = size.to_logical::<f64>(win.scale_factor().unwrap_or(1.0));
            place_bottom_right(&win, l.width, l.height);
        }
    }
}

/// 化身模式下按当前内容调整窗口大小。
///
/// 位置策略：**保留用户拖动后的位置**，只把「底边」钉住 ——
/// 窗口变高时向上生长、变矮时向下收，化身始终停在原地，
/// 消息浮层也总是出现在化身正上方。
/// （早先这里每次都 place_bottom_right，导致拖动过化身之后一开聊天窗就被拽回右下角。）
#[tauri::command]
fn resize_avatar_window(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let (w, h) = clamp_to_screen(&win, width, height);

    let scale = win.scale_factor().unwrap_or(1.0);
    let old_pos = win.outer_position().ok().map(|p| p.to_logical::<f64>(scale));
    let old_size = win.outer_size().ok().map(|s| s.to_logical::<f64>(scale));

    win.set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;

    if let (Some(p), Some(sz)) = (old_pos, old_size) {
        if let Some((ox, oy, sw, sh)) = monitor_rect(&win) {
            // 横向保持不动（超出工作区时回推），纵向钉住底边
            let x = p.x.min(ox + sw - w).max(ox);
            let y = (p.y + sz.height - h).min(oy + sh - h).max(oy);
            let _ = win.set_position(tauri::LogicalPosition::new(x, y));
        }
    }
    Ok(())
}

/// 最小化窗口（应用保留 Dock 图标，可从 Dock 恢复）
#[tauri::command]
fn minimize_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

/// 隐藏窗口到托盘
#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

// ==================== 启动 ====================

pub fn run() {
    tauri::Builder::default()
        // 系统通知插件（拍照完成后推送；前端经 window.__TAURI__.notification 调用）
        .plugin(tauri_plugin_notification::init())
        .manage(ShellState {
            on_top: AtomicBool::new(true),
            pre_panel: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            save_text_file,
            open_text_file,
            save_binary_file,
            cloud_get,
            cloud_post,
            quit_app,
            start_drag_window,
            set_always_on_top,
            enter_panel_mode,
            exit_panel_mode,
            resize_avatar_window,
            dock_window,
            minimize_window,
            hide_window
        ])
        .setup(|app| {
            // ---- 启动时停靠到屏幕右下角 ----
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(size) = win.outer_size() {
                    let l = size.to_logical::<f64>(win.scale_factor().unwrap_or(1.0));
                    place_bottom_right(&win, l.width, l.height);
                }
            }


            // ---- 系统托盘 ----
            let show_item = MenuItem::with_id(app, "show", "显示 / 隐藏化身", true, None::<&str>)?;
            let top_item = MenuItem::with_id(app, "toggle_top", "切换窗口置顶", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &top_item, &quit_item])?;

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("RolePlayMaster 化身")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            match win.is_visible() {
                                Ok(true) => {
                                    let _ = win.hide();
                                }
                                _ => {
                                    let _ = win.show();
                                    let _ = win.unminimize();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                    }
                    "toggle_top" => {
                        if let Some(win) = app.get_webview_window("main") {
                            // 以状态位为准翻转，保证托盘与前端设置一致
                            let next = match app.try_state::<ShellState>() {
                                Some(state) => {
                                    let next = !state.on_top.load(Ordering::Relaxed);
                                    state.on_top.store(next, Ordering::Relaxed);
                                    next
                                }
                                None => true,
                            };
                            let _ = win.set_always_on_top(next);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri 应用启动失败");
}
