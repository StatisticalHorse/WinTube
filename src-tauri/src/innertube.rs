//! Minimal InnerTube client.
//!
//! The app talks to YouTube's public web API the same way youtube.com does, and
//! normalises the very deep renderer trees into the small DTOs the UI needs.
//! Every parser is defensive: a missing node yields an empty value, never a panic,
//! because YouTube reshapes these payloads without notice.

use serde::Serialize;
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const API_KEY: &str = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CLIENT_VERSION: &str = "2.20261118.00.00";
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_id: String,
    pub avatar: String,
    pub views: String,
    pub published: String,
    pub duration: String,
    pub thumbnail: String,
    pub live: bool,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chip {
    pub label: String,
    pub selected: bool,
    pub params: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    /// `videos`, `shorts`, `playlists` or `posts`.
    pub kind: String,
    /// Empty for the default grid, `shelf` for a five-across row, `grid` for a
    /// portrait wall of Shorts.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub style: String,
    pub title: String,
    pub items: Vec<Video>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub playlists: Vec<PlaylistItem>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub posts: Vec<PostItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub featured: Option<Featured>,
}

impl Section {
    fn videos(title: impl Into<String>, items: Vec<Video>) -> Self {
        Self {
            kind: "videos".into(),
            style: String::new(),
            title: title.into(),
            items,
            playlists: Vec::new(),
            posts: Vec::new(),
            featured: None,
        }
    }

    fn shorts(items: Vec<Video>) -> Self {
        Self {
            kind: "shorts".into(),
            style: "shelf".into(),
            title: "Shorts".into(),
            items,
            playlists: Vec::new(),
            posts: Vec::new(),
            featured: None,
        }
    }

    fn shorts_grid(items: Vec<Video>) -> Self {
        Self {
            kind: "shorts".into(),
            style: "grid".into(),
            title: "Shorts".into(),
            items,
            playlists: Vec::new(),
            posts: Vec::new(),
            featured: None,
        }
    }

    fn playlists(title: impl Into<String>, playlists: Vec<PlaylistItem>) -> Self {
        Self {
            kind: "playlists".into(),
            style: String::new(),
            title: title.into(),
            items: Vec::new(),
            playlists,
            posts: Vec::new(),
            featured: None,
        }
    }

