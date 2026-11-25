use crate::innertube::USER_AGENT;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Chromium asks for media with an open-ended `Range: bytes=0-`. Google's
/// video CDN answers those at roughly playback speed, but a bounded range
/// (a few megabytes) comes down at full speed. This tiny local server turns
/// each media request into one bounded CDN range, so the player gets a fast
/// buffer without needing a codec pipeline of its own.
pub struct MediaProxy {
    port: u16,
    streams: Arc<Mutex<HashMap<String, Stream>>>,
    lives: Arc<Mutex<HashMap<String, Live>>>,
}

struct Stream {
    url: String,
    content_type: String,
}

/// A live source: the HLS video and audio renditions picked for one height.
/// Both are ordinary HTTPS URLs; ffmpeg does the muxing.
struct Live {
    video: String,
    audio: Option<String>,
}

const CHUNK: u64 = 6 * 1024 * 1024;
static TOKENS: AtomicU64 = AtomicU64::new(1);

impl MediaProxy {
    pub async fn start() -> Result<Self, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|error| format!("media proxy could not start: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();

        let streams = Arc::new(Mutex::new(HashMap::<String, Stream>::new()));
        let lives = Arc::new(Mutex::new(HashMap::<String, Live>::new()));
        let shared = streams.clone();
        let shared_lives = lives.clone();
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((socket, _)) => {
                        let streams = shared.clone();
                        let lives = shared_lives.clone();
                        tokio::spawn(async move {
                            let _ = serve(socket, streams, lives).await;
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            port,
            streams,
            lives,
        })
    }

    pub fn local_url(&self, url: &str, kind: &str, mime: &str) -> String {
        let token = new_token();
        if let Ok(mut streams) = self.streams.lock() {
            streams.insert(
                token.clone(),
                Stream {
                    url: url.to_string(),
                    content_type: content_type(kind, mime),
                },
            );
        }
        format!("http://127.0.0.1:{}/media/{token}", self.port)
    }

    /// Live streams are two HLS renditions. ffmpeg pulls both, muxes them into
    /// one fragmented MP4, and the player gets a single media element.
    pub fn live_url(&self, video: &str, audio: Option<&str>) -> String {
        let token = new_token();
        if let Ok(mut lives) = self.lives.lock() {
            lives.insert(
                token.clone(),
                Live {
                    video: video.to_string(),
                    audio: audio.map(str::to_string),
                },
            );
        }
        format!("http://127.0.0.1:{}/live/{token}", self.port)
    }
}

fn content_type(kind: &str, mime: &str) -> String {
    match (kind, mime) {
        ("audio", "m4a") => "audio/mp4",
        ("audio", "webm") => "audio/webm",
        (_, "mp4") => "video/mp4",
        (_, "webm") => "video/webm",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn new_token() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let count = TOKENS.fetch_add(1, Ordering::Relaxed);
    format!("{now:x}{count:x}")
}

async fn serve(
    mut socket: TcpStream,
    streams: Arc<Mutex<HashMap<String, Stream>>>,
    lives: Arc<Mutex<HashMap<String, Live>>>,
) -> Result<(), String> {
    let mut head = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let read = socket
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(());
        }
        head.extend_from_slice(&chunk[..read]);
        if head.windows(4).any(|window| window == b"\r\n\r\n") || head.len() > 16384 {
            break;
        }
    }

    let request = String::from_utf8_lossy(&head).to_string();
    let mut lines = request.lines();
    let Some(request_line) = lines.next() else {
        return Ok(());
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();
    if method != "GET" {
        respond_plain(
            &mut socket,
            "405 Method Not Allowed",
            "only GET is supported",
        )
        .await?;
        return Ok(());
    }

    let range = lines
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("range"))
        .and_then(|(_, value)| parse_range(value.trim()));

    if let Some(token) = path.strip_prefix("/live/") {
        let live = lives.lock().ok().and_then(|lives| {
            lives
                .get(token)
                .map(|entry| (entry.video.clone(), entry.audio.clone()))
        });
        let Some((video, audio)) = live else {
            respond_plain(&mut socket, "404 Not Found", "unknown live stream").await?;
            return Ok(());
        };
        return stream_live(&mut socket, &video, audio.as_deref()).await;
    }

    let token = path.strip_prefix("/media/").unwrap_or_default();
    let stream = streams.lock().ok().and_then(|streams| {
        streams
            .get(token)
            .map(|entry| (entry.url.clone(), entry.content_type.clone()))
    });
    let Some((url, content_type)) = stream else {
        respond_plain(&mut socket, "404 Not Found", "unknown media").await?;
        return Ok(());
    };

