#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod innertube;
mod media;
mod progress;

use innertube::{
    Account, ChannelPage, CommentPage, Feed, Guide, InnerTube, NotificationItem, PlaylistOption,
    Streams, WatchPage,
};
use media::MediaProxy;
use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::Cookie;
use tauri::{AppHandle, Emitter, Manager, State};

static MEDIA: OnceLock<Arc<MediaProxy>> = OnceLock::new();

struct AppState {
    yt: Arc<InnerTube>,
}

const SIGN_IN_URL: &str =
    "https://accounts.google.com/ServiceLogin?hl=en&continue=https%3A%2F%2Fwww.youtube.com%2F";

/// Picks the viewer's session out of the webview cookie jar. Google scatters
/// the same names across `.google.com` and `.youtube.com`; the YouTube copy is
/// the one InnerTube wants.
fn auth_from_cookies(cookies: &[Cookie<'static>]) -> Option<(String, String)> {
    let mut jar: BTreeMap<String, (bool, String)> = BTreeMap::new();
    for cookie in cookies {
        let domain = cookie.domain().unwrap_or_default();
        let youtube = domain.ends_with("youtube.com");
        if !youtube && !domain.ends_with("google.com") {
            continue;
        }
        let name = cookie.name().to_string();
        let entry = jar
            .entry(name)
            .or_insert_with(|| (youtube, cookie.value().to_string()));
        if youtube && !entry.0 {
            *entry = (true, cookie.value().to_string());
        }
    }

    if !jar.contains_key("LOGIN_INFO") {
        return None;
    }
    let (_, sapisid) = jar.get("SAPISID")?.clone();
    let header = jar
        .iter()
        .map(|(name, (_, value))| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ");
    Some((header, sapisid))
}

fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_channel_id(id: &str) -> bool {
    (2..=32).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
async fn yt_home(state: State<'_, AppState>) -> Result<Feed, String> {
    state.yt.home().await
}

#[tauri::command]
async fn yt_search(
    state: State<'_, AppState>,
    query: String,
    params: Option<String>,
) -> Result<Feed, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 256 {
        return Err("search query must be 1-256 characters".into());
    }
    state.yt.search(query, params.as_deref()).await
}

#[tauri::command]
async fn yt_feed(
    state: State<'_, AppState>,
    browse_id: String,
    params: Option<String>,
) -> Result<Feed, String> {
    if browse_id.is_empty() || browse_id.len() > 128 {
        return Err("invalid browse id".into());
    }
    state.yt.feed(&browse_id, params.as_deref()).await
}

#[tauri::command]
async fn yt_more(state: State<'_, AppState>, continuation: String) -> Result<Feed, String> {
    state.yt.more(&continuation).await
}

#[tauri::command]
async fn yt_channel(state: State<'_, AppState>, id: String) -> Result<ChannelPage, String> {
    if !valid_channel_id(&id) {
        return Err("invalid channel id".into());
    }
    state.yt.channel(&id).await
}

#[tauri::command]
async fn yt_channel_tab(
    state: State<'_, AppState>,
    id: String,
    params: String,
) -> Result<Feed, String> {
    if !valid_channel_id(&id) {
        return Err("invalid channel id".into());
    }
    state.yt.channel_tab(&id, &params).await
}

#[tauri::command]
async fn yt_notifications(state: State<'_, AppState>) -> Result<Vec<NotificationItem>, String> {
    state.yt.notifications().await
}

#[tauri::command]
async fn yt_rate(state: State<'_, AppState>, id: String, rating: String) -> Result<(), String> {
    if !valid_video_id(&id) {
        return Err("invalid video id".into());
    }
    if !["like", "dislike", "none"].contains(&rating.as_str()) {
        return Err("invalid rating".into());
    }
    state.yt.rate(&id, &rating).await
}

#[tauri::command]
async fn yt_subscribe(
    state: State<'_, AppState>,
    id: String,
    subscribed: bool,
) -> Result<(), String> {
    if !valid_channel_id(&id) {
        return Err("invalid channel id".into());
    }
    state.yt.subscribe(&id, subscribed).await
}

#[tauri::command]
async fn yt_watch_later(state: State<'_, AppState>, id: String, add: bool) -> Result<(), String> {
    if !valid_video_id(&id) {
        return Err("invalid video id".into());
    }
    state.yt.watch_later(&id, add).await
}

#[tauri::command]
async fn yt_comments(
    state: State<'_, AppState>,
    continuation: String,
) -> Result<CommentPage, String> {
    state.yt.comments(&continuation).await
}

#[tauri::command]
async fn yt_comment_post(
    state: State<'_, AppState>,
    id: String,
    text: String,
    parent: Option<String>,
) -> Result<(), String> {
    if !valid_video_id(&id) {
        return Err("invalid video id".into());
    }
    if text.trim().is_empty() {
        return Err("write something first".into());
    }
    state.yt.post_comment(&id, &text, parent.as_deref()).await
}

#[tauri::command]
async fn yt_streams(state: State<'_, AppState>, id: String) -> Result<Streams, String> {
    if !valid_video_id(&id) {
        return Err("invalid video id".into());
    }
    let mut streams = state.yt.streams(&id).await?;
    if let Some(proxy) = MEDIA.get() {
        for format in &mut streams.formats {
            if format.kind == "live" {
                format.url = proxy.live_url(&format.url, format.audio.as_deref());
                format.audio = None;
            } else {
                format.url = proxy.local_url(&format.url, &format.kind, &format.mime);
            }
        }
    }
    Ok(streams)
}

#[tauri::command]
fn yt_progress_get(id: String) -> Option<f64> {
    if !valid_video_id(&id) {
        return None;
    }
    progress::get(&id)
}

#[tauri::command]
fn yt_progress_set(id: String, seconds: f64, duration: f64) {
    if !valid_video_id(&id) || !seconds.is_finite() || seconds < 0.0 {
        return;
    }
    let duration = if duration.is_finite() && duration > 0.0 {
        duration
    } else {
        0.0
    };
    progress::set(&id, seconds, duration);
}

#[tauri::command]
fn yt_progress_clear(id: String) {
    if valid_video_id(&id) {
        progress::clear(&id);
    }
}

#[tauri::command]
async fn yt_shorts(state: State<'_, AppState>, id: Option<String>) -> Result<Vec<String>, String> {
    if let Some(id) = &id
        && !valid_video_id(id)
    {
        return Err("invalid video id".into());
    }
    state.yt.reel_sequence(id.as_deref()).await
}

#[tauri::command]
async fn yt_playlists(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<PlaylistOption>, String> {
    if !valid_video_id(&id) {
        return Err("invalid video id".into());
    }
    state.yt.playlists(&id).await
}

#[tauri::command]
async fn yt_playlist_edit(
    state: State<'_, AppState>,
    playlist_id: String,
    video_id: String,
    add: bool,
) -> Result<(), String> {
    let valid_playlist = playlist_id == "WL"
        || ((2..=64).contains(&playlist_id.len())
            && playlist_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    if !valid_playlist || !valid_video_id(&video_id) {
        return Err("invalid playlist".into());
    }
    state.yt.edit_playlist(&playlist_id, &video_id, add).await
}

fn percent_from(line: &str) -> Option<f64> {
    let end = line.find('%')?;
    let start = line[..end]
        .rfind(char::is_whitespace)
        .map(|index| index + 1)
        .unwrap_or(0);
    line[start..end].trim().parse().ok()
}

#[tauri::command]
async fn yt_download(app: AppHandle, id: String, audio_only: bool) -> Result<String, String> {
    if !valid_video_id(&id) {
        return Err("invalid video id".into());
    }

    let home = std::env::var("USERPROFILE").map_err(|error| error.to_string())?;
    let dir = std::path::PathBuf::from(home)
        .join("Downloads")
        .join("WinTube");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create the folder: {error}"))?;

    let url = format!("https://www.youtube.com/watch?v={id}");
    let mut command = tokio::process::Command::new("yt-dlp");
    command.args([
        "--no-warnings",
        "--no-playlist",
        "--newline",
        "--progress",
        "-P",
    ]);
    command.arg(&dir);
    command.args(["-o", "%(title)s [%(id)s].%(ext)s"]);
    if audio_only {
        command.args(["-f", "ba/b", "-x", "--audio-format", "m4a"]);
    } else {
        command.args([
            "-f",
            "bv*[height<=1080]+ba/b[height<=1080]/b",
            "--merge-output-format",
            "mp4",
        ]);
    }
    command.arg(&url);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);

    let mut child = command
        .spawn()
        .map_err(|error| format!("yt-dlp is not available: {error}"))?;
    let stdout = child.stdout.take().ok_or("yt-dlp produced no output")?;
    let stderr = child.stderr.take().ok_or("yt-dlp produced no output")?;

    let progress_app = app.clone();
    let progress_id = id.clone();
    let progress = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(percent) = percent_from(&line) {
                let _ = progress_app.emit(
                    "download-progress",
                    serde_json::json!({
                        "id": progress_id,
                        "percent": percent,
                        "line": line
                    }),
                );
            }
        }
    });

    let errors_app = app.clone();
    let errors_id = id.clone();
    let errors = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut lines = BufReader::new(stderr).lines();
        let mut last = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(percent) = percent_from(&line) {
                let _ = errors_app.emit(
                    "download-progress",
                    serde_json::json!({
                        "id": errors_id,
                        "percent": percent,
                        "line": line
                    }),
                );
            }
            if !line.trim().is_empty() {
                last = line;
            }
        }
        last
    });

    let status = child.wait().await.map_err(|error| error.to_string())?;
    let _ = progress.await;
    let last_error = errors.await.unwrap_or_default();
    if !status.success() {
        return Err(if last_error.is_empty() {
            "yt-dlp failed".into()
        } else {
            format!("yt-dlp failed: {last_error}")
        });
    }

    let folder = dir.display().to_string();
    let _ = app.emit(
        "download-done",
        serde_json::json!({ "id": id, "dir": folder }),
    );
    Ok(folder)
}