    fn posts(title: impl Into<String>, posts: Vec<PostItem>) -> Self {
        Self {
            kind: "posts".into(),
            style: String::new(),
            title: title.into(),
            items: Vec::new(),
            playlists: Vec::new(),
            posts,
            featured: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: String,
    pub title: String,
    pub thumbnail: String,
    pub count: String,
    pub channel: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostItem {
    pub id: String,
    pub author: String,
    pub avatar: String,
    pub text: String,
    pub likes: String,
    pub published: String,
    pub image: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Featured {
    pub video: Video,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub chips: Vec<Chip>,
    pub sections: Vec<Section>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelHeader {
    pub id: String,
    pub title: String,
    pub handle: String,
    pub subscribers: String,
    pub videos: String,
    pub description: String,
    pub avatar: String,
    pub banner: String,
    pub subscribed: bool,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub title: String,
    pub params: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPage {
    pub header: ChannelHeader,
    pub tabs: Vec<Tab>,
    pub feed: Feed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: String,
    pub text: String,
    pub when: String,
    pub thumbnail: String,
    pub video_id: String,
    pub channel_id: String,
    pub read: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentPage {
    pub count: String,
    pub comments: Vec<Comment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub avatar: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub avatar: String,
    pub channel_id: String,
    pub published: String,
    pub text: String,
    pub likes: String,
    pub replies: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replies_token: Option<String>,
    pub pinned: bool,
    pub owner: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchPage {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_id: String,
    pub avatar: String,
    pub verified: bool,
    pub subscribers: String,
    pub views: String,
    pub published: String,
    pub likes: String,
    pub description: String,
    pub comment_count: String,
    pub comments: Vec<Comment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments_token: Option<String>,
    pub related: Vec<Video>,
    pub related_title: String,
    pub rating: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistOption {
    pub id: String,
    pub title: String,
    pub privacy: String,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamFormat {
    pub itag: i64,
    pub kind: String,
    pub label: String,
    pub height: u32,
    pub url: String,
    pub mime: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitle {
    pub lang: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Streams {
    pub formats: Vec<StreamFormat>,
    pub subtitle: Option<Subtitle>,
    pub duration: f64,
}

pub struct InnerTube {
    http: reqwest::Client,
    auth: RwLock<Option<Auth>>,
    streams: Mutex<HashMap<String, (Instant, Streams)>>,
}

/// Everything needed to make a request as the signed-in viewer. The cookie
/// header carries the session; the hash proves to InnerTube that the request
/// comes from youtube.com with the same SAPISID cookie.
struct Auth {
    cookie: String,
    sapisid: String,
}

impl Auth {
    fn authorization(&self) -> String {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default();
        let digest = Sha1::digest(format!(
            "{seconds} {} https://www.youtube.com",
            self.sapisid
        ));
        let hash: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        format!("SAPISIDHASH {seconds}_{hash}")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideEntry {
    pub title: String,
    pub browse_id: String,
    pub params: String,
    pub icon: String,
    pub avatar: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    pub entries: Vec<GuideEntry>,
    pub channels: Vec<Channel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub avatar: String,
    pub handle: String,
    pub channel_id: String,
}

impl InnerTube {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .expect("http client");
        Self {
            http,
            auth: RwLock::new(None),
            streams: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_auth(&self, cookie: String, sapisid: String) {
        if let Ok(mut auth) = self.auth.write() {
            *auth = Some(Auth { cookie, sapisid });
        }
    }

    pub fn has_auth(&self) -> bool {
        self.auth.read().map(|auth| auth.is_some()).unwrap_or(false)
    }

    pub fn clear_auth(&self) {
        if let Ok(mut auth) = self.auth.write() {
            *auth = None;
        }
    }

    pub async fn guide(&self) -> Guide {
        let json = self
            .post("guide", serde_json::json!({ "context": Self::context() }))
            .await
            .unwrap_or(Value::Null);

        let mut channels: Vec<Channel> = Vec::new();
        let mut entries: Vec<GuideEntry> = Vec::new();

        for entry in collect(&json, "guideEntryRenderer") {
            let title = text_field(entry, "formattedTitle");
            if title.is_empty() {
                continue;
            }
            let id = dig(entry, &["entryData", "guideEntryData", "guideEntryId"])
                .and_then(Value::as_str)
                .or_else(|| entry.get("entryId").and_then(Value::as_str))
                .unwrap_or_default();
            let avatar = dig(entry, &["thumbnail", "thumbnails"])
                .map(best_source)
                .unwrap_or_default();

            if id.starts_with("UC") && !channels.iter().any(|channel| channel.id == id) {
                channels.push(Channel {
                    id: id.to_string(),
                    name: title.clone(),
                    avatar: avatar.clone(),
                });
            }

            entries.push(GuideEntry {
                title,
                browse_id: dig(entry, &["navigationEndpoint", "browseEndpoint", "browseId"])
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                params: dig(entry, &["navigationEndpoint", "browseEndpoint", "params"])
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                icon: dig(entry, &["icon", "iconType"])
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                avatar,
            });
        }

        Guide { entries, channels }
    }

    pub async fn account(&self) -> Option<Account> {
        let json = self
            .post(
                "account/accounts_list",
                serde_json::json!({ "context": Self::context() }),
            )
            .await
            .ok()?;

        let items = collect(&json, "accountItem");
        let selected = items
            .iter()
            .find(|item| item.get("isSelected").and_then(Value::as_bool) == Some(true))
            .or_else(|| items.first())?;

        let handle = text_field(selected, "channelHandle");
        let channel_id = self.resolve_handle(&handle).await.unwrap_or_default();

        Some(Account {
            name: text_field(selected, "accountName"),
            avatar: dig(selected, &["accountPhoto", "thumbnails"])
                .map(best_source)
                .unwrap_or_default(),
            handle,
            channel_id,
        })
    }

    async fn resolve_handle(&self, handle: &str) -> Option<String> {
        if !handle.starts_with('@') {
            return None;
        }
        let json = self
            .post(
                "navigation/resolve_url",
                serde_json::json!({
                    "context": Self::context(),
                    "url": format!("https://www.youtube.com/{handle}")
                }),
            )
            .await
            .ok()?;
        dig(&json, &["endpoint", "browseEndpoint", "browseId"])
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    fn context() -> Value {
        serde_json::json!({
            "client": {
                "clientName": "WEB",
                "clientVersion": CLIENT_VERSION,
                "hl": "en",
                "gl": "US",
                "userAgent": USER_AGENT,
                "originalUrl": "https://www.youtube.com/",
                "platform": "DESKTOP"
            }
        })
    }

    pub async fn post_with_context(&self, method: &str, mut body: Value) -> Result<Value, String> {
        if let Value::Object(map) = &mut body
            && !map.contains_key("context")
        {
            map.insert("context".into(), Self::context());
        }
        self.post(method, body).await
    }

    async fn post(&self, method: &str, body: Value) -> Result<Value, String> {
        let url =
            format!("https://www.youtube.com/youtubei/v1/{method}?key={API_KEY}&prettyPrint=false");
        let auth = self.auth.read().ok().and_then(|guard| {
            guard
                .as_ref()
                .map(|auth| (auth.cookie.clone(), auth.authorization()))
        });

        let mut request = self
            .http
            .post(url)
            .header("content-type", "application/json")
            .header("accept-language", "en-US,en;q=0.9")
            .header("origin", "https://www.youtube.com")
            .header("x-youtube-client-name", "1")
            .header("x-youtube-client-version", CLIENT_VERSION);

        if let Some((cookie, authorization)) = auth {
            request = request
                .header("cookie", cookie)
                .header("authorization", authorization)
                .header("x-goog-authuser", "0")
                .header("x-origin", "https://www.youtube.com");
        }

        let response = request
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("request failed: {error}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("YouTube answered {status}"));
        }
        response
            .json::<Value>()
            .await
            .map_err(|error| format!("invalid JSON: {error}"))
    }

    pub async fn home(&self) -> Result<Feed, String> {
        let body = serde_json::json!({
            "context": Self::context(),
            "browseId": "FEwhat_to_watch"
        });
        let json = self.post("browse", body).await?;
        Ok(parse_feed(&json))
    }

    pub async fn search(&self, query: &str, params: Option<&str>) -> Result<Feed, String> {
        let mut body = serde_json::json!({
            "context": Self::context(),
            "query": query
        });
        if let Some(params) = params
            && let Some(map) = body.as_object_mut()
        {
            map.insert("params".into(), Value::String(params.to_string()));
        }
        let json = self.post("search", body).await?;
        Ok(parse_feed(&json))
    }

    pub async fn feed(&self, browse_id: &str, params: Option<&str>) -> Result<Feed, String> {
        let mut body = serde_json::json!({
            "context": Self::context(),
            "browseId": browse_id
        });
        if let Some(params) = params
            && let Some(map) = body.as_object_mut()
        {
            map.insert("params".into(), Value::String(params.to_string()));
        }
        let json = self.post("browse", body).await?;
        Ok(parse_feed(&json))
    }

    pub async fn more(&self, continuation: &str) -> Result<Feed, String> {
        let json = self
            .post(
                "browse",
                serde_json::json!({
                    "context": Self::context(),
                    "continuation": continuation
                }),
            )
            .await?;
        Ok(parse_feed(&json))
    }

    pub async fn channel(&self, channel_id: &str) -> Result<ChannelPage, String> {
        let json = self
            .post(
                "browse",
                serde_json::json!({
                    "context": Self::context(),
                    "browseId": channel_id
                }),
            )
            .await?;
        Ok(parse_channel(channel_id, &json))
    }

    pub async fn channel_tab(&self, channel_id: &str, params: &str) -> Result<Feed, String> {
        let json = self
            .post(
                "browse",
                serde_json::json!({
                    "context": Self::context(),
                    "browseId": channel_id,
                    "params": params
                }),
            )
            .await?;
        Ok(parse_feed(&json))
    }

    pub async fn notifications(&self) -> Result<Vec<NotificationItem>, String> {
        let json = self
            .post(
                "notification/get_notification_menu",
                serde_json::json!({ "context": Self::context() }),
            )
            .await?;

        let mut items = Vec::new();
        for renderer in collect(&json, "notificationRenderer") {
            let id = renderer
                .get("notificationId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let text = text_field(renderer, "shortMessage");
            if text.is_empty() {
                continue;
            }
            let endpoint = renderer.get("navigationEndpoint");
            let video_id = endpoint
                .and_then(|value| dig(value, &["watchEndpoint", "videoId"]))
                .or_else(|| {
                    dig(
                        endpoint.unwrap_or(&Value::Null),
                        &["reelWatchEndpoint", "videoId"],
                    )
                })
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let channel_id = dig(
                endpoint.unwrap_or(&Value::Null),
                &["browseEndpoint", "browseId"],
            )
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

            items.push(NotificationItem {
                id,
                text,
                when: text_field(renderer, "sentTimeText"),
                thumbnail: dig(renderer, &["thumbnail", "thumbnails"])
                    .map(best_source)
                    .unwrap_or_default(),
                video_id,
                channel_id,
                read: renderer
                    .get("read")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            });
        }
        Ok(items)
    }

    pub async fn rate(&self, video_id: &str, rating: &str) -> Result<(), String> {
        let method = match rating {
            "like" => "like/like",
            "dislike" => "like/dislike",
            _ => "like/removelike",
        };
        self.post(
            method,
            serde_json::json!({
                "context": Self::context(),
                "target": { "videoId": video_id }
            }),
        )
        .await
        .map(|_| ())
    }

    pub async fn subscribe(&self, channel_id: &str, subscribed: bool) -> Result<(), String> {
        let method = if subscribed {
            "subscription/subscribe"
        } else {
            "subscription/unsubscribe"
        };
        let params = if subscribed { "EgIIAhgA" } else { "CgIIAhgA" };
        self.post(
            method,
            serde_json::json!({
                "context": Self::context(),
                "channelIds": [channel_id],
                "params": params
            }),
        )
        .await
        .map(|_| ())
    }

    pub async fn watch_later(&self, video_id: &str, add: bool) -> Result<(), String> {
        let action = if add {
            serde_json::json!({ "action": "ACTION_ADD_VIDEO", "addedVideoId": video_id })
        } else {
            serde_json::json!({ "action": "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", "removedVideoId": video_id })
        };
        self.post(
            "browse/edit_playlist",
            serde_json::json!({
                "context": Self::context(),
                "playlistId": "WL",
                "actions": [action]
            }),
        )
        .await
        .map(|_| ())
    }

    /// The viewer's playlists, each flagged with whether this video is already
    /// in it. This is the payload behind YouTube's "Save to playlist" panel.
    pub async fn playlists(&self, video_id: &str) -> Result<Vec<PlaylistOption>, String> {
        let json = self
            .post(
                "playlist/get_add_to_playlist",
                serde_json::json!({
                    "context": Self::context(),
                    "videoIds": [video_id]
                }),
            )
            .await?;

        let entries = dig(
            &json,
            &["contents", "0", "addToPlaylistRenderer", "playlists"],
        )
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

        let mut options = Vec::new();
        for entry in entries {
            let option = entry.get("playlistAddToOptionRenderer").unwrap_or(&entry);
            let Some(id) = option.get("playlistId").and_then(Value::as_str) else {
                continue;
            };
            let privacy = match option.get("privacy").and_then(Value::as_str) {
                Some("PUBLIC") => "Public",
                Some("UNLISTED") => "Unlisted",
                _ => "Private",
            };
            options.push(PlaylistOption {
                id: id.to_string(),
                title: text_field(option, "title"),
                privacy: privacy.to_string(),
                selected: option.get("containsSelectedVideos").and_then(Value::as_str)
                    == Some("ALL"),
            });
        }
        Ok(options)
    }

    pub async fn edit_playlist(
        &self,
        playlist_id: &str,
        video_id: &str,
        add: bool,
    ) -> Result<(), String> {
        let action = if add {
            serde_json::json!({ "action": "ACTION_ADD_VIDEO", "addedVideoId": video_id })
        } else {
            serde_json::json!({ "action": "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", "removedVideoId": video_id })
        };
        self.post(
            "browse/edit_playlist",
            serde_json::json!({
                "context": Self::context(),
                "playlistId": playlist_id,
                "actions": [action]
            }),
        )
        .await
        .map(|_| ())
    }

    pub async fn streams(&self, video_id: &str) -> Result<Streams, String> {
        if let Ok(cache) = self.streams.lock()
            && let Some((at, data)) = cache.get(video_id)
            && at.elapsed() < Duration::from_secs(20 * 60)
        {
            return Ok(data.clone());
        }

        let resolved = match self.resolve_with_ytdlp(video_id).await {
            Ok(streams) => streams,
            Err(first) => self
                .resolve_muxed(video_id)
                .await
                .map_err(|second| format!("{first}; fallback failed: {second}"))?,
        };

        if let Ok(mut cache) = self.streams.lock() {
            cache.insert(video_id.to_string(), (Instant::now(), resolved.clone()));
        }
        Ok(resolved)
    }

    async fn resolve_with_ytdlp(&self, video_id: &str) -> Result<Streams, String> {
        let url = format!("https://www.youtube.com/watch?v={video_id}");
        let output = tokio::process::Command::new("yt-dlp")
            .args([
                "-J",
                "--no-warnings",
                "--no-playlist",
                "--skip-download",
                "--no-progress",
                &url,
            ])
            .creation_flags(0x08000000)
            .output()
            .await
            .map_err(|error| format!("yt-dlp is not available: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let last = stderr.lines().last().unwrap_or("unknown error");
            return Err(format!("yt-dlp failed: {last}"));
        }

        let json: Value =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        let mut streams = parse_streams_json(&json);

        if let Some((lang, subtitle_url)) = first_subtitle(&json) {
            if let Ok(response) = self
                .http
                .get(&subtitle_url)
                .header("accept-language", "en-US,en;q=0.9")
                .send()
                .await
                && response.status().is_success()
                && let Ok(text) = response.text().await
            {
                streams.subtitle = Some(Subtitle { lang, text });
            }
        }

        if streams.formats.is_empty() {
            return Err("yt-dlp returned no playable formats".into());
        }
        Ok(streams)
    }

    async fn resolve_muxed(&self, video_id: &str) -> Result<Streams, String> {
        let player = self
            .post(
                "player",
                serde_json::json!({
                    "context": Self::context(),
                    "videoId": video_id,
                    "contentCheckOk": true,
                    "racyCheckOk": true
                }),
            )
            .await?;

        let formats = dig(&player, &["streamingData", "formats"])
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mut resolved = Vec::new();
        for format in formats {
            let Some(url) = format.get("url").and_then(Value::as_str) else {
                continue;
            };
            let height = format.get("height").and_then(Value::as_u64).unwrap_or(360) as u32;
            resolved.push(StreamFormat {
                itag: format.get("itag").and_then(Value::as_i64).unwrap_or(18),
                kind: "muxed".into(),
                label: format!("{height}p"),
                height,
                url: url.to_string(),
                mime: "video/mp4".into(),
            });
        }

        if resolved.is_empty() {
            return Err("no playable stream was returned".into());
        }
        Ok(Streams {
            formats: resolved,
            subtitle: None,
            duration: dig(&player, &["videoDetails", "lengthSeconds"])
                .and_then(Value::as_str)
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0),
        })
    }

    pub async fn reel_sequence(&self, short_id: Option<&str>) -> Result<Vec<String>, String> {
        use base64::Engine;

        let sequence = match short_id {
            Some(id) => {
                let mut bytes = vec![0x0A, id.len() as u8];
                bytes.extend_from_slice(id.as_bytes());
                bytes.extend_from_slice(&[0x18, 0x05]);
                base64::engine::general_purpose::STANDARD.encode(bytes)
            }
            None => "CA8=".to_string(),
        };

        let json = self
            .post(
                "reel/reel_watch_sequence",
                serde_json::json!({
                    "context": Self::context(),
                    "sequenceParams": sequence
                }),
            )
            .await?;

        let mut ids = Vec::new();
        for endpoint in collect(&json, "reelWatchEndpoint") {
            if let Some(id) = endpoint.get("videoId").and_then(Value::as_str)
                && !ids.iter().any(|entry| entry == id)
            {
                ids.push(id.to_string());
            }
        }
        for entry in collect(&json, "reelItemRenderer") {
            if let Some(id) = entry.get("videoId").and_then(Value::as_str)
                && !ids.iter().any(|existing| existing == id)
            {
                ids.push(id.to_string());
            }
        }

        if ids.is_empty() {
            return Err("YouTube returned no Shorts for this sequence".into());
        }
        Ok(ids)
    }

    pub async fn watch(&self, video_id: &str) -> Result<WatchPage, String> {
        let player = self
            .post(
                "player",
                serde_json::json!({
                    "context": Self::context(),
                    "videoId": video_id,
                    "contentCheckOk": true,
                    "racyCheckOk": true
                }),
            )
            .await?;

        let next = self
            .post(
                "next",
                serde_json::json!({
                    "context": Self::context(),
                    "videoId": video_id
                }),
            )
            .await?;

        let mut page = parse_watch(video_id, &player, &next);

        if let Some(token) = comment_token(&next)
            && let Ok(comments) = self.comment_page(&token).await
        {
            page.comment_count = comments.0;
            page.comments = comments.1;
            page.comments_token = comments.2;
        }
        Ok(page)
    }

    pub async fn comments(&self, token: &str) -> Result<CommentPage, String> {
        let (count, comments, continuation) = self.comment_page(token).await?;
        Ok(CommentPage {
            count,
            comments,
            continuation,
        })
    }

    pub async fn post_comment(
        &self,
        video_id: &str,
        text: &str,
        parent_comment_id: Option<&str>,
    ) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("the comment is empty".into());
        }

        let (method, key, params) = match parent_comment_id {
            Some(parent) => (
                "comment/create_comment_reply",
                "createReplyParams",
                reply_params(video_id, parent),
            ),
            None => (
                "comment/create_comment",
                "createCommentParams",
                comment_params(video_id),
            ),
        };

        let mut body = serde_json::json!({
            "context": Self::context(),
            "commentText": text
        });
        if let Some(map) = body.as_object_mut() {
            map.insert(key.into(), Value::String(params));
        }

        let json = self.post(method, body).await?;
        if let Some(status) = dig(&json, &["actionResult", "status"]).and_then(Value::as_str)
            && status != "STATUS_SUCCEEDED"
        {
            return Err(format!("YouTube answered {status}"));
        }
        Ok(())
    }

    async fn comment_page(
        &self,
        token: &str,
    ) -> Result<(String, Vec<Comment>, Option<String>), String> {
        let json = self
            .post(
                "next",
                serde_json::json!({
                    "context": Self::context(),
                    "continuation": token
                }),
            )
            .await?;

        let mut count = String::new();
        let mut comments = Vec::new();

        for header in collect(&json, "commentsHeaderRenderer") {
            count = pick(
                text_field(header, "commentsCount"),
                text_field(header, "countText"),
            );
        }

        // YouTube's current comment payload is an entity graph, not a renderer
        // tree: every comment arrives as a `commentEntityPayload` mutation.
        for payload in collect(&json, "commentEntityPayload") {
            comments.push(comment_from_payload(payload));
        }
        for thread in collect(&json, "commentRenderer") {
            comments.push(comment_from(thread));
        }

        // Replies live behind their own continuation token, which the thread
        // renderers carry even though the comments themselves are entities.
        for thread in collect(&json, "commentThreadRenderer") {
            let id = dig(
                thread,
                &["commentViewModel", "commentViewModel", "commentId"],
            )
            .or_else(|| dig(thread, &["commentViewModel", "commentId"]))
            .and_then(Value::as_str);
            let token = dig(
                thread,
                &[
                    "replies",
                    "commentRepliesRenderer",
                    "contents",
                    "0",
                    "continuationItemRenderer",
                    "continuationEndpoint",
                    "continuationCommand",
                    "token",
                ],
            )
            .and_then(Value::as_str);
            if let (Some(id), Some(token)) = (id, token)
                && let Some(comment) = comments.iter_mut().find(|comment| comment.id == id)
            {
                comment.replies_token = Some(token.to_string());
            }
        }

        let continuation = page_continuation(&json);
        Ok((count.trim().to_string(), comments, continuation))
    }
}

/// The token for the next page of the current list. It is a direct child of
/// `continuationItems`; tokens nested in a thread belong to that thread's
/// replies and must not be mistaken for the next page.
fn page_continuation(json: &Value) -> Option<String> {
    for key in ["onResponseReceivedEndpoints", "onResponseReceivedActions"] {
        for entry in json
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            for command in [
                "reloadContinuationItemsCommand",
                "appendContinuationItemsAction",
            ] {
                let Some(items) =
                    dig(entry, &[command, "continuationItems"]).and_then(Value::as_array)
                else {
                    continue;
                };
                for item in items {
                    if let Some(token) = dig(
                        item,
                        &[
                            "continuationItemRenderer",
                            "continuationEndpoint",
                            "continuationCommand",
                            "token",
                        ],
                    )
                    .and_then(Value::as_str)
                    {
                        return Some(token.to_string());
                    }
                }
            }
        }
    }
    None
}

fn write_varint(out: &mut Vec<u8>, mut value: u64) {
    while value > 0x7f {
        out.push(((value & 0x7f) as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn proto_varint(out: &mut Vec<u8>, field: u64, value: u64) {
    write_varint(out, field << 3);
    write_varint(out, value);
}

fn proto_bytes(out: &mut Vec<u8>, field: u64, bytes: &[u8]) {
    write_varint(out, (field << 3) | 2);
    write_varint(out, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

fn proto_string(out: &mut Vec<u8>, field: u64, value: &str) {
    proto_bytes(out, field, value.as_bytes());
}

fn encode_param(fields: Vec<u8>) -> String {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(fields);
    urlencoding::encode(&encoded).into_owned()
}

fn comment_params(video_id: &str) -> String {
    let mut out = Vec::new();
    proto_string(&mut out, 2, video_id);
    proto_bytes(&mut out, 5, &[]);
    proto_varint(&mut out, 10, 7);
    encode_param(out)
}

fn reply_params(video_id: &str, parent_comment_id: &str) -> String {
    let mut nested = Vec::new();
    proto_varint(&mut nested, 1, 0);

    let mut out = Vec::new();
    proto_string(&mut out, 2, video_id);
    proto_string(&mut out, 4, parent_comment_id);
    proto_bytes(&mut out, 5, &nested);
    proto_varint(&mut out, 10, 7);
    encode_param(out)
}

fn parse_streams_json(json: &Value) -> Streams {
    let entries: Vec<&Value> = json["formats"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|format| {
            format["url"].as_str().is_some()
                && format["protocol"]
                    .as_str()
                    .unwrap_or_default()
                    .starts_with("http")
        })
        .collect();

    let mut formats = Vec::new();

    // One video track per height. H.264 first: WebView2 decodes it in hardware
    // on every Windows box, and its bitrate is a fraction of VP9's.
    let mut videos: Vec<&Value> = entries
        .iter()
        .copied()
        .filter(|format| {
            format["vcodec"].as_str().unwrap_or("none") != "none"
                && format["acodec"].as_str().unwrap_or("none") == "none"
        })
        .collect();
    videos.sort_by(|a, b| {
        codec_rank(a)
            .cmp(&codec_rank(b))
            .then_with(|| fps(b).cmp(&fps(a)))
            .then_with(|| bitrate(a).total_cmp(&bitrate(b)))
    });
    let mut heights = Vec::new();
    for format in videos {
        let height = format["height"].as_u64().unwrap_or(0) as u32;
        if height == 0 || heights.contains(&height) {
            continue;
        }
        heights.push(height);
        let fps = fps(format);
        formats.push(StreamFormat {
            itag: itag(format),
            kind: "video".into(),
            label: if fps >= 50 {
                format!("{height}p{fps}")
            } else {
                format!("{height}p")
            },
            height,
            url: format["url"].as_str().unwrap_or_default().to_string(),
            mime: format["ext"].as_str().unwrap_or_default().to_string(),
        });
    }

    // Audio: YouTube now offers auto-dubbed tracks. Use English when it exists,
    // then the channel's original language, and never leave a video silent.
    let all_audio: Vec<&Value> = entries
        .iter()
        .copied()
        .filter(|format| {
            format["vcodec"].as_str().unwrap_or("none") == "none"
                && format["acodec"].as_str().unwrap_or("none") != "none"
        })
        .collect();
    let english: Vec<&Value> = all_audio
        .iter()
        .copied()
        .filter(|format| language(format).to_lowercase().starts_with("en"))
        .collect();
    let originals: Vec<&Value> = all_audio
        .iter()
        .copied()
        .filter(|format| is_original(format))
        .collect();
    let mut audio = if !english.is_empty() {
        english
    } else if !originals.is_empty() {
        originals
    } else {
        all_audio
    };
    audio.sort_by(|a, b| {
        is_original(b)
            .cmp(&is_original(a))
            .then_with(|| bitrate(b).total_cmp(&bitrate(a)))
    });
    if let Some(format) = audio.first() {
        formats.push(StreamFormat {
            itag: itag(format),
            kind: "audio".into(),
            label: "Audio".into(),
            height: 0,
            url: format["url"].as_str().unwrap_or_default().to_string(),
            mime: format["ext"].as_str().unwrap_or_default().to_string(),
        });
    }

    formats.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| b.height.cmp(&a.height)));

    Streams {
        formats,
        subtitle: None,
        duration: json["duration"].as_f64().unwrap_or(0.0),
    }
}

fn codec_rank(format: &Value) -> u8 {
    match format["vcodec"].as_str().unwrap_or_default() {
        codec if codec.starts_with("avc1") => 0,
        codec if codec.starts_with("av01") => 1,
        codec if codec.starts_with("vp0") => 2,
        _ => 3,
    }
}

fn fps(format: &Value) -> u32 {
    format["fps"].as_f64().unwrap_or(0.0).round() as u32
}

fn bitrate(format: &Value) -> f64 {
    format["abr"]
        .as_f64()
        .or_else(|| format["tbr"].as_f64())
        .unwrap_or(0.0)
}

fn language(format: &Value) -> &str {
    format["language"].as_str().unwrap_or_default()
}

fn is_original(format: &Value) -> bool {
    format["format_note"]
        .as_str()
        .unwrap_or_default()
        .to_lowercase()
        .contains("original")
}

fn itag(format: &Value) -> i64 {
    format["format_id"]
        .as_str()
        .and_then(|value| value.split('-').next())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
}

fn first_subtitle(json: &Value) -> Option<(String, String)> {
    let subtitles = json.get("subtitles")?.as_object()?;
    let mut languages: Vec<&String> = subtitles.keys().collect();
    languages.sort_by_key(|lang| !lang.to_lowercase().starts_with("en"));
    for lang in languages {
        let Some(tracks) = subtitles.get(lang).and_then(Value::as_array) else {
            continue;
        };
        let track = tracks
            .iter()
            .find(|track| track["ext"].as_str() == Some("vtt"))
            .or_else(|| tracks.first())?;
        if let Some(url) = track["url"].as_str() {
            return Some((lang.clone(), url.to_string()));
        }
    }
    None
}

fn parse_feed(json: &Value) -> Feed {
    let mut chips = Vec::new();
    for chip in collect(json, "chipCloudChipRenderer") {
        let label = text_field(chip, "text");
        if label.is_empty() {
            continue;
        }
        let selected = chip
            .get("isSelected")
            .and_then(Value::as_bool)
            .unwrap_or(label == "All");
        let params = chip
            .get("navigationEndpoint")
            .and_then(|value| {
                dig(value, &["searchEndpoint", "params"])
                    .or_else(|| dig(value, &["browseEndpoint", "params"]))
            })
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        chips.push(Chip {
            label,
            selected,
            params,
        });
    }

    let mut sections = Vec::new();

    if let Some(featured) = featured_from(json) {
        sections.push(Section {
            kind: "featured".into(),
            style: String::new(),
            title: String::new(),
            items: Vec::new(),
            playlists: Vec::new(),
            posts: Vec::new(),
            featured: Some(featured),
        });
    }

    if let Some(grid) = collect(json, "richGridRenderer").into_iter().next() {
        sections.extend(parse_grid(grid));
    }

    let mut seen: Vec<String> = sections
        .iter()
        .flat_map(|section| section.items.iter().map(|video| video.id.clone()))
        .collect();
    let from_shelves = parse_shelves(json, &mut seen);
    let (shorts_sections, other_sections): (Vec<Section>, Vec<Section>) = from_shelves
        .into_iter()
        .partition(|section| section.kind == "shorts");
    sections.extend(other_sections);

    let leftovers: Vec<Video> = collect_videos(json)
        .into_iter()
        .filter(|video| !seen.contains(&video.id))
        .collect();
    if !leftovers.is_empty() {
        sections.push(Section::videos("", leftovers));
    }

    sections.extend(shorts_sections);

    let playlists = collect_playlists(json);
    if !playlists.is_empty() {
        sections.push(Section::playlists("Playlists", playlists));
    }

    let posts = collect_posts(json);
    if !posts.is_empty() {
        sections.push(Section::posts("Posts", posts));
    }

    let continuation = collect(json, "continuationItemRenderer")
        .into_iter()
        .find_map(|item| {
            dig(
                item,
                &["continuationEndpoint", "continuationCommand", "token"],
            )
            .and_then(Value::as_str)
            .map(str::to_string)
        });

    Feed {
        chips,
        sections,
        continuation,
    }
}

/// Walks a rich grid in document order so a Shorts shelf keeps its place
/// between the video rows, the way YouTube renders it.
fn parse_grid(grid: &Value) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut videos: Vec<Video> = Vec::new();
    let mut shorts: Vec<Video> = Vec::new();

    fn flush_videos(videos: &mut Vec<Video>, sections: &mut Vec<Section>) {
        if !videos.is_empty() {
            sections.push(Section::videos("", std::mem::take(videos)));
        }
    }

    fn flush_shorts(shorts: &mut Vec<Video>, sections: &mut Vec<Section>) {
        if !shorts.is_empty() {
            sections.push(Section::shorts_grid(std::mem::take(shorts)));
        }
    }

    let Some(items) = grid.get("contents").and_then(Value::as_array) else {
        return sections;
    };

    for item in items {
        if let Some(rich) = item.get("richItemRenderer")
            && let Some(content) = rich.get("content")
        {
            if let Some(video) = content
                .get("videoRenderer")
                .and_then(video_from)
                .or_else(|| content.get("lockupViewModel").and_then(video_from_lockup))
            {
                flush_shorts(&mut shorts, &mut sections);
                videos.push(video);
                continue;
            }
            if let Some(lockup) = content.get("shortsLockupViewModel") {
                if let Some(video) = short_from_lockup(lockup) {
                    flush_videos(&mut videos, &mut sections);
                    shorts.push(video);
                }
                continue;
            }
        }

        if let Some(section) = item.get("richSectionRenderer") {
            let found = parse_shorts(section);
            if !found.is_empty() {
                flush_videos(&mut videos, &mut sections);
                flush_shorts(&mut shorts, &mut sections);
                sections.push(Section::shorts(found));
            }
        }
    }

    flush_videos(&mut videos, &mut sections);
    flush_shorts(&mut shorts, &mut sections);
    sections
}

fn parse_shelves(json: &Value, seen: &mut Vec<String>) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut shorts_sections = Vec::new();

    for shelf in collect(json, "shelfRenderer") {
        let title = text_field(shelf, "title");
        let mut videos = Vec::new();
        for lockup in collect(shelf, "lockupViewModel") {
            if let Some(video) = video_from_lockup(lockup)
                && !seen.contains(&video.id)
            {
                seen.push(video.id.clone());
                videos.push(video);
            }
        }
        for renderer in collect(shelf, "videoRenderer") {
            if let Some(video) = video_from(renderer)
                && !seen.contains(&video.id)
            {
                seen.push(video.id.clone());
                videos.push(video);
            }
        }
        if !videos.is_empty() {
            sections.push(Section::videos(title, videos));
            continue;
        }
        let shorts = parse_shorts(shelf);
        if !shorts.is_empty() {
            shorts_sections.push(Section::shorts(shorts));
            continue;
        }
        let playlists = collect_playlists(shelf);
        if !playlists.is_empty() {
            sections.push(Section::playlists(title, playlists));
        }
    }

    for shelf in collect(json, "reelShelfRenderer") {
        let shorts = parse_shorts(shelf);
        if !shorts.is_empty() {
            let title = text_field(shelf, "title");
            let mut section = Section::shorts(shorts);
            if !title.is_empty() {
                section.title = title;
            }
            shorts_sections.push(section);
        }
    }

    sections.extend(shorts_sections);
    sections
}

fn collect_videos(json: &Value) -> Vec<Video> {
    let mut videos = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for renderer in collect(json, "playlistVideoRenderer") {
        if let Some(video) = video_from_playlist(renderer)
            && !seen.contains(&video.id)
        {
            seen.push(video.id.clone());
            videos.push(video);
        }
    }
    for renderer in collect(json, "videoRenderer") {
        if let Some(video) = video_from(renderer)
            && !seen.contains(&video.id)
        {
            seen.push(video.id.clone());
            videos.push(video);
        }
    }
    for lockup in collect(json, "lockupViewModel") {
        if let Some(video) = video_from_lockup(lockup)
            && !seen.contains(&video.id)
        {
            seen.push(video.id.clone());
            videos.push(video);
        }
    }
    videos
}

fn collect_playlists(json: &Value) -> Vec<PlaylistItem> {
    let mut playlists = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for renderer in collect(json, "gridPlaylistRenderer") {
        if let Some(item) = playlist_from(renderer)
            && !seen.contains(&item.id)
        {
            seen.push(item.id.clone());
            playlists.push(item);
        }
    }
    for lockup in collect(json, "lockupViewModel") {
        if let Some(item) = playlist_from_lockup(lockup)
            && !seen.contains(&item.id)
        {
            seen.push(item.id.clone());
            playlists.push(item);
        }
    }
    playlists
}

fn collect_posts(json: &Value) -> Vec<PostItem> {
    let mut posts = Vec::new();
    for renderer in collect(json, "postRenderer") {
        let text = text_field(renderer, "contentText");
        if text.is_empty() {
            continue;
        }
        let id = renderer
            .get("postId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        posts.push(PostItem {
            id,
            author: text_field(renderer, "authorText"),
            avatar: dig(renderer, &["authorThumbnail", "thumbnails"])
                .map(best_source)
                .unwrap_or_default(),
            text,
            likes: text_field(renderer, "voteCount"),
            published: text_field(renderer, "publishedTimeText"),
            image: dig(
                renderer,
                &[
                    "backstageAttachment",
                    "backstageImageRenderer",
                    "image",
                    "thumbnails",
                ],
            )
            .map(best_source)
            .unwrap_or_default(),
        });
    }
    posts
}

fn video_from_playlist(renderer: &Value) -> Option<Video> {
    let id = renderer.get("videoId").and_then(Value::as_str)?.to_string();
    let title = text_field(renderer, "title");
    if title.is_empty() {
        return None;
    }
    Some(Video {
        id,
        title,
        channel: text_field(renderer, "shortBylineText"),
        channel_id: dig(
            renderer,
            &[
                "shortBylineText",
                "runs",
                "0",
                "navigationEndpoint",
                "browseEndpoint",
                "browseId",
            ],
        )
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string(),
        avatar: String::new(),
        views: String::new(),
        published: String::new(),
        duration: text_field(renderer, "lengthText"),
        thumbnail: dig(renderer, &["thumbnail", "thumbnails"])
            .map(best_source)
            .unwrap_or_default(),
        live: false,
        verified: false,
    })
}

fn playlist_from(renderer: &Value) -> Option<PlaylistItem> {
    let id = renderer
        .get("playlistId")
        .and_then(Value::as_str)?
        .to_string();
    let title = text_field(renderer, "title");
    if title.is_empty() {
        return None;
    }
    Some(PlaylistItem {
        id,
        title,
        thumbnail: dig(renderer, &["thumbnail", "thumbnails"])
            .or_else(|| {
                dig(
                    renderer,
                    &[
                        "thumbnailRenderer",
                        "playlistVideoThumbnailRenderer",
                        "thumbnail",
                        "thumbnails",
                    ],
                )
            })
            .map(best_source)
            .unwrap_or_default(),
        count: text_field(renderer, "videoCountText"),
        channel: text_field(renderer, "shortBylineText"),
    })
}

fn playlist_from_lockup(lockup: &Value) -> Option<PlaylistItem> {
    let content_type = lockup
        .get("contentType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if content_type != "LOCKUP_CONTENT_TYPE_PLAYLIST" {
        return None;
    }
    let id = lockup.get("contentId").and_then(Value::as_str)?.to_string();
    let meta = dig(lockup, &["metadata", "lockupMetadataViewModel"]);
    let title = meta
        .and_then(|value| dig(value, &["title", "content"]))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if title.is_empty() {
        return None;
    }
    let rows = meta
        .and_then(|value| {
            dig(
                value,
                &["metadata", "contentMetadataViewModel", "metadataRows"],
            )
        })
        .unwrap_or(&Value::Null);
    Some(PlaylistItem {
        id,
        title,
        thumbnail: dig(
            lockup,
            &["contentImage", "thumbnailViewModel", "image", "sources"],
        )
        .map(best_source)
        .unwrap_or_default(),
        count: metadata_part(rows, 1, 0),
        channel: metadata_part(rows, 0, 0),
    })
}

fn featured_from(json: &Value) -> Option<Featured> {
    let renderer = collect(json, "channelVideoPlayerRenderer")
        .into_iter()
        .next()?;
    let video_id = renderer.get("videoId").and_then(Value::as_str)?.to_string();
    let title = text_field(renderer, "title");
    let thumbnail = dig(renderer, &["thumbnail", "thumbnails"])
        .map(best_source)
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"));
    Some(Featured {
        video: Video {
            id: video_id,
            title,
            channel: String::new(),
            channel_id: String::new(),
            avatar: String::new(),
            views: text_field(renderer, "viewCountText"),
            published: text_field(renderer, "publishedTimeText"),
            duration: String::new(),
            thumbnail,
            live: false,
            verified: false,
        },
        description: text_field(renderer, "description"),
    })
}

fn parse_channel(channel_id: &str, json: &Value) -> ChannelPage {
    let header_vm = dig(
        json,
        &[
            "header",
            "pageHeaderRenderer",
            "content",
            "pageHeaderViewModel",
        ],
    );

    let mut metadata: Vec<String> = Vec::new();
    if let Some(rows) = header_vm.and_then(|value| {
        dig(
            value,
            &["metadata", "contentMetadataViewModel", "metadataRows"],
        )
    }) {
        for row in rows.as_array().unwrap_or(&Vec::new()).clone() {
            for part in row
                .get("metadataParts")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new())
                .clone()
            {
                let text = dig(&part, &["text", "content"])
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !text.is_empty() {
                    metadata.push(text.to_string());
                }
            }
        }
    }

    let title = header_vm
        .and_then(|value| dig(value, &["title", "dynamicTextViewModel", "text", "content"]))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let subscribed = header_vm
        .and_then(|value| {
            dig(
                value,
                &["actions", "flexibleActionsViewModel", "actionsRows"],
            )
        })
        .and_then(|rows| rows.get(0))
        .and_then(|row| row.get("actions"))
        .and_then(|actions| actions.get(0))
        .and_then(|action| action.get("subscribeButtonViewModel"))
        .and_then(|button| {
            dig(
                button,
                &["subscribeButtonContent", "subscribeState", "subscribed"],
            )
        })
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let verified = header_vm
        .and_then(|value| {
            dig(
                value,
                &[
                    "title",
                    "dynamicTextViewModel",
                    "rendererContext",
                    "accessibilityContext",
                    "label",
                ],
            )
        })
        .and_then(Value::as_str)
        .map(|label| label.contains("Verified"))
        .unwrap_or(false);

    let header = ChannelHeader {
        id: channel_id.to_string(),
        title,
        handle: metadata
            .iter()
            .find(|value| value.starts_with('@'))
            .cloned()
            .unwrap_or_default(),
        subscribers: metadata
            .iter()
            .find(|value| value.contains("subscriber"))
            .cloned()
            .unwrap_or_default(),
        videos: metadata
            .iter()
            .find(|value| value.ends_with("videos") || value.ends_with("video"))
            .cloned()
            .unwrap_or_default(),
        description: header_vm
            .and_then(|value| {
                dig(
                    value,
                    &[
                        "description",
                        "descriptionPreviewViewModel",
                        "description",
                        "content",
                    ],
                )
            })
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        avatar: header_vm
            .and_then(|value| {
                dig(
                    value,
                    &[
                        "image",
                        "decoratedAvatarViewModel",
                        "avatar",
                        "avatarViewModel",
                        "image",
                        "sources",
                    ],
                )
            })
            .map(best_source)
            .unwrap_or_default(),
        banner: header_vm
            .and_then(|value| {
                dig(
                    value,
                    &["banner", "imageBannerViewModel", "image", "sources"],
                )
            })
            .map(best_source)
            .unwrap_or_default(),
        subscribed,
        verified,
    };

    let mut tabs = Vec::new();
    for tab in dig(
        json,
        &["contents", "twoColumnBrowseResultsRenderer", "tabs"],
    )
    .and_then(Value::as_array)
    .unwrap_or(&Vec::new())
    .clone()
    {
        let Some(renderer) = tab.get("tabRenderer") else {
            continue;
        };
        let title = text_field(renderer, "title");
        if title.is_empty() {
            continue;
        }
        let params = dig(renderer, &["endpoint", "browseEndpoint", "params"])
            .or_else(|| renderer.get("params"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let selected = renderer
            .get("selected")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        tabs.push(Tab {
            title,
            params,
            selected,
        });
    }

    ChannelPage {
        header,
        tabs,
        feed: parse_feed(json),
    }
}

fn short_from_lockup(item: &Value) -> Option<Video> {
    let id = item
        .get("entityId")
        .and_then(Value::as_str)
        .and_then(|entity| entity.rsplit('-').next())
        .filter(|value| value.len() == 11)
        .map(str::to_string)
        .or_else(|| {
            dig(
                item,
                &["onTap", "innertubeCommand", "reelWatchEndpoint", "videoId"],
            )
            .and_then(Value::as_str)
            .map(str::to_string)
        })?;
    let thumbnail = dig(
        item,
        &[
            "thumbnail",
            "thumbnailViewModel",
            "thumbnailViewModel",
            "image",
            "sources",
        ],
    )
    .or_else(|| {
        dig(
            item,
            &["thumbnail", "thumbnailViewModel", "image", "sources"],
        )
    })
    .or_else(|| {
        dig(
            item,
            &[
                "thumbnailViewModel",
                "thumbnailViewModel",
                "image",
                "sources",
            ],
        )
    })
    .or_else(|| dig(item, &["thumbnailViewModel", "image", "sources"]))
    .or_else(|| dig(item, &["thumbnail", "sources"]))
    .map(best_source)
    .unwrap_or_default();
    let title = dig(item, &["overlayMetadata", "primaryText"])
        .map(|value| text_field(value, "content"))
        .unwrap_or_default();
    let views = dig(item, &["overlayMetadata", "secondaryText"])
        .map(|value| text_field(value, "content"))
        .unwrap_or_default();
    Some(Video {
        id,
        title,
        channel: String::new(),
        channel_id: String::new(),
        avatar: String::new(),
        views,
        published: String::new(),
        duration: String::new(),
        thumbnail,
        live: false,
        verified: false,
    })
}

fn parse_shorts(json: &Value) -> Vec<Video> {
    let mut shorts: Vec<Video> = Vec::new();

    for item in collect(json, "shortsLockupViewModel") {
        if let Some(video) = short_from_lockup(item) {
            shorts.push(video);
        }
    }

    for item in collect(json, "reelItemRenderer") {
        let Some(id) = item.get("videoId").and_then(Value::as_str) else {
            continue;
        };
        shorts.push(Video {
            id: id.to_string(),
            title: text_field(item, "headline"),
            channel: String::new(),
            channel_id: String::new(),
            avatar: String::new(),
            views: text_field(item, "viewCountText"),
            published: String::new(),
            duration: String::new(),
            thumbnail: dig(item, &["thumbnail", "thumbnails"])
                .map(best_source)
                .unwrap_or_default(),
            live: false,
            verified: false,
        });
    }

    shorts.dedup_by(|a, b| a.id == b.id);
    shorts
}

fn video_from(renderer: &Value) -> Option<Video> {
    let id = renderer.get("videoId").and_then(Value::as_str)?.to_string();
    let title = text_field(renderer, "title");
    if title.is_empty() {
        return None;
    }

    let avatar = dig(
        renderer,
        &[
            "channelThumbnailSupportedRenderers",
            "channelThumbnailWithLinkRenderer",
            "thumbnail",
            "thumbnails",
        ],
    )
    .or_else(|| {
        dig(
            renderer,
            &["owner", "videoOwnerRenderer", "thumbnail", "thumbnails"],
        )
    })
    .map(best_source)
    .unwrap_or_default();

    let live = renderer
        .get("badges")
        .map(|badges| badges.to_string().to_uppercase().contains("LIVE"))
        .unwrap_or(false)
        || dig(
            renderer,
            &[
                "thumbnailOverlays",
                "thumbnailOverlayTimeStatusRenderer",
                "style",
            ],
        )
        .and_then(Value::as_str)
        .map(|style| style == "LIVE")
        .unwrap_or(false);

    Some(Video {
        id,
        title,
        channel: pick(
            text_field(renderer, "longBylineText"),
            text_field(renderer, "shortBylineText"),
        ),
        channel_id: dig(
            renderer,
            &[
                "longBylineText",
                "runs",
                "0",
                "navigationEndpoint",
                "browseEndpoint",
                "browseId",
            ],
        )
        .or_else(|| {
            dig(
                renderer,
                &[
                    "shortBylineText",
                    "runs",
                    "0",
                    "navigationEndpoint",
                    "browseEndpoint",
                    "browseId",
                ],
            )
        })
        .or_else(|| {
            dig(
                renderer,
                &[
                    "channelThumbnailSupportedRenderers",
                    "channelThumbnailWithLinkRenderer",
                    "navigationEndpoint",
                    "browseEndpoint",
                    "browseId",
                ],
            )
        })
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string(),
        avatar,
        views: text_field(renderer, "viewCountText"),
        published: text_field(renderer, "publishedTimeText"),
        duration: pick(text_field(renderer, "lengthText"), {
            dig(
                renderer,
                &[
                    "thumbnailOverlays",
                    "thumbnailOverlayTimeStatusRenderer",
                    "text",
                ],
            )
            .map(|value| text_field(value, "simpleText"))
            .unwrap_or_default()
        }),
        thumbnail: dig(renderer, &["thumbnail", "thumbnails"])
            .map(best_source)
            .unwrap_or_default(),
        live,
        verified: has_badge(renderer, "VERIFIED"),
    })
}

fn parse_watch(video_id: &str, player: &Value, next: &Value) -> WatchPage {
    let details = player.get("videoDetails").cloned().unwrap_or(Value::Null);
    let primary = collect(next, "videoPrimaryInfoRenderer").into_iter().next();
    let secondary = collect(next, "videoSecondaryInfoRenderer")
        .into_iter()
        .next();

    let title = details
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            primary
                .map(|value| text_field(value, "title"))
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_default();

    let owner = secondary.and_then(|value| dig(value, &["owner", "videoOwnerRenderer"]));
    let avatar = owner
        .and_then(|value| dig(value, &["thumbnail", "thumbnails"]))
        .map(best_source)
        .unwrap_or_default();

    let published = primary
        .map(|value| text_field(value, "dateText"))
        .filter(|value| !value.is_empty())
        .or_else(|| {
            dig(
                &details,
                &["microformat", "playerMicroformatRenderer", "publishDate"],
            )
            .and_then(Value::as_str)
            .map(str::to_string)
        })
        .unwrap_or_default();

    let description = secondary
        .and_then(|value| dig(value, &["attributedDescription", "content"]))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| detail_snippet(player))
        .unwrap_or_default();

    let likes = find_by_attr(next, "accessibilityId", "id.video.like.button")
        .and_then(|button| button.get("title").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();

    let mut related = Vec::new();
    for item in collect(next, "compactVideoRenderer") {
        if let Some(video) = video_from(item) {
            related.push(video);
        }
    }
    for lockup in collect(next, "lockupViewModel") {
        if let Some(video) = video_from_lockup(lockup)
            && !related.iter().any(|existing| existing.id == video.id)
        {
            related.push(video);
        }
    }

    let comment_count = collect(next, "commentsEntryPointHeaderRenderer")
        .into_iter()
        .next()
        .map(|header| text_field(header, "commentCount"))
        .unwrap_or_default();

    let rating = collect(next, "likeStatusEntity")
        .into_iter()
        .find_map(|entity| entity.get("likeStatus").and_then(Value::as_str))
        .map(|status| match status {
            "LIKE" => "like",
            "DISLIKE" => "dislike",
            _ => "none",
        })
        .unwrap_or("none")
        .to_string();

    WatchPage {
        id: video_id.to_string(),
        title,
        channel: details
            .get("author")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_default(),
        channel_id: details
            .get("channelId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_default(),
        avatar,
        verified: owner
            .map(|value| has_badge(value, "VERIFIED"))
            .unwrap_or(false),
        subscribers: owner
            .map(|value| text_field(value, "subscriberCountText"))
            .unwrap_or_default(),
        views: primary
            .and_then(|value| dig(value, &["viewCount", "videoViewCountRenderer", "viewCount"]))
            .map(|value| text_field(value, "simpleText"))
            .unwrap_or_default(),
        published,
        likes,
        description,
        comment_count,
        comments: Vec::new(),
        comments_token: None,
        related,
        related_title: String::new(),
        rating,
    }
}

fn video_from_lockup(lockup: &Value) -> Option<Video> {
    let content_type = lockup
        .get("contentType")
        .and_then(Value::as_str)
        .unwrap_or("LOCKUP_CONTENT_TYPE_VIDEO");
    if content_type != "LOCKUP_CONTENT_TYPE_VIDEO" {
        return None;
    }
    let id = lockup.get("contentId").and_then(Value::as_str)?.to_string();
    if id.len() != 11 {
        return None;
    }

    let meta = dig(lockup, &["metadata", "lockupMetadataViewModel"]);
    let title = meta
        .and_then(|value| dig(value, &["title", "content"]))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if title.is_empty() {
        return None;
    }

    let rows = meta
        .and_then(|value| {
            dig(
                value,
                &["metadata", "contentMetadataViewModel", "metadataRows"],
            )
        })
        .unwrap_or(&Value::Null);

    let row0 = metadata_part(rows, 0, 0);
    // Channel shelves put the view count in the first row because there is no
    // channel name to show; feed cards put the channel there.
    let (channel, views, published) = if row0.contains("view") || row0.contains("ago") {
        (String::new(), row0, metadata_part(rows, 1, 0))
    } else {
        (row0, metadata_part(rows, 1, 0), metadata_part(rows, 1, 1))
    };

    let mut duration = String::new();
    let mut live = false;
    if let Some(overlays) =
        dig(lockup, &["contentImage", "thumbnailViewModel", "overlays"]).and_then(Value::as_array)
    {
        for overlay in overlays {
            for badge in collect(overlay, "thumbnailBadgeViewModel") {
                let text = badge
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if text.eq_ignore_ascii_case("live") {
                    live = true;
                } else if text.contains(':') {
                    duration = text.to_string();
                }
            }
        }
    }

    Some(Video {
        id,
        title,
        channel,
        channel_id: meta
            .and_then(|value| {
                dig(
                    value,
                    &[
                        "image",
                        "decoratedAvatarViewModel",
                        "rendererContext",
                        "commandContext",
                        "onTap",
                        "innertubeCommand",
                        "browseEndpoint",
                        "browseId",
                    ],
                )
            })
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        avatar: meta
            .and_then(|value| {
                dig(
                    value,
                    &[
                        "image",
                        "decoratedAvatarViewModel",
                        "avatar",
                        "avatarViewModel",
                        "image",
                        "sources",
                    ],
                )
            })
            .map(best_source)
            .unwrap_or_default(),
        views,
        published,
        duration,
        thumbnail: dig(
            lockup,
            &["contentImage", "thumbnailViewModel", "image", "sources"],
        )
        .map(best_source)
        .unwrap_or_default(),
        live,
        verified: false,
    })
}

fn metadata_part(rows: &Value, row: usize, column: usize) -> String {
    rows.get(row)
        .and_then(|value| value.get("metadataParts"))
        .and_then(|parts| parts.get(column))
        .and_then(|part| dig(part, &["text", "content"]))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn find_by_attr<'a>(root: &'a Value, key: &str, value: &str) -> Option<&'a Value> {
    match root {
        Value::Object(map) => {
            if map.get(key).and_then(Value::as_str) == Some(value) {
                return Some(root);
            }
            map.values()
                .find_map(|child| find_by_attr(child, key, value))
        }
        Value::Array(items) => items.iter().find_map(|item| find_by_attr(item, key, value)),
        _ => None,
    }
}

fn pick(primary: String, fallback: String) -> String {
    if primary.is_empty() {
        fallback
    } else {
        primary
    }
}

fn has_badge(renderer: &Value, style: &str) -> bool {
    renderer
        .get("ownerBadges")
        .or_else(|| renderer.get("badges"))
        .map(|badges| badges.to_string().contains(style))
        .unwrap_or(false)
}

fn detail_snippet(player: &Value) -> Option<String> {
    player
        .get("videoDetails")
        .and_then(|details| details.get("shortDescription"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn comment_token(next: &Value) -> Option<String> {
    for section in collect(next, "itemSectionRenderer") {
        if section.get("sectionIdentifier").and_then(Value::as_str) != Some("comment-item-section")
        {
            continue;
        }
        let token = dig(
            section,
            &[
                "contents",
                "0",
                "continuationItemRenderer",
                "continuationEndpoint",
                "continuationCommand",
                "token",
            ],
        )
        .and_then(Value::as_str);
        if let Some(token) = token {
            return Some(token.to_string());
        }
    }
    None
}

fn comment_from_payload(payload: &Value) -> Comment {
    Comment {
        id: dig(payload, &["properties", "commentId"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        author: dig(payload, &["author", "displayName"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        avatar: dig(payload, &["author", "avatarThumbnailUrl"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        channel_id: dig(payload, &["author", "channelId"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        published: dig(payload, &["properties", "publishedTime"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        text: dig(payload, &["properties", "content", "content"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        likes: dig(payload, &["toolbar", "likeCountNotliked"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        replies: dig(payload, &["toolbar", "replyCount"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        replies_token: None,
        pinned: dig(payload, &["properties", "pinnedText"])
            .and_then(Value::as_str)
            .map(|text| !text.is_empty())
            .unwrap_or(false),
        owner: dig(payload, &["author", "isCreator"])
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn comment_from(renderer: &Value) -> Comment {
    let author = text_field(renderer, "authorText");
    Comment {
        id: renderer
            .get("commentId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        avatar: dig(renderer, &["authorThumbnail", "thumbnails"])
            .map(best_source)
            .unwrap_or_default(),
        channel_id: dig(renderer, &["authorEndpoint", "browseEndpoint", "browseId"])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        author,
        published: text_field(renderer, "publishedTimeText"),
        text: text_field(renderer, "contentText"),
        likes: text_field(renderer, "voteCount"),
        replies: renderer
            .get("replyCount")
            .and_then(Value::as_u64)
            .map(|count| count.to_string())
            .unwrap_or_default(),
        replies_token: None,
        pinned: renderer
            .get("pinnedText")
            .map(|value| !text_field(value, "").is_empty())
            .unwrap_or(false),
        owner: renderer
            .get("authorIsChannelOwner")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

/// Text of a node that is either `{simpleText}` or `{runs:[...]}`. Accepts a
/// pre-resolved node too, so callers do not have to branch.
fn text_field(node: &Value, key: &str) -> String {
    let target = if key.is_empty() {
        node
    } else {
        node.get(key).unwrap_or(&Value::Null)
    };
    if let Some(value) = target.get("simpleText").and_then(Value::as_str) {
        return value.to_string();
    }
    if let Some(value) = target.as_str() {
        return value.to_string();
    }
    if let Some(content) = target.get("content").and_then(Value::as_str) {
        return content.to_string();
    }
    if let Some(runs) = target.get("runs").and_then(Value::as_array) {
        return runs
            .iter()
            .filter_map(|run| run.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("");
    }
    if let Some(text) = target.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    String::new()
}

fn dig<'a>(node: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = node;
    for key in path {
        current = match key.parse::<usize>() {
            Ok(index) => current.get(index)?,
            Err(_) => current.get(*key)?,
        };
    }
    Some(current)
}

fn best_source(thumbnails: &Value) -> String {
    thumbnails
        .as_array()
        .and_then(|list| {
            list.iter()
                .filter_map(|item| item.get("url").and_then(Value::as_str))
                .next_back()
        })
        .unwrap_or_default()
        .to_string()
}

fn collect<'a>(root: &'a Value, key: &str) -> Vec<&'a Value> {
    let mut out = Vec::new();
    walk(root, key, &mut out);
    out
}

fn walk<'a>(node: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match node {
        Value::Object(map) => {
            for (name, value) in map {
                if name == key {
                    out.push(value);
                }
                walk(value, key, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                walk(item, key, out);
            }
        }
        _ => {}
    }
}