    let (start, requested_end) = range.unwrap_or((0, None));
    let mut up_end = start.saturating_add(CHUNK - 1);
    if let Some(end) = requested_end {
        up_end = up_end.min(end);
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(&url)
        .header("range", format!("bytes={start}-{up_end}"))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if response.status().as_u16() == 416 {
        respond_plain(&mut socket, "416 Range Not Satisfiable", "").await?;
        return Ok(());
    }

    let content_range = response
        .headers()
        .get("content-range")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let partial = response.status().as_u16() == 206;
    let (returned_start, returned_end, total) =
        match content_range.as_deref().and_then(parse_content_range) {
            Some((first, last, total)) => (first, last, total),
            None => {
                let length = response
                    .content_length()
                    .unwrap_or(up_end.saturating_sub(start) + 1);
                (start, start + length.saturating_sub(1), start + length)
            }
        };

    let length = returned_end
        .saturating_sub(returned_start)
        .saturating_add(1);
    let mut head = String::new();
    head.push_str("HTTP/1.1 206 Partial Content\r\n");
    head.push_str(&format!("Content-Type: {content_type}\r\n"));
    head.push_str(&format!("Content-Length: {length}\r\n"));
    head.push_str(&format!(
        "Content-Range: bytes {returned_start}-{returned_end}/{total}\r\n"
    ));
    head.push_str("Accept-Ranges: bytes\r\n");
    head.push_str("Access-Control-Allow-Origin: *\r\n");
    head.push_str("Cache-Control: no-store\r\n");
    head.push_str("Connection: close\r\n\r\n");
    socket
        .write_all(head.as_bytes())
        .await
        .map_err(|error| error.to_string())?;

    let skip = if partial { 0 } else { start };
    stream_body(&mut socket, response, skip, length).await
}

async fn stream_live(
    socket: &mut TcpStream,
    video: &str,
    audio: Option<&str>,
) -> Result<(), String> {
    let mut command = tokio::process::Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error"])
        .args([
            "-fflags",
            "nobuffer",
            "-probesize",
            "32768",
            "-analyzeduration",
            "0",
        ])
        .args(["-i", video]);
    if let Some(audio) = audio {
        command
            .args([
                "-fflags",
                "nobuffer",
                "-probesize",
                "32768",
                "-analyzeduration",
                "0",
            ])
            .args(["-i", audio]);
    }
    command.args(["-map", "0:v:0", "-c:v", "copy"]);
    // Separate audio rendition when there is one. Some broadcasts come as a
    // single muxed rendition; then the audio rides along with input 0.
    match audio {
        Some(_) => {
            command.args(["-map", "1:a:0"]);
        }
        None => {
            command.args(["-map", "0:a:0?"]);
        }
    }
    // YouTube's HLS audio is AAC; re-wrap it so Chromium's decoder accepts
    // the track inside MP4.
    command.args([
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "48000",
    ]);
    command
        .args([
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000);

    let mut child = command
        .spawn()
        .map_err(|error| format!("ffmpeg is not available: {error}"))?;
    let Some(mut out) = child.stdout.take() else {
        let _ = child.kill().await;
        return Err("ffmpeg produced no output".into());
    };

    // No Content-Length: the stream is open ended, so Chromium keeps reading
    // as ffmpeg publishes fragments. `Connection: close` ends the body when
    // the broadcast stops.
    let head = "HTTP/1.1 200 OK\r\n\
                Content-Type: video/mp4\r\n\
                Cache-Control: no-store\r\n\
                Access-Control-Allow-Origin: *\r\n\
                Connection: close\r\n\r\n";
    socket
        .write_all(head.as_bytes())
        .await
        .map_err(|error| error.to_string())?;

    let result = tokio::io::copy(&mut out, socket).await;
    drop(out);
    let _ = child.kill().await;
    result.map(|_| ()).map_err(|error| error.to_string())
}

async fn stream_body(
    socket: &mut TcpStream,
    mut response: reqwest::Response,
    mut skip: u64,
    length: u64,
) -> Result<(), String> {
    let mut remaining = length;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        let mut data = &chunk[..];
        if skip > 0 {
            if (data.len() as u64) <= skip {
                skip -= data.len() as u64;
                continue;
            }
            data = &data[skip as usize..];
            skip = 0;
        }
        if remaining == 0 {
            break;
        }
        let take = data.len().min(remaining as usize);
        if socket.write_all(&data[..take]).await.is_err() {
            break;
        }
        remaining -= take as u64;
        if remaining == 0 {
            break;
        }
    }
    Ok(())
}

fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
    let value = value.strip_prefix("bytes=")?;
    let (start, end) = value.split_once('-')?;
    let start = start.trim().parse().ok()?;
    let end = end.trim();
    let end = if end.is_empty() {
        None
    } else {
        Some(end.parse().ok()?)
    };
    Some((start, end))
}

/// `bytes 0-6291455/26455880`
fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let value = value.strip_prefix("bytes ")?;
    let (span, total) = value.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    Some((
        start.trim().parse().ok()?,
        end.trim().parse().ok()?,
        total.trim().parse().ok()?,
    ))
}

async fn respond_plain(socket: &mut TcpStream, status: &str, body: &str) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
    Ok(())
}