#[tauri::command]
async fn yt_watch(state: State<'_, AppState>, id: String) -> Result<WatchPage, String> {
    if !valid_video_id(&id) {
        return Err("invalid video id".into());
    }
    state.yt.watch(&id).await
}

#[tauri::command]
async fn yt_account(state: State<'_, AppState>) -> Result<Option<Account>, String> {
    if !state.yt.has_auth() {
        return Ok(None);
    }
    Ok(state.yt.account().await)
}

#[tauri::command]
async fn yt_guide(state: State<'_, AppState>) -> Result<Guide, String> {
    if !state.yt.has_auth() {
        return Ok(Guide {
            entries: Vec::new(),
            channels: Vec::new(),
        });
    }
    Ok(state.yt.guide().await)
}

#[tauri::command]
async fn yt_auth_status(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    if state.yt.has_auth() {
        return Ok(true);
    }
    let Some(window) = app.get_webview_window("main") else {
        return Ok(false);
    };
    let Ok(url) = "https://www.youtube.com/".parse() else {
        return Ok(false);
    };
    let Ok(cookies) = window.cookies_for_url(url) else {
        return Ok(false);
    };
    match auth_from_cookies(&cookies) {
        Some((cookie, sapisid)) => {
            state.yt.set_auth(cookie, sapisid);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
fn yt_sign_in(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if state.yt.has_auth() {
        return Ok(());
    }
    begin_sign_in(&app, state.yt.clone())
}

/// Sends the main webview to Google and watches the cookie jar. Once the
/// session shows up, the viewer is returned to the app UI, which reloads and
/// re-renders with the account attached.
fn begin_sign_in(app: &AppHandle, yt: Arc<InnerTube>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("the main window is not open")?;
    let app_url = window.url().map_err(|error| error.to_string())?;
    let sign_in_url = SIGN_IN_URL
        .parse()
        .map_err(|error| format!("invalid sign-in URL: {error}"))?;
    window
        .navigate(sign_in_url)
        .map_err(|error| format!("could not open the sign-in page: {error}"))?;

    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(600);
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1500));
            let Ok(url) = "https://www.youtube.com/".parse() else {
                break;
            };
            let Ok(cookies) = window.cookies_for_url(url) else {
                break;
            };
            if let Some((cookie, sapisid)) = auth_from_cookies(&cookies) {
                yt.set_auth(cookie, sapisid);
                let _ = window.navigate(app_url.clone());
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn yt_sign_out(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.yt.clear_auth();
    let window = app
        .get_webview_window("main")
        .ok_or("the main window is not open")?;
    window
        .clear_all_browsing_data()
        .map_err(|error| format!("could not clear the session: {error}"))?;
    let _ = window.eval("location.hash = '#/'; location.reload();");
    Ok(())
}

#[tauri::command]
async fn yt_raw(
    state: State<'_, AppState>,
    method: String,
    body: String,
    client: Option<String>,
) -> Result<String, String> {
    if std::env::var("WINTUBE_DEBUG").as_deref() != Ok("1") {
        return Err("raw API access is disabled".into());
    }
    let mut payload: serde_json::Value =
        serde_json::from_str(if body.trim().is_empty() { "{}" } else { &body })
            .map_err(|error| format!("invalid JSON: {error}"))?;
    if let (Some(client), Some(map)) = (client, payload.as_object_mut()) {
        let client: serde_json::Value = serde_json::from_str(&client)
            .map_err(|error| format!("invalid client JSON: {error}"))?;
        map.insert("context".into(), serde_json::json!({ "client": client }));
    }
    let json = state.yt.post_with_context(&method, payload).await?;
    Ok(json.to_string())
}

/// `--probe home`, `--probe search:<query>` or `--probe watch:<id>`.
/// Prints the normalised payload so parsing can be verified without a window.
async fn probe(argument: &str) -> Result<(), String> {
    let yt = InnerTube::new();
    let (kind, value) = argument.split_once(':').unwrap_or((argument, ""));

    let json = match kind {
        "home" => serde_json::to_value(yt.home().await?),
        "search" => serde_json::to_value(yt.search(value, None).await?),
        "watch" => serde_json::to_value(yt.watch(value).await?),
        other => return Err(format!("unknown probe target: {other}")),
    }
    .map_err(|error| error.to_string())?;

    println!(
        "{}",
        serde_json::to_string_pretty(&json).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let open_hash = args
        .iter()
        .find_map(|arg| arg.strip_prefix("--open=").map(str::to_string));
    let sign_in_on_start = args.iter().any(|arg| arg == "--sign-in");

    if let Some(argument) = args.get(2)
        && args.get(1).map(String::as_str) == Some("--probe")
    {
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        if let Err(error) = runtime.block_on(probe(argument)) {
            eprintln!("probe failed: {error}");
            std::process::exit(1);
        }
        return;
    }

    tauri::Builder::default()
        .manage(AppState {
            yt: Arc::new(InnerTube::new()),
        })
        .setup(move |app| {
            if let Ok(dir) = app.path().app_data_dir() {
                progress::init(dir);
            }
            match tauri::async_runtime::block_on(MediaProxy::start()) {
                Ok(proxy) => {
                    let _ = MEDIA.set(Arc::new(proxy));
                }
                Err(error) => eprintln!("media proxy: {error}"),
            }
            if sign_in_on_start {
                let yt = app.state::<AppState>().yt.clone();
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(800));
                    let _ = begin_sign_in(&handle, yt);
                });
            }
            if let Some(hash) = &open_hash {
                let window = app.get_webview_window("main");
                let script = format!("location.hash = '{}';", hash.replace('\'', ""));
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    if let Some(window) = window {
                        let _ = window.eval(&script);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            yt_home,
            yt_search,
            yt_feed,
            yt_more,
            yt_channel,
            yt_channel_tab,
            yt_notifications,
            yt_rate,
            yt_subscribe,
            yt_watch_later,
            yt_comments,
            yt_comment_post,
            yt_download,
            yt_streams,
            yt_progress_get,
            yt_progress_set,
            yt_progress_clear,
            yt_playlists,
            yt_playlist_edit,
            yt_shorts,
            yt_watch,
            yt_account,
            yt_guide,
            yt_auth_status,
            yt_sign_in,
            yt_sign_out,
            yt_raw,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running WinTube");
}
