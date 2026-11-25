# WinTube

An unofficial YouTube desktop client for Windows, built with Rust and Tauri 2 on
WebView2. The interface is a hand-built copy of YouTube's desktop layout and
talks to YouTube's own web API (InnerTube), so feeds, search results, channels,
comments, subscriptions and playlists are real.

WinTube is not Electron. It uses the WebView2 runtime that ships with Windows, so
the installer is a few megabytes instead of a bundled Chromium.

## Features

- Sign in with a normal Google account. The session lives in the WebView2 profile
  and survives restarts.
- Home feed with custom-feed chips, the Shorts shelf and infinite paging.
- Search with YouTube's filter chips and paging.
- Watch pages with a from-scratch player: separate video and audio tracks kept in
  sync, the normal progress bar and controls, volume, speed (0.25x to 2x),
  quality up to 4K, captions, theater mode and fullscreen.
- Playback resumes where you stopped the last time. Positions are stored locally
  per video and saved on pause, seek, page change and window close.
- Theater mode widens the player to the whole window, keeps the title, channel
  row and action buttons visible below it, and moves the related videos into a
  column underneath.
- English audio is preferred over YouTube's automatic dubs. Videos with no
  English track fall back to their original language.
- Shorts player with vertical video, the action rail, previous and next, scroll
  and arrow-key navigation, and a comments drawer that slides in.
- Channel pages with banner, tabs (Home, Videos, Shorts, Live, Playlists, Posts),
  featured video and a portrait Shorts grid.
- Comments with paging, expandable reply threads and an inline reply composer.
- Save a video to any of your playlists from the Save button or a video's more
  menu. Tick a playlist to add the video, untick it to remove the video.
- Downloads through `yt-dlp` into `Downloads\WinTube`: video up to 1080p as mp4,
  or audio only as m4a, with progress in the corner.
- Notifications, subscriptions, Watch later, account menu and settings.
- Keyboard shortcuts on the watch page: `space`/`k` play or pause, `j`/`l` skip
  10 seconds, arrows seek and change volume, `m` mute, `f` fullscreen, `t`
  theater, `c` captions, `0`-`9` jump through the video, `,`/`.` change speed.

## Install

1. Download the latest `WinTube_0.2.0_x64-setup.exe` from the
   [Releases](../../releases) page.
2. Run it. The installer needs administrator rights.
3. The build is not code signed, so Windows SmartScreen may show a warning.
   Choose **More info** and then **Run anyway**.
4. Install `yt-dlp` and `ffmpeg`, and make sure both are on `PATH`.

Windows 10 or 11 is required. WebView2 is already present on Windows 11 and most
Windows 10 installs; the installer offers to download it when it is missing.

### yt-dlp and ffmpeg

Playback and downloads use `yt-dlp`. Without it, WinTube can still play YouTube's
360p muxed stream, but there is no HD and no download. `ffmpeg` is needed to merge
video with audio and to extract m4a audio.

Install either from a terminal:

```
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

or download `yt-dlp.exe` and `ffmpeg.exe`, put them in a folder and add that
folder to `PATH`. Close and reopen WinTube after changing `PATH`.

## Use

- **Sign in:** click the avatar button in the top right. Google may refuse a
  sign-in from an embedded browser; if it does, WinTube keeps working signed out.
- **Watch:** open any video. Click the picture to pause. The gear menu holds
  speed, quality and captions. Use the theater button or `t` to widen the player,
  and the fullscreen button or `f` for fullscreen.
- **Resume:** reopen a video you did not finish. It starts a few seconds before
  the point where you stopped. Watching to the end, or rewinding to the start,
  clears the stored point.
- **Save:** click Save under the video or choose Save to playlist from the more
  menu. Every playlist appears with a checkbox. Ticking adds the video, unticking
  removes it.
- **Download:** the download button and the more menu offer video (up to 1080p,
  mp4) and audio (m4a). Progress appears in the bottom left corner.

## How it works

The UI is plain HTML, CSS and JavaScript in `ui/`, rendered by WebView2. The
Rust side in `src-tauri/` is the API client and local media server:

- Requests go to `https://www.youtube.com/youtubei/v1/*` with the WEB client
  context and the cookies from the WebView2 session. Signed-in requests add a
  `SAPISIDHASH` authorization header. The renderer trees YouTube returns are
  normalized into small structs for the UI.
- YouTube's web API only hands out a 360p muxed stream URL to this client, so
  `yt-dlp` resolves the adaptive video and audio streams. WinTube's player plays
  them as two synchronized `<video>` and `<audio>` elements inside its own
  controls, with no iframe and no YouTube player chrome.
- Google's CDN throttles the open-ended `Range: bytes=0-` request that Chromium
  sends for media. A small local HTTP proxy in `src-tauri/src/media.rs` rewrites
  each request into a bounded range, which downloads at full speed, and relays
  the bytes to the player.
- Playback positions, volume, speed, quality and caption preference are stored
  locally. There is no account server and no telemetry.
- Downloads shell out to `yt-dlp` and report progress through Tauri events.

## Build from source

Prerequisites:

- Rust (stable) with the MSVC toolchain
- Visual Studio Build Tools with the C++ workload
- WebView2 runtime
- Node.js only if you use the npm Tauri CLI

```
rustup target add x86_64-pc-windows-msvc
cargo install tauri-cli --version "^2" --locked

git clone https://github.com/StatisticalHorse/WinTube.git
cd WinTube
cargo tauri build
```

The NSIS installer ends up in `src-tauri/target/release/bundle/nsis/`. A plain
release executable is in `src-tauri/target/release/wintube.exe`, but it needs
the Tauri resource files next to it, so use the installer for normal use.

For development:

```
cargo run --manifest-path src-tauri/Cargo.toml
```

The debug build prints a console. `--open=#/watch?v=VIDEOID` starts on a watch
page. `--probe home`, `--probe "search:rust"` and `--probe watch:<id>` print the
parsed API payload as JSON without opening a window.

## Limitations

- WinTube is unofficial and not affiliated with YouTube. YouTube changes its
  internal API regularly, so parts can break until they are updated.
- Likes and dislikes are optimistic only. YouTube requires a BotGuard
  attestation token for ratings, so the server keeps the previous state even
  though the button changes. Subscribing, Watch later and playlist edits do
  persist.
- Comment posting and replies use YouTube's authenticated endpoints. If YouTube
  refuses a post, the app shows the error instead of pretending it worked.
- No uploading, no Create button, no live chat and no casting.
- The session only exists inside WinTube. Clearing the app's browsing data or
  signing out removes it.
- Quality options come from `yt-dlp`. The fallback stream is 360p.
- Stream URLs expire after a few hours. Reload the page if a stale video stops.

## Privacy

WinTube has no servers, analytics or crash reporting. The only network traffic is
to YouTube (API, thumbnails and media), to `yt-dlp` for stream resolution and
downloads, and to Google during sign-in. Sign-in cookies stay in the WebView2
profile on your machine. Playback positions are stored locally in
`%APPDATA%\com.wintube.app\playback.json`.

## License

MIT. See [LICENSE](LICENSE).
