/* WinTube renderer. Plain ES2022, no build step: Tauri serves this folder as
   the app and the Rust side exposes YouTube's API as commands. */

const content = document.getElementById("content");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const guide = document.getElementById("guide");

const DEFAULT_CHIPS = [
  "All",
  "Music",
  "Gaming",
  "News",
  "Sports",
  "Learning",
  "Podcasts",
  "Live",
  "Mixes",
  "Computer hardware",
  "AI",
];

const EXTRA_CHIP = { label: "Custom feed", icon: "plus", selected: false };

const DEST_FALLBACK = {
  Home: "#/",
  Shorts: "#/shorts",
  Subscriptions: "#/feed?browseId=FEsubscriptions&title=Subscriptions",
  History: "#/feed?browseId=FEhistory&title=History",
  Playlists: "#/feed?browseId=FEplaylists&title=Playlists",
  "Watch later": "#/feed?browseId=VLWL&title=Watch%20later",
  "Liked videos": "#/feed?browseId=VLLL&title=Liked%20videos",
  Settings: "#/settings",
};

function bridge() {
  return window.__TAURI__?.core?.invoke ?? window.__WINTUBE_PREVIEW__ ?? null;
}

function invoke(command, args) {
  const fn = bridge();
  if (!fn) return Promise.reject(new Error("no IPC bridge"));
  return fn(command, args);
}

const openExternal = (url) => invoke("open_external", { url }).catch(() => {});

const icon = (name, className = "icon") =>
  `<svg class="${className}"><use href="#i-${name}"></use></svg>`;

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const initial = (value) => {
  const text = String(value ?? "").replace(/^@/, "").trim();
  return text ? esc(text[0].toUpperCase()) : "";
};

const encode = encodeURIComponent;

/* ------------------------------------------------------------------- state */

const state = {
  signedIn: false,
  account: null,
  subscriptions: [],
  guideEntries: [],
  subscribed: new Set(),
  notifications: [],
  unread: 0,
  page: 0,
  player: null,
  watchTrail: [],
  shortsQueue: [],
  shortsIndex: 0,
  shortsQueueAt: 0,
  subsExpanded: false,
  feed: null,
  panel: null,
  menu: null,
  playlistChoices: new Map(),
  settings: {
    autoplay: localStorage.getItem("wintube-autoplay") !== "0",
  },
};

/* ------------------------------------------------------------------ guide */

const GUIDE_MAIN = [
  { icon: "home", label: "Home", route: "#/" },
  { icon: "shorts", label: "Shorts" },
  { icon: "subs", label: "Subscriptions" },
];

const GUIDE_YOU = [
  { icon: "person", label: "Your channel" },
  { icon: "history", label: "History" },
  { icon: "playlist", label: "Playlists" },
  { icon: "watch-later", label: "Watch later" },
  { icon: "liked", label: "Liked videos" },
];

const GUIDE_EXPLORE = [
  { icon: "music", label: "Music" },
  { icon: "movies", label: "Movies & TV" },
  { icon: "live", label: "Live" },
  { icon: "explore", label: "Trending" },
];

const GUIDE_MORE = [
  { icon: "live", label: "YouTube Premium" },
  { icon: "music", label: "YouTube Music" },
  { icon: "shorts", label: "YouTube Kids" },
];

function destination(label) {
  if (label === "Your channel") {
    return state.account?.channelId ? `#/channel/${encode(state.account.channelId)}` : null;
  }
  const entry = state.guideEntries.find((item) => item.title === label);
  if (entry?.browseId) {
    const params = entry.params ? `&params=${encode(entry.params)}` : "";
    return `#/feed?browseId=${encode(entry.browseId)}${params}&title=${encode(label)}`;
  }
  return DEST_FALLBACK[label] || null;
}

function guideItem(item, active) {
  const target = item.route || destination(item.label);
  const accent = item.icon === "shorts" ? " accent" : "";
  if (!target) {
    return `<button class="guide-item${accent}" type="button" data-unavailable="${esc(item.label)}">
      ${icon(item.icon)}<span>${esc(item.label)}</span>
    </button>`;
  }
  return `<a class="guide-item${active ? " active" : ""}${accent}" href="${target}">
    ${icon(item.icon)}<span>${esc(item.label)}</span>
  </a>`;
}

function renderGuide() {
  const route = location.hash.slice(1) || "/";
  const homeActive = route === "/" || route.startsWith("/results");
  const shortsActive = route.startsWith("/shorts");
  const visible = state.subsExpanded ? state.subscriptions : state.subscriptions.slice(0, 7);
  const subsBlock =
    state.signedIn && state.subscriptions.length
      ? `${visible
          .map(
            (channel) => `<a class="guide-channel" href="#/channel/${encode(channel.id)}">
              ${
                channel.avatar
                  ? `<img src="${esc(channel.avatar)}" alt="" loading="lazy" />`
                  : `<span class="avatar-fallback">${initial(channel.name)}</span>`
              }
              <span>${esc(channel.name)}</span>
            </a>`,
          )
          .join("")}
        ${
          state.subscriptions.length > 7
            ? `<button class="guide-more" type="button" data-subs-toggle>
                ${icon("chevron-down")}<span>${state.subsExpanded ? "Show fewer" : "Show more"}</span>
              </button>`
            : ""
        }`
      : "";
  const signInBlock = state.signedIn
    ? ""
    : `<div class="guide-signin">
        <p>Sign in to like videos, comment, and subscribe.</p>
        <button class="signin-pill" type="button" data-signin>Sign in</button>
      </div>`;

  guide.innerHTML = `
    <nav class="guide-section">
      ${GUIDE_MAIN.map((item, index) =>
        guideItem(item, index === 0 ? homeActive : index === 1 ? shortsActive : false),
      ).join("")}
      ${subsBlock}
    </nav>
    ${signInBlock}
    <nav class="guide-section">
      <div class="guide-title">You ${icon("chevron-right")}</div>
      ${GUIDE_YOU.map((item) => guideItem(item, false)).join("")}
    </nav>
    <nav class="guide-section">
      <div class="guide-title">Explore</div>
      ${GUIDE_EXPLORE.map((item) => guideItem(item, false)).join("")}
    </nav>
    <nav class="guide-section">
      <div class="guide-title">More from YouTube</div>
      ${GUIDE_MORE.map((item) => guideItem(item, false)).join("")}
    </nav>
    <nav class="guide-section">
      ${guideItem({ icon: "settings", label: "Settings" }, false)}
      ${guideItem({ icon: "help", label: "Help" }, false)}
      ${guideItem({ icon: "feedback", label: "Send feedback" }, false)}
    </nav>
    <div class="guide-footer">
      <div>About Press Copyright<br />Contact us Creators<br />Advertise Developers</div>
      <div class="guide-legal">Terms Privacy Policy &amp; Safety<br />How YouTube works<br />Test new features<br /><br />© 2026 Google LLC</div>
    </div>`;
}

/* --------------------------------------------------------------- components */

function avatar(src, name, size = 36) {
  if (!src) return `<span class="avatar-${size}">${initial(name)}</span>`;
  return `<span class="avatar-${size}"><img src="${esc(src)}" alt="" loading="lazy" /></span>`;
}

function channelLink(channel, channelId, extra = "") {
  if (!channelId) return `<span class="card-channel">${esc(channel)}${extra}</span>`;
  return `<a class="card-channel" href="#/channel/${encode(channelId)}">${esc(channel)}${extra}</a>`;
}

function videoCard(video) {
  const badge = video.live
    ? `<span class="live-badge">LIVE</span>`
    : video.duration
      ? `<span class="duration">${esc(video.duration)}</span>`
      : "";
  const meta = [video.views, video.published].filter(Boolean).join(" · ");
  return `<article class="card" data-video="${esc(video.id)}">
    <div class="thumb">
      ${video.thumbnail ? `<img src="${esc(video.thumbnail)}" alt="" loading="lazy" />` : ""}
      ${badge}
    </div>
    <div class="card-meta">
      ${avatar(video.avatar, video.channel, 36)}
      <div class="card-text">
        <h3 class="card-title">${esc(video.title)}</h3>
        ${channelLink(video.channel, video.channelId, video.verified ? icon("check") : "")}
        <div class="card-views">${esc(meta)}</div>
      </div>
      <button class="card-menu" type="button" data-menu-video="${esc(video.id)}" aria-label="Action menu">${icon("more")}</button>
    </div>
  </article>`;
}

function shortCard(video) {
  return `<article class="short" data-short-video="${esc(video.id)}" data-video="${esc(video.id)}">
    <div class="thumb">
      ${video.thumbnail ? `<img src="${esc(video.thumbnail)}" alt="" loading="lazy" />` : ""}
    </div>
    <div class="short-title"><span>${esc(video.title || "")}</span></div>
    <div class="short-views">${esc(video.views || "")}</div>
  </article>`;
}

function playlistCard(playlist) {
  return `<article class="playlist-card" data-playlist="${esc(playlist.id)}">
    <div class="playlist-thumb">
      ${playlist.thumbnail ? `<img src="${esc(playlist.thumbnail)}" alt="" loading="lazy" />` : ""}
      ${playlist.count ? `<span class="playlist-count">${esc(playlist.count)}</span>` : ""}
    </div>
    <div class="playlist-title">${esc(playlist.title)}</div>
    <div class="card-views">${esc(playlist.channel || "")}</div>
  </article>`;
}

function postCard(post) {
  return `<article class="post">
    <div class="post-head">
      ${avatar(post.avatar, post.author, 40)}
      <div>
        <div class="owner-name">${esc(post.author)}</div>
        <div class="comment-when">${esc(post.published)}</div>
      </div>
    </div>
    <div class="post-body">${esc(post.text)}</div>
    ${post.image ? `<img class="post-image" src="${esc(post.image)}" alt="" loading="lazy" />` : ""}
    <div class="post-meta">${post.likes ? `<span>${esc(post.likes)} likes</span>` : ""}</div>
  </article>`;
}

function chipRow(chips, { home = false } = {}) {
  const list = home ? [EXTRA_CHIP, ...chips] : chips;
  return `<div class="chips">${list
    .map(
      (chip) =>
        `<button class="chip${chip.selected ? " active" : ""}" type="button" data-chip="${esc(
          chip.label,
        )}" data-params="${esc(chip.params || "")}">${chip.icon ? icon(chip.icon) : ""}${esc(
          chip.label,
        )}</button>`,
    )
    .join("")}</div>`;
}

function sectionBlock(section) {
  if (section.kind === "featured" && section.featured) {
    const video = section.featured.video;
    return `<div class="featured" data-video="${esc(video.id)}">
      <div class="featured-thumb">
        ${video.thumbnail ? `<img src="${esc(video.thumbnail)}" alt="" loading="lazy" />` : ""}
        <span class="play-badge">${icon("play")}</span>
      </div>
      <div class="featured-body">
        <h3>${esc(video.title)}</h3>
        <p>${esc(section.featured.description)}</p>
      </div>
    </div>`;
  }
  if (section.kind === "shorts") {
    if (section.style === "grid") {
      return `<section class="shelf">
        ${section.title ? `<div class="shelf-head">${icon("shorts")}<h2>${esc(section.title)}</h2></div>` : ""}
        <div class="shorts-grid">${section.items.map(shortCard).join("")}</div>
      </section>`;
    }
    return `<section class="shelf">
      <div class="shelf-head">${icon("shorts")}<h2>${esc(section.title || "Shorts")}</h2></div>
      <div class="shorts-row">${section.items.slice(0, 5).map(shortCard).join("")}</div>
    </section>`;
  }
  if (section.kind === "playlists") {
    return `<section class="shelf">
      ${section.title ? `<div class="shelf-head"><h2>${esc(section.title)}</h2></div>` : ""}
      <div class="grid">${section.playlists.map(playlistCard).join("")}</div>
    </section>`;
  }
  if (section.kind === "posts") {
    return `<section class="shelf">
      ${section.title ? `<div class="shelf-head"><h2>${esc(section.title)}</h2></div>` : ""}
      <div style="padding-top:8px">${section.posts.map(postCard).join("")}</div>
    </section>`;
  }
  if (!section.items.length) return "";
  return `<section class="shelf">
    ${section.title ? `<div class="shelf-head"><h2>${esc(section.title)}</h2></div>` : ""}
    <div class="grid">${section.items.map(videoCard).join("")}</div>
  </section>`;
}

function sectionsBlock(sections) {
  return sections.map(sectionBlock).join("");
}

function skeletonGrid(count = 6) {
  const card = `<div class="skeleton-card">
      <div class="skeleton thumb"></div>
      <div style="display:flex;gap:12px">
        <div class="skeleton" style="width:36px;height:36px;border-radius:50%"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;padding-top:4px">
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      </div>
    </div>`;
  return `<div class="grid">${Array.from({ length: count }, () => card).join("")}</div>`;
}

function emptyState(title, text) {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
}

function moreSentinel(label = "Loading") {
  return `<div class="feed-more"><button type="button" data-load-more>${esc(label)}</button></div>`;
}

/* ------------------------------------------------------------------ actions */

let toastTimer = null;
function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.add("hidden"), 3200);
}

function closePanel() {
  state.panel?.remove();
  state.panel = null;
}

function closeMenu() {
  state.menu?.remove();
  state.menu = null;
  if (state.menuClose) {
    document.getElementById("content")?.removeEventListener("scroll", state.menuClose);
    window.removeEventListener("resize", state.menuClose);
    state.menuClose = null;
  }
}

async function refreshAuth() {
  try {
    state.signedIn = await invoke("yt_auth_status");
    state.account = state.signedIn ? await invoke("yt_account") : null;
    const guideData = state.signedIn ? await invoke("yt_guide") : { entries: [], channels: [] };
    state.subscriptions = guideData.channels || [];
    state.guideEntries = guideData.entries || [];
    state.subscribed = new Set(state.subscriptions.map((channel) => channel.id));
  } catch {
    state.signedIn = false;
    state.account = null;
    state.subscriptions = [];
    state.guideEntries = [];
  }
  applyAccount();
}

function applyAccount() {
  const accountButton = document.getElementById("account-button");
  const signInButton = document.getElementById("signin-button");
  if (!accountButton || !signInButton) return;
  accountButton.hidden = !state.signedIn;
  signInButton.hidden = state.signedIn;
  if (!state.signedIn) {
    refreshNotifications();
    return;
  }
  const avatarImg = document.getElementById("account-avatar");
  const letter = document.getElementById("account-letter");
  if (avatarImg && letter) {
    if (state.account?.avatar) {
      avatarImg.src = state.account.avatar;
      avatarImg.hidden = false;
      letter.hidden = true;
    } else {
      letter.textContent = (state.account?.name || "W").slice(0, 1).toUpperCase();
      letter.hidden = false;
    }
  }
  refreshNotifications();
}

async function refreshNotifications() {
  if (!state.signedIn) {
    state.notifications = [];
    state.unread = 0;
    updateBell();
    return;
  }
  try {
    state.notifications = await invoke("yt_notifications");
    state.unread = state.notifications.filter((item) => !item.read).length;
  } catch {
    state.notifications = [];
    state.unread = 0;
  }
  updateBell();
}

function updateBell() {
  const bell = document.getElementById("bell-button");
  if (!bell) return;
  let dot = bell.querySelector(".badge-dot");
  if (state.unread > 0 && !dot) {
    bell.insertAdjacentHTML("beforeend", `<span class="badge-dot"></span>`);
  } else if (state.unread === 0 && dot) {
    dot.remove();
  }
}

async function toggleNotifications() {
  if (state.panel?.dataset.panel === "notifications") {
    closePanel();
    return;
  }
  closePanel();
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.dataset.panel = "notifications";
  panel.innerHTML = `<div class="panel-head"><span>Notifications</span><button type="button" data-read-all>Mark all read</button></div>
    <div class="panel-list">${
      state.notifications.length
        ? state.notifications
            .map(
              (item) => `<div class="notif${item.read ? "" : " unread"}" data-notif="${esc(item.id)}"
                data-video="${esc(item.videoId)}" data-channel-id="${esc(item.channelId)}">
                ${
                  item.thumbnail
                    ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy" />`
                    : `<span class="avatar-40">${initial(item.text)}</span>`
                }
                <div class="notif-body">
                  <div class="notif-text">${esc(item.text)}</div>
                  <div class="notif-when">${esc(item.when)}</div>
                </div>
              </div>`,
            )
            .join("")
        : `<div class="notif-empty">${state.signedIn ? "No notifications yet." : "Sign in to see notifications."}</div>`
    }</div>`;
  document.body.append(panel);
  state.panel = panel;
}

function markNotificationsRead() {
  state.notifications = state.notifications.map((item) => ({ ...item, read: true }));
  state.unread = 0;
  updateBell();
  closePanel();
  toggleNotifications();
}

function accountMenu(anchor) {
  if (state.menu) {
    closeMenu();
    return;
  }
  const menu = document.createElement("div");
  menu.className = "menu";
  const channel = state.account?.channelId
    ? `<a href="#/channel/${encode(state.account.channelId)}">${icon("person")}Your channel</a>`
    : "";
  menu.innerHTML = `
    <div class="menu-label">${esc(state.account?.name || "Signed in")}</div>
    ${channel}
    <button type="button" data-external="https://studio.youtube.com">${icon("live")}YouTube Studio</button>
    <button type="button" data-switch-account>${icon("person")}Switch account</button>
    <a href="#/settings">${icon("settings")}Settings</a>
    <button type="button" data-sign-out>${icon("explore")}Sign out</button>
    <button type="button" data-external="https://www.youtube.com/t/feedback">${icon("feedback")}Send feedback</button>`;
  placeMenu(menu, anchor);
}

function videoMenu(anchor, videoId) {
  if (state.menu) {
    closeMenu();
    return;
  }
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.innerHTML = `
    <button type="button" data-save="${esc(videoId)}">${icon("watch-later")}Save to playlist</button>
    <button type="button" data-download-video="${esc(videoId)}">${icon("download")}Download video (up to 1080p)</button>
    <button type="button" data-download-audio="${esc(videoId)}">${icon("music")}Download audio (m4a)</button>
    <button type="button" data-copy="${esc(videoId)}">${icon("share")}Copy link</button>
    <button type="button" data-external="https://www.youtube.com/watch?v=${esc(videoId)}">${icon("explore")}Open in browser</button>`;
  placeMenu(menu, anchor);
}

function downloadMenu(anchor, videoId) {
  if (state.menu) {
    closeMenu();
    return;
  }
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.innerHTML = `
    <button type="button" data-download-video="${esc(videoId)}">${icon("download")}Video (up to 1080p, mp4)</button>
    <button type="button" data-download-audio="${esc(videoId)}">${icon("music")}Audio only (m4a)</button>`;
  placeMenu(menu, anchor);
}

let downloadHideTimer = null;

function showDownload(text, percent = 0) {
  const box = document.getElementById("download-status");
  if (!box) return;
  window.clearTimeout(downloadHideTimer);
  box.hidden = false;
  const label = box.querySelector(".download-status-text");
  const fill = box.querySelector(".download-bar-fill");
  if (label) label.textContent = text;
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hideDownload() {
  const box = document.getElementById("download-status");
  if (box) box.hidden = true;
}

function startDownload(videoId, audioOnly) {
  closeMenu();
  showDownload(audioOnly ? "Downloading audio..." : "Downloading video...", 0);
  void invoke("yt_download", { id: videoId, audioOnly })
    .then((folder) => {
      showDownload(`Saved to ${folder}`, 100);
      downloadHideTimer = window.setTimeout(hideDownload, 5000);
      toast("Download finished");
    })
    .catch((error) => {
      showDownload(`Download failed: ${error}`, 0);
      downloadHideTimer = window.setTimeout(hideDownload, 7000);
      toast(`Download failed: ${error}`);
    });
}

function initDownloads() {
  const events = window.__TAURI__?.event;
  if (!events?.listen) return;
  void events.listen("download-progress", (event) => {
    const payload = event.payload || {};
    const percent = Number(payload.percent) || 0;
    showDownload(`Downloading... ${percent.toFixed(1)}%`, percent);
  });
  void events.listen("download-done", (event) => {
    const payload = event.payload || {};
    showDownload(`Saved to ${payload.dir || "Downloads\\WinTube"}`, 100);
    downloadHideTimer = window.setTimeout(hideDownload, 4000);
  });
}

function placeMenu(menu, anchor) {
  const rect =
    anchor instanceof Element
      ? anchor.getBoundingClientRect()
      : anchor && typeof anchor.top === "number"
        ? anchor
        : { top: 0, bottom: 0, right: 0, left: 0 };
  closeMenu();
  document.body.append(menu);
  positionMenu(menu, rect);
  state.menu = menu;
  state.menuClose = () => closeMenu();
  document.getElementById("content")?.addEventListener("scroll", state.menuClose, {
    passive: true,
  });
  window.addEventListener("resize", state.menuClose);
}

/// Places a menu next to its anchor and keeps it inside the window. When it
/// would run off the bottom it flips above the anchor; when it is taller than
/// the window it scrolls inside itself.
function positionMenu(menu, rect) {
  const margin = 8;
  menu.style.maxHeight = `${Math.max(160, window.innerHeight - margin * 2)}px`;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(
    margin,
    Math.min(window.innerWidth - width - margin, rect.right - width),
  );
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - margin) {
    const above = rect.top - height - 8;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function playlistRows(playlists, videoId) {
  if (!playlists.length) {
    return `<div class="menu-note">No playlists yet. Create one on YouTube to save videos here.</div>`;
  }
  return playlists
    .map((playlist) => {
      const key = `${videoId}:${playlist.id}`;
      const selected = state.playlistChoices.has(key)
        ? state.playlistChoices.get(key)
        : playlist.selected;
      return `<button class="playlist-row${selected ? " selected" : ""}" type="button"
        data-playlist-toggle="${esc(playlist.id)}" data-selected="${selected}">
        <span class="playlist-check">${selected ? icon("check") : ""}</span>
        <span class="playlist-title">${esc(playlist.title)}</span>
        <span class="playlist-privacy">${esc(playlist.privacy)}</span>
      </button>`;
    })
    .join("");
}

function saveMenu(anchor, videoId) {
  const rect =
    anchor instanceof Element
      ? anchor.getBoundingClientRect()
      : anchor && typeof anchor.top === "number"
        ? anchor
        : { top: 0, bottom: 0, right: 0, left: 0 };
  const menu = document.createElement("div");
  menu.className = "menu save-menu";
  menu.dataset.videoId = videoId;
  menu.innerHTML = `<div class="menu-label">Save to playlist</div>
    <div class="menu-note">Loading playlists...</div>`;
  placeMenu(menu, rect);

  if (!state.signedIn) {
    menu.innerHTML = `<div class="menu-label">Save to playlist</div>
      <div class="menu-note">Sign in to save videos to your playlists.</div>`;
    positionMenu(menu, rect);
    return;
  }

  void invoke("yt_playlists", { id: videoId })
    .then((playlists) => {
      if (!menu.isConnected) return;
      menu.innerHTML = `<div class="menu-label">Save to playlist</div>${playlistRows(playlists, videoId)}`;
      positionMenu(menu, rect);
    })
    .catch((error) => {
      if (!menu.isConnected) return;
      menu.innerHTML = `<div class="menu-label">Save to playlist</div>
        <div class="menu-note">Could not load playlists: ${esc(error)}</div>`;
      positionMenu(menu, rect);
    });
}

async function togglePlaylist(button) {
  if (button.dataset.busy === "1") return;
  const menu = button.closest(".menu");
  const videoId = menu?.dataset.videoId;
  const playlistId = button.getAttribute("data-playlist-toggle");
  if (!videoId || !playlistId) return;
  const add = button.dataset.selected !== "true";
  const title = button.querySelector(".playlist-title")?.textContent || "playlist";
  button.dataset.busy = "1";
  button.classList.add("busy");
  try {
    await invoke("yt_playlist_edit", { playlistId, videoId, add });
    state.playlistChoices.set(`${videoId}:${playlistId}`, add);
    button.dataset.selected = String(add);
    button.classList.toggle("selected", add);
    const check = button.querySelector(".playlist-check");
    if (check) check.innerHTML = add ? icon("check") : "";
    toast(add ? `Saved to ${title}` : `Removed from ${title}`);
  } catch (error) {
    toast(`Could not update ${title}: ${error}`);
  } finally {
    button.dataset.busy = "0";
    button.classList.remove("busy");
  }
}

async function toggleSubscribe(channelId, subscribed) {
  try {
    await invoke("yt_subscribe", { id: channelId, subscribed });
  } catch (error) {
    toast(`Subscribe failed: ${error}`);
    return;
  }
  if (subscribed) state.subscribed.add(channelId);
  else state.subscribed.delete(channelId);
  syncSubscribeButtons();
  void refreshGuide();
}

function syncSubscribeButtons() {
  document.querySelectorAll("[data-subscribe]").forEach((button) => {
    const channelId = button.getAttribute("data-subscribe");
    const subscribed = state.subscribed.has(channelId);
    button.textContent = subscribed ? "Subscribed" : "Subscribe";
    button.classList.toggle("light", !subscribed);
    button.classList.toggle("tonal", subscribed);
  });
}

async function refreshGuide() {
  try {
    const guideData = await invoke("yt_guide");
    state.subscriptions = guideData.channels || [];
    state.guideEntries = guideData.entries || [];
    renderGuide();
  } catch {
    /* ignore */
  }
}

async function toggleLike(videoId, rating) {
  try {
    await invoke("yt_rate", { id: videoId, rating });
  } catch {
    /* YouTube may ignore ratings from this client */
  }
}

/* ------------------------------------------------------------------- player */

/// Keeps the order videos were opened in, so the previous-track media button
/// walks back through what was watched instead of leaving the watch page.
function recordWatch(id) {
  const trail = state.watchTrail;
  if (trail[trail.length - 1] !== id) trail.push(id);
  if (trail.length > 40) trail.splice(0, trail.length - 40);
}

function previousWatch(id) {
  const trail = state.watchTrail;
  const current = trail.lastIndexOf(id);
  const from = current === -1 ? trail.length - 1 : current - 1;
  for (let index = from; index >= 0; index -= 1) {
    if (trail[index] !== id) return trail[index];
  }
  return "";
}

async function mountPlayer(container, data) {
  state.player?.destroy();
  state.player = null;
  window.__wtPlayer = null;
  if (!container) return null;

  container.classList.add("wt-player");
  container.innerHTML = `<div class="wt-loading">Resolving streams...</div>`;

  const start = async () => {
    let streams;
    let startAt = 0;
    try {
      [streams, startAt] = await Promise.all([
        invoke("yt_streams", { id: data.id }),
        invoke("yt_progress_get", { id: data.id }).catch(() => 0),
      ]);
    } catch (error) {
      if (!container.isConnected) return null;
      container.innerHTML = `<div class="wt-error">
        <p class="wt-error-text">Could not load this video: ${esc(error)}</p>
        <button type="button" data-player-retry>Retry</button>
      </div>`;
      container.querySelector("[data-player-retry]")?.addEventListener("click", () => {
        void start();
      });
      return null;
    }
    if (!container.isConnected) return null;

    const player = new window.WinTubePlayer(container, {
      formats: streams.formats || [],
      live: Boolean(streams.live),
      subtitle: streams.subtitle || null,
      duration: streams.duration || 0,
      title: data.title,
      artist: data.channel,
      artwork: `https://i.ytimg.com/vi/${encode(data.id)}/mqdefault.jpg`,
      startAt: streams.live ? 0 : startAt || 0,
      onProgress: (seconds, duration) => {
        void invoke("yt_progress_set", { id: data.id, seconds, duration }).catch(() => {});
      },
      onFinished: () => {
        void invoke("yt_progress_clear", { id: data.id }).catch(() => {});
      },
      onEnded: () => {
        if (state.settings.autoplay && data.related?.[0]) {
          location.hash = `#/watch?v=${encode(data.related[0].id)}`;
        }
      },
      onNext: () => {
        if (data.related?.[0]) location.hash = `#/watch?v=${encode(data.related[0].id)}`;
      },
      onPrevious: () => {
        const target = previousWatch(data.id);
        if (!target) return false;
        location.hash = `#/watch?v=${encode(target)}`;
        return true;
      },
      onTheater: () => document.body.classList.toggle("theater"),
      onRetry: () => void start(),
    });
    state.player = player;
    window.__wtPlayer = player;
    return player;
  };

  return start();
}

/* -------------------------------------------------------------------- shorts */

function shortStep(direction) {
  const queue = state.shortsQueue;
  if (!queue.length) return;
  const next = (state.shortsIndex + direction + queue.length) % queue.length;
  state.shortsIndex = next;
  location.hash = `#/shorts?v=${encode(queue[next])}`;
}

function shortAction(label, iconName, attribute, value, extra = "") {
  return `<button class="shorts-action ${extra}" type="button" ${attribute}="${esc(value)}">
    <span class="shorts-action-icon">${icon(iconName)}</span>
    <span class="shorts-action-label">${esc(label)}</span>
  </button>`;
}

async function renderShorts(id) {
  const page = ++currentPage;
  if (!id) {
    content.innerHTML = `<div class="shorts-view"><div class="shorts-loading">
      <div class="wt-spinner showing"></div><p>Loading Shorts...</p></div></div>`;
    const ids = await invoke("yt_shorts", {}).catch(() => []);
    if (page !== currentPage) return;
    if (!ids.length) {
      content.innerHTML = `<div class="shorts-view"><div class="shorts-loading">
        <p>Could not load Shorts.</p>
        <button class="shorts-retry" type="button" data-shorts-retry="">Retry</button>
      </div></div>`;
      return;
    }
    state.shortsQueue = ids;
    state.shortsIndex = 0;
    location.hash = `#/shorts?v=${encode(ids[0])}`;
    return;
  }
  document.title = "Shorts - YouTube";

  const existing = state.shortsQueue.indexOf(id);
  const needQueue = state.shortsQueue.length < 2 || existing < 0;
  state.shortsIndex = existing >= 0 ? existing : 0;

  content.innerHTML = `<div class="shorts-view"><div class="shorts-loading">
    <div class="wt-spinner showing"></div><p>Loading short...</p></div></div>`;

  const dataPromise = invoke("yt_watch", { id }).catch(() => null);
  const streamsPromise = invoke("yt_streams", { id }).catch((error) => ({ error: String(error) }));
  const queuePromise = needQueue ? invoke("yt_shorts", { id }).catch(() => null) : null;
  const [data, streams, queue] = await Promise.all([dataPromise, streamsPromise, queuePromise]);
  if (page !== currentPage) return;

  if (queue?.length) {
    state.shortsQueue = queue.includes(id) ? queue : [id, ...queue];
    state.shortsIndex = state.shortsQueue.indexOf(id);
  }
  if (!state.shortsQueue.includes(id)) {
    state.shortsQueue = [id];
    state.shortsIndex = 0;
  }

  if (!data) {
    content.innerHTML = `<div class="shorts-view"><div class="shorts-loading">
      <p>Could not load this short.</p>
      <button class="shorts-retry" type="button" data-shorts-retry="${esc(id)}">Retry</button>
    </div></div>`;
    return;
  }

  state.watch = data;
  const subscribed = state.subscribed.has(data.channelId);
  const likes = data.likes || "Like";
  const comments = data.commentCount || "Comments";
  const commentsHeading = data.commentCount ? `${data.commentCount} Comments` : "Comments";
  const channel = data.channelId
    ? `<a class="shorts-channel" href="#/channel/${encode(data.channelId)}">${esc(data.channel)}</a>`
    : `<span class="shorts-channel">${esc(data.channel)}</span>`;
  const channelAvatar = data.channelId
    ? `<a class="shorts-avatar" href="#/channel/${encode(data.channelId)}">${avatar(data.avatar, data.channel, 40)}</a>`
    : `<span class="shorts-avatar">${avatar(data.avatar, data.channel, 40)}</span>`;
  const streamError = streams?.error
    ? `<div class="shorts-stream-error">
        <p>${esc(streams.error)}</p>
        <button class="shorts-retry" type="button" data-shorts-retry="${esc(id)}">Retry</button>
      </div>`
    : "";

  content.innerHTML = `<div class="shorts-view" data-shorts="${esc(id)}">
    <div class="shorts-main">
      <div class="shorts-center">
        <div class="shorts-frame">
          <div id="short-player"></div>
          ${streamError}
        </div>
        <div class="shorts-rail">
          ${shortAction(likes, "heart", "data-rate", "like", data.rating === "like" ? "rated" : "")}
          ${shortAction(comments, "comment", "data-shorts-comments-toggle", "1")}
          ${shortAction("Share", "share", "data-share", id)}
          ${shortAction("Remix", "remix", "data-short-remix", id)}
          ${shortAction("More", "more", "data-video-menu", id)}
        </div>
      </div>
      <div class="shorts-meta">
        <div class="shorts-meta-top">
          ${channelAvatar}
          <div class="shorts-meta-name">
            ${channel}
            <button class="pill ${subscribed ? "tonal" : "light"}" type="button" data-subscribe="${esc(
              data.channelId,
            )}">${subscribed ? "Subscribed" : "Subscribe"}</button>
          </div>
        </div>
        <h1 class="shorts-title">${esc(data.title)}</h1>
        <div class="shorts-sound">${icon("music")}<span>${esc(data.channel)} · Original audio</span></div>
      </div>
      <div class="shorts-nav">
        ${state.shortsQueue.length > 1 ? `<button class="shorts-step" type="button" data-short-prev aria-label="Previous short">${icon("chevron-up")}</button>` : ""}
        ${state.shortsQueue.length > 1 ? `<button class="shorts-step" type="button" data-short-next aria-label="Next short">${icon("chevron-down")}</button>` : ""}
      </div>
    </div>
    <div class="shorts-comments" data-shorts-comments>
      <div class="shorts-comments-head">
        <h3>${esc(commentsHeading)}</h3>
        <button class="shorts-comments-close" type="button" data-shorts-comments-close aria-label="Close comments">&times;</button>
      </div>
      <div class="shorts-comments-body">
        <div data-comment-list>${data.comments.map(commentItem).join("")}</div>
        ${
          data.commentsToken
            ? `<button class="replies-toggle" type="button" data-more-comments>${icon("chevron-down")}Show more</button>`
            : ""
        }
      </div>
    </div>
  </div>`;

  syncSubscribeButtons();
  if (streams && !streams.error) {
    const player = new window.WinTubePlayer(document.getElementById("short-player"), {
      variant: "shorts",
      formats: streams.formats || [],
      subtitle: streams.subtitle || null,
      duration: streams.duration || 0,
      loop: true,
      title: data.title,
      artist: data.channel,
      artwork: `https://i.ytimg.com/vi/${encode(id)}/mqdefault.jpg`,
      onNext: () => shortStep(1),
      onPrevious: () => {
        shortStep(-1);
        return true;
      },
      onRetry: () => void renderShorts(id),
    });
    state.player = player;
    window.__wtPlayer = player;
  }

  const nextId = state.shortsQueue[(state.shortsIndex + 1) % state.shortsQueue.length];
  if (nextId && nextId !== id) {
    window.setTimeout(() => {
      if (page === currentPage) void invoke("yt_streams", { id: nextId }).catch(() => {});
    }, 3000);
  }
}

/* ----------------------------------------------------------------- rendering */

let currentPage = 0;

async function renderHome() {
  const page = ++currentPage;
  content.innerHTML = `${skeletonGrid()}`;
  try {
    const feed = await invoke("yt_home");
    if (page !== currentPage) return;
    state.feed = feed;
    const chips = (feed.chips.length
      ? feed.chips.map((chip, index) => ({
          label: chip.label,
          params: chip.params,
          selected: chip.selected || (index === 0 && !feed.chips.some((c) => c.selected)),
        }))
      : DEFAULT_CHIPS.map((label, index) => ({ label, selected: index === 0 })));
    if (!feed.sections.some((section) => section.items?.length || section.playlists?.length || section.posts?.length)) {
      content.innerHTML = `${chipRow(chips, { home: true })}${emptyState(
        "Try searching to get started",
        "Start watching videos to help us build a feed of videos you'll love.",
      )}`;
      return;
    }
    content.innerHTML = `${chipRow(chips, { home: true })}${sectionsBlock(feed.sections)}${
      feed.continuation ? moreSentinel() : ""
    }`;
    markChipOverflow();
    observeMore();
  } catch (error) {
    if (page !== currentPage) return;
    content.innerHTML = `<div class="error">Could not load Home: ${esc(error)}<br /><button type="button" data-retry>Retry</button></div>`;
  }
}

async function renderSearch(query, params) {
  const page = ++currentPage;
  searchInput.value = query;
  document.title = `${query} - YouTube`;
  content.innerHTML = skeletonGrid();
  try {
    const feed = await invoke("yt_search", { query, params: params || null });
    if (page !== currentPage) return;
    state.feed = feed;
    const chips = feed.chips.length
      ? feed.chips
      : [
          { label: "All", selected: true, params: "" },
          { label: "Videos", selected: false, params: "" },
          { label: "Shorts", selected: false, params: "" },
          { label: "Channels", selected: false, params: "" },
        ];
    const body = sectionsBlock(feed.sections);
    content.innerHTML = `${chipRow(chips)}${body || emptyState("No results", "Try different keywords.")}${
      feed.continuation ? moreSentinel() : ""
    }`;
    markChipOverflow();
    observeMore();
  } catch (error) {
    if (page !== currentPage) return;
    content.innerHTML = `<div class="error">Search failed: ${esc(error)}<br /><button type="button" data-retry>Retry</button></div>`;
  }
}

async function renderFeed(browseId, params, title) {
  const page = ++currentPage;
  document.title = title ? `${title} - YouTube` : "YouTube";
  content.innerHTML = `<div class="feed-head"><h1>${esc(title || "")}</h1></div>${skeletonGrid()}`;
  try {
    const feed = await invoke("yt_feed", { browseId, params: params || null });
    if (page !== currentPage) return;
    state.feed = feed;
    const body = sectionsBlock(feed.sections);
    content.innerHTML = `${title ? `<div class="feed-head"><h1>${esc(title)}</h1></div>` : ""}${
      body || emptyState("Nothing here yet", "This list is empty.")
    }${feed.continuation ? moreSentinel() : ""}`;
    observeMore();
  } catch (error) {
    if (page !== currentPage) return;
    content.innerHTML = `<div class="error">Could not load this page: ${esc(error)}<br /><button type="button" data-retry>Retry</button></div>`;
  }
}

function watchOwner(data) {
  const subscribed = state.subscribed.has(data.channelId);
  return `<div class="owner">
    ${avatar(data.avatar, data.channel, 40)}
    <div>
      <a class="owner-name" href="#/channel/${encode(data.channelId)}">${esc(data.channel)}${
        data.verified ? icon("check") : ""
      }</a>
      <div class="owner-subs">${esc(data.subscribers)}</div>
    </div>
    <div class="owner-buttons">
      <button class="pill tonal" type="button" data-external="https://www.youtube.com/channel/${encode(
        data.channelId,
      )}/membership">Join</button>
      <button class="pill ${subscribed ? "tonal" : "light"}" type="button" data-subscribe="${esc(
        data.channelId,
      )}">${subscribed ? "Subscribed" : "Subscribe"}</button>
    </div>
  </div>`;
}

async function renderWatch(id) {
  const page = ++currentPage;
  recordWatch(id);
  document.body.classList.remove("theater");
  content.innerHTML = `<div class="watch-skeleton"><div class="skeleton player"></div>
    <div class="skeleton skeleton-line" style="width:50%;height:22px;margin-bottom:12px"></div>
    <div class="skeleton skeleton-line" style="width:30%"></div></div>`;
  try {
    const data = await invoke("yt_watch", { id });
    if (page !== currentPage) return;
    state.watch = data;
    document.title = data.title ? `${data.title} - YouTube` : "YouTube";
    if (data.channelId) state.subscribed.delete(data.channelId); // filled from guide, keeps header state honest
    const meta = `<span>${esc(data.views)}</span><span>${esc(data.published)}</span>`;
    content.innerHTML = `<div class="watch">
      <article class="watch-main" data-watch="${esc(data.id)}">
        <div class="player" id="player"></div>
        <div class="watch-info">
        <h1 class="watch-title">${esc(data.title)}</h1>
        <div class="watch-bar">
          ${watchOwner(data)}
          <div class="actions">
            <button type="button" data-rate="like" class="${data.rating === "like" ? "rated" : ""}">${icon(
              "like",
            )}<span>${esc(data.likes || "")}</span></button>
            <span class="sep"></span>
            <button type="button" data-rate="dislike" class="${
              data.rating === "dislike" ? "rated" : ""
            }">${icon("dislike")}</button>
            <span class="sep"></span>
            <button type="button" data-share="${esc(data.id)}">${icon("share")}<span>Share</span></button>
            <button type="button" data-save="${esc(data.id)}">${icon("save")}<span>Save</span></button>
            <span class="sep"></span>
            <button type="button" data-download="${esc(data.id)}" aria-label="Download">${icon("download")}</button>
            <span class="sep"></span>
            <button type="button" data-video-menu="${esc(data.id)}" aria-label="More">${icon("more")}</button>
          </div>
        </div>
        <div class="desc" data-desc>
          <div class="desc-meta">${meta}</div>
          <div class="desc-title">${esc(data.title)}</div>
          <div class="desc-text">${esc(data.description)}</div>
        </div>
        ${commentsBlock(data)}
        </div>
      </article>
      ${relatedBlock(data)}
    </div>`;
    syncSubscribeButtons();
    mountPlayer(document.getElementById("player"), data);
    observeMore();
  } catch (error) {
    if (page !== currentPage) return;
    content.innerHTML = `<div class="error">Could not load this video: ${esc(
      error,
    )}<br /><button type="button" data-retry>Retry</button></div>`;
  }
}

function commentsBlock(data) {
  const count = data.commentCount ? `${esc(data.commentCount)} Comments` : "Comments";
  return `<section class="comments" data-comments>
    <div class="comments-head">
      <h2>${count}</h2>
      <button class="sort-btn" type="button" data-comment-sort>${icon("sort")}Sort by</button>
    </div>
    <div class="composer">
      ${avatar(state.account?.avatar, state.account?.name || "You", 40)}
      <div class="composer-field">Add a comment...</div>
    </div>
    <div data-comment-list>${data.comments.map(commentItem).join("")}</div>
    ${
      data.commentsToken
        ? `<button class="replies-toggle" type="button" data-more-comments>${icon("chevron-down")}Show more</button>`
        : ""
    }
  </section>`;
}

function commentItem(comment, isReply = false) {
  const channel = comment.channelId ? `href="#/channel/${encode(comment.channelId)}"` : "";
  const authorTag = channel ? "a" : "span";
  const replies = comment.replies || "";
  const canShowReplies = !isReply && (comment.repliesToken || replies);
  return `<div class="comment${isReply ? " reply" : ""}" data-comment-id="${esc(comment.id || "")}">
    ${
      channel
        ? `<a ${channel}>${avatar(comment.avatar, comment.author, isReply ? 24 : 40)}</a>`
        : avatar(comment.avatar, comment.author, isReply ? 24 : 40)
    }
    <div class="comment-body">
      ${comment.pinned ? `<div class="comment-pin">${icon("pinned")}Pinned by the creator</div>` : ""}
      <div class="comment-head">
        <${authorTag} class="comment-author" ${channel}>${esc(comment.author)}</${authorTag}>
        <span class="comment-when">${esc(comment.published)}</span>
      </div>
      <div class="comment-text">${esc(comment.text)}</div>
      <div class="comment-actions">
        <button type="button" data-comment-like>${icon("like")}${esc(comment.likes || "")}</button>
        <button type="button" data-comment-dislike>${icon("dislike")}</button>
        ${
          isReply || !comment.id
            ? ""
            : `<button class="reply" type="button" data-comment-reply="${esc(comment.id)}">Reply</button>`
        }
      </div>
      ${
        canShowReplies
          ? `<button class="replies-toggle" type="button" data-comment-replies data-replies-token="${esc(
              comment.repliesToken || "",
            )}" data-comment-id="${esc(comment.id || "")}">${
              replies ? `${esc(replies)} ${replies === "1" ? "reply" : "replies"}` : "View replies"
            } ${icon("chevron-down")}</button>
            <div class="comment-replies" data-reply-list="${esc(comment.id || "")}" hidden></div>`
          : ""
      }
    </div>
  </div>`;
}

function relatedBlock(data) {
  return `<aside class="watch-side">
    <div class="side-chips">
      <span class="chip active">All</span>
      <a class="chip" href="#/channel/${encode(data.channelId)}">From ${esc(data.channel)}</a>
      <span class="chip">Related</span>
      <span class="chip">For you</span>
    </div>
    ${data.related
      .map(
        (video) => `<article class="rel" data-video="${esc(video.id)}">
        <div class="thumb">
          ${video.thumbnail ? `<img src="${esc(video.thumbnail)}" alt="" loading="lazy" />` : ""}
          ${video.duration ? `<span class="duration">${esc(video.duration)}</span>` : ""}
        </div>
        <div class="rel-text">
          <div class="rel-title">${esc(video.title)}</div>
          ${channelLink(video.channel, video.channelId)}
          <div class="rel-views">${esc([video.views, video.published].filter(Boolean).join(" · "))}</div>
        </div>
        <button class="rel-menu" type="button" data-video-menu="${esc(video.id)}" aria-label="Action menu">${icon(
          "more",
        )}</button>
      </article>`,
      )
      .join("")}
  </aside>`;
}

async function renderChannel(id, tabTitle) {
  const page = ++currentPage;
  content.innerHTML = `<div class="channel"><div class="skeleton" style="height:200px;border-radius:16px"></div>${skeletonGrid(
    3,
  )}</div>`;
  try {
    const data = await invoke("yt_channel", { id });
    if (page !== currentIndex()) return;
    if (data.header.subscribed) state.subscribed.add(id);
    else state.subscribed.delete(id);
    const header = data.header;
    const tabs = data.tabs.filter((tab) => tab.params);
    const active = tabs.find((tab) => tab.title === tabTitle) || tabs.find((tab) => tab.selected) || tabs[0];
    document.title = `${header.title} - YouTube`;
    content.innerHTML = `<div class="channel">
      <div class="channel-banner">${
        header.banner ? `<img src="${esc(header.banner)}" alt="" />` : ""
      }</div>
      <div class="channel-head">
        <div class="channel-avatar">${
          header.avatar ? `<img src="${esc(header.avatar)}" alt="" />` : initial(header.title)
        }</div>
        <div class="channel-info">
          <h1 class="channel-title">${esc(header.title)}${header.verified ? icon("check") : ""}</h1>
          <div class="channel-meta">
            ${header.handle ? `<span>${esc(header.handle)}</span>` : ""}
            ${header.subscribers ? `<span>${esc(header.subscribers)}</span>` : ""}
            ${header.videos ? `<span>${esc(header.videos)}</span>` : ""}
          </div>
          <div class="channel-desc" data-channel-desc>${esc(header.description)}</div>
          <div class="channel-actions">
            <button class="pill ${state.subscribed.has(id) ? "tonal" : "light"}" type="button" data-subscribe="${esc(
              id,
            )}">${state.subscribed.has(id) ? "Subscribed" : "Subscribe"}</button>
          </div>
        </div>
      </div>
      <div class="channel-tabs">
        ${tabs
          .map(
            (tab) => `<button class="channel-tab${
              tab.title === active?.title ? " active" : ""
            }" type="button" data-tab="${esc(tab.title)}" data-tab-params="${esc(tab.params)}">${esc(
              tab.title,
            )}</button>`,
          )
          .join("")}
        <button class="channel-search" type="button" data-channel-search="${esc(
          header.title,
        )}" aria-label="Search channel">${icon("search")}</button>
      </div>
      <div data-channel-body>${sectionsBlock(data.feed.sections)}</div>
    </div>`;
    state.channel = { id, title: header.title, tabs, data };
    if (active && active.title !== (data.tabs.find((tab) => tab.selected)?.title || tabs[0]?.title)) {
      await loadChannelTab(id, active);
    }
  } catch (error) {
    if (page !== currentIndex()) return;
    content.innerHTML = `<div class="error">Could not load this channel: ${esc(
      error,
    )}<br /><button type="button" data-retry>Retry</button></div>`;
  }
}

function currentIndex() {
  return currentPage;
}

async function loadChannelTab(channelId, tab) {
  if (!state.channel) return;
  const body = content.querySelector("[data-channel-body]");
  if (!body) return;
  body.innerHTML = skeletonGrid(3);
  content.querySelectorAll(".channel-tab").forEach((node) => {
    node.classList.toggle("active", node.getAttribute("data-tab") === tab.title);
  });
  history.replaceState(null, "", `#/channel/${encode(channelId)}?tab=${encode(tab.title)}`);
  try {
    const feed = await invoke("yt_channel_tab", { id: channelId, params: tab.params });
    body.innerHTML = sectionsBlock(feed.sections) || emptyState("No videos", "This tab is empty.");
  } catch (error) {
    body.innerHTML = `<div class="error">Could not load this tab: ${esc(error)}</div>`;
  }
}

function renderSettings() {
  currentPage += 1;
  document.title = "Settings - YouTube";
  content.innerHTML = `<div class="feed-head"><h1>Settings</h1></div>
    <div class="channel">
      <div class="post">
        <div class="post-head"><div><div class="owner-name">Playback</div><div class="comment-when">Stored on this machine</div></div></div>
        <label class="toggle" style="display:flex;gap:10px;align-items:center;margin:12px 0">
          <input type="checkbox" id="setting-autoplay" ${state.settings.autoplay ? "checked" : ""} />
          <span>Autoplay the next related video</span>
        </label>
        <p class="muted">Player speed, quality, volume and captions are remembered in the player menus.</p>
      </div>
      <div class="post">
        <div class="post-head"><div><div class="owner-name">Account</div><div class="comment-when">${
          state.signedIn ? esc(state.account?.name || "Signed in") : "Signed out"
        }</div></div></div>
        <p class="muted">The session lives in the WebView2 profile and survives restarts.</p>
        <button class="pill tonal" type="button" data-external="https://myaccount.google.com/">Manage Google account</button>
      </div>
      <div class="post">
        <div class="post-head"><div><div class="owner-name">About</div><div class="comment-when">WinTube 0.2.0</div></div></div>
        <p class="muted">Rust and Tauri with a hand-built UI, talking to YouTube's web API directly.</p>
      </div>
    </div>`;
  const toggle = document.getElementById("setting-autoplay");
  toggle?.addEventListener("change", () => {
    state.settings.autoplay = toggle.checked;
    localStorage.setItem("wintube-autoplay", toggle.checked ? "1" : "0");
  });
}

async function toggleReplies(button) {
  const comment = button.closest(".comment");
  const list = comment?.querySelector("[data-reply-list]");
  if (!list) return;

  if (!list.hidden) {
    list.hidden = true;
    button.classList.remove("open");
    button.innerHTML = `${button.dataset.label || "View replies"} ${icon("chevron-down")}`;
    return;
  }

  if (list.dataset.loaded === "1") {
    list.hidden = false;
    button.classList.add("open");
    button.innerHTML = `Hide replies ${icon("chevron-up")}`;
    return;
  }

  const token = button.getAttribute("data-replies-token");
  if (!token) {
    toast("This reply thread is not available");
    return;
  }

  button.dataset.label = button.textContent.trim();
  button.disabled = true;
  button.textContent = "Loading replies...";
  try {
    const page = await invoke("yt_comments", { continuation: token });
    list.innerHTML =
      page.comments.map((reply) => commentItem(reply, true)).join("") +
      (page.continuation
        ? `<button class="replies-toggle" type="button" data-more-replies data-replies-token="${esc(
            page.continuation,
          )}">More replies ${icon("chevron-down")}</button>`
        : "");
    list.dataset.loaded = "1";
    list.hidden = false;
    button.disabled = false;
    button.classList.add("open");
    button.innerHTML = `Hide replies ${icon("chevron-up")}`;
  } catch (error) {
    button.disabled = false;
    button.innerHTML = `${button.dataset.label || "View replies"} ${icon("chevron-down")}`;
    toast(`Could not load replies: ${error}`);
  }
}

async function loadMoreReplies(button) {
  const token = button.getAttribute("data-replies-token");
  if (!token) return;
  button.disabled = true;
  button.textContent = "Loading...";
  try {
    const page = await invoke("yt_comments", { continuation: token });
    button.insertAdjacentHTML(
      "beforebegin",
      page.comments.map((reply) => commentItem(reply, true)).join(""),
    );
    if (page.continuation) {
      button.setAttribute("data-replies-token", page.continuation);
      button.disabled = false;
      button.innerHTML = `More replies ${icon("chevron-down")}`;
    } else {
      button.remove();
    }
  } catch (error) {
    button.disabled = false;
    button.innerHTML = `More replies ${icon("chevron-down")}`;
    toast(`Could not load replies: ${error}`);
  }
}

function openReplyBox(button) {
  const comment = button.closest(".comment");
  if (!comment) return;
  const existing = comment.querySelector(".reply-composer");
  if (existing) {
    existing.querySelector("textarea")?.focus();
    return;
  }

  const parent = button.getAttribute("data-comment-reply") || comment.getAttribute("data-comment-id");
  if (!parent) return;
  const box = document.createElement("div");
  box.className = "reply-composer";
  box.innerHTML = `<textarea rows="1" placeholder="Add a reply..." aria-label="Reply"></textarea>
    <div class="reply-composer-actions">
      <button type="button" class="reply-cancel" data-comment-cancel>Cancel</button>
      <button type="button" class="reply-send" data-comment-send="${esc(parent)}">Reply</button>
    </div>`;
  comment.querySelector(".comment-body")?.append(box);
  box.querySelector("textarea")?.focus();
}

async function submitReply(button) {
  const box = button.closest(".reply-composer");
  const textarea = box?.querySelector("textarea");
  const comment = button.closest(".comment");
  const text = textarea?.value.trim() || "";
  const parent = button.getAttribute("data-comment-send");

  if (!text) {
    textarea?.focus();
    return;
  }
  if (!parent || !state.watch?.id) {
    toast("Could not find the comment to reply to");
    return;
  }

  button.disabled = true;
  button.textContent = "Posting...";
  try {
    await invoke("yt_comment_post", { id: state.watch.id, text, parent });
    box?.remove();
    toast("Reply posted");
    const toggle = comment?.querySelector("[data-comment-replies]");
    const list = comment?.querySelector("[data-reply-list]");
    if (toggle && list) {
      list.dataset.loaded = "";
      list.hidden = true;
      toggle.disabled = false;
      toggle.innerHTML = `Refresh replies ${icon("chevron-down")}`;
      void toggleReplies(toggle);
    }
  } catch (error) {
    toast(`Could not post the reply: ${error}`);
    button.disabled = false;
    button.textContent = "Reply";
  }
}

async function loadMoreComments() {  const data = state.watch;
  if (!data?.commentsToken) return;
  const button = content.querySelector("[data-more-comments]");
  if (button) {
    button.disabled = true;
    button.textContent = "Loading...";
  }
  try {
    const page = await invoke("yt_comments", { continuation: data.commentsToken });
    const list = content.querySelector("[data-comment-list]");
    list?.insertAdjacentHTML("beforeend", page.comments.map(commentItem).join(""));
    data.commentsToken = page.continuation;
    if (button) {
      if (page.continuation) {
        button.disabled = false;
        button.innerHTML = `${icon("chevron-down")}Show more`;
      } else {
        button.remove();
      }
    }
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "Retry";
    }
    toast(`Could not load comments: ${error}`);
  }
}

/* --------------------------------------------------------------- pagination */

let moreObserver = null;

function observeMore() {
  moreObserver?.disconnect();
  const sentinel = content.querySelector("[data-load-more]");
  if (!sentinel) return;
  moreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        moreObserver.disconnect();
        void loadMore();
      }
    },
    { root: content, rootMargin: "800px" },
  );
  moreObserver.observe(sentinel);
}

async function loadMore() {
  const feed = state.feed;
  if (!feed?.continuation) return;
  const button = content.querySelector("[data-load-more]");
  if (button) button.textContent = "Loading...";
  try {
    const more = await invoke("yt_more", { continuation: feed.continuation });
    state.feed.continuation = more.continuation;
    const holder = button?.closest(".feed-more");
    const markup = sectionsBlock(more.sections);
    if (holder) holder.insertAdjacentHTML("beforebegin", markup);
    else content.insertAdjacentHTML("beforeend", markup);
    if (button) button.textContent = "Load more";
    if (!more.continuation) holder?.remove();
    observeMore();
  } catch {
    if (button) button.textContent = "Retry";
  }
}

/* -------------------------------------------------------------------- events */

let moreCommentsToken = null;

async function copyLink(videoId) {
  const url = `https://youtu.be/${videoId}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
      return;
    }
    throw new Error("no clipboard");
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = url;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      document.execCommand("copy");
      field.remove();
      toast("Link copied");
    } catch {
      toast(url);
    }
  }
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest("[data-short-next]")) {
    shortStep(1);
    return;
  }
  if (target.closest("[data-short-prev]")) {
    shortStep(-1);
    return;
  }
  const commentsToggle = target.closest("[data-shorts-comments-toggle]");
  if (commentsToggle) {
    content.querySelector(".shorts-view")?.classList.toggle("comments-open");
    return;
  }
  if (target.closest("[data-shorts-comments-close]")) {
    content.querySelector(".shorts-view")?.classList.remove("comments-open");
    return;
  }
  if (target.closest("[data-short-remix]")) {
    toast("Remix is only available on YouTube");
    return;
  }
  const shortsRetry = target.closest("[data-shorts-retry]");
  if (shortsRetry) {
    void renderShorts(shortsRetry.getAttribute("data-shorts-retry"));
    return;
  }
  const shortCard = target.closest("[data-short-video]");
  if (shortCard) {
    const shortId = shortCard.getAttribute("data-short-video");
    const group = shortCard.closest(".shorts-grid, .shorts-row");
    const ids = group
      ? [...group.querySelectorAll("[data-short-video]")]
          .map((node) => node.getAttribute("data-short-video"))
          .filter(Boolean)
      : [];
    state.shortsQueue = ids.includes(shortId) ? ids : [shortId];
    state.shortsIndex = Math.max(0, state.shortsQueue.indexOf(shortId));
    state.shortsQueueAt = Date.now();
    location.hash = `#/shorts?v=${encode(shortId)}`;
    return;
  }

  if (target.closest("[data-signin]")) {
    void beginSignIn();
    return;
  }

  const channelAnchor = target.closest("a[href^='#/channel/']");
  if (channelAnchor) return; // let the router handle it

  const retry = target.closest("[data-retry]");
  if (retry) {
    render();
    return;
  }

  const chip = target.closest("[data-chip]");
  if (chip) {
    const label = chip.getAttribute("data-chip") || "";
    const params = chip.getAttribute("data-params") || "";
    if (label === "Custom feed") return;
    if (label === "All") {
      if (location.hash.startsWith("#/results")) {
        const query = new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "";
        location.hash = `#/results?q=${encodeURIComponent(query)}`;
      } else {
        location.hash = "#/";
      }
    } else {
      searchInput.value = label;
      location.hash = `#/results?q=${encodeURIComponent(label)}${params ? `&params=${encodeURIComponent(params)}` : ""}`;
    }
    return;
  }

  const tab = target.closest("[data-tab]");
  if (tab && state.channel) {
    void loadChannelTab(state.channel.id, {
      title: tab.getAttribute("data-tab"),
      params: tab.getAttribute("data-tab-params"),
    });
    return;
  }

  const subscribe = target.closest("[data-subscribe]");
  if (subscribe) {
    const channelId = subscribe.getAttribute("data-subscribe");
    void toggleSubscribe(channelId, !state.subscribed.has(channelId));
    return;
  }

  const rate = target.closest("[data-rate]");
  if (rate && state.watch) {
    const kind = rate.getAttribute("data-rate");
    const already = rate.classList.contains("rated");
    const next = already ? "none" : kind;
    rate.parentElement.querySelectorAll("[data-rate]").forEach((node) => node.classList.remove("rated"));
    if (next !== "none") rate.classList.add("rated");
    void toggleLike(state.watch.id, next);
    return;
  }

  const share = target.closest("[data-share]");
  if (share) {
    void copyLink(share.getAttribute("data-share"));
    return;
  }

  const save = target.closest("[data-save]");
  if (save) {
    const videoId = save.getAttribute("data-save");
    saveMenu(save, videoId);
    return;
  }

  const playlistToggle = target.closest("[data-playlist-toggle]");
  if (playlistToggle) {
    void togglePlaylist(playlistToggle);
    return;
  }

  const downloadButton = target.closest("[data-download]");
  if (downloadButton) {
    event.stopImmediatePropagation();
    downloadMenu(downloadButton, downloadButton.getAttribute("data-download"));
    return;
  }

  const downloadVideo = target.closest("[data-download-video]");
  if (downloadVideo) {
    startDownload(downloadVideo.getAttribute("data-download-video"), false);
    return;
  }

  const downloadAudio = target.closest("[data-download-audio]");
  if (downloadAudio) {
    startDownload(downloadAudio.getAttribute("data-download-audio"), true);
    return;
  }

  const videoMenuButton = target.closest("[data-video-menu]");
  if (videoMenuButton) {
    event.stopPropagation();
    videoMenu(videoMenuButton, videoMenuButton.getAttribute("data-video-menu"));
    return;
  }

  const copy = target.closest("[data-copy]");
  if (copy) {
    void copyLink(copy.getAttribute("data-copy"));
    closeMenu();
    return;
  }

  const external = target.closest("[data-external]");
  if (external) {
    void openExternal(external.getAttribute("data-external"));
    closeMenu();
    return;
  }

  if (target.closest("[data-switch-account]")) {
    closeMenu();
    void beginSignIn();
    return;
  }

  if (target.closest("[data-sign-out]")) {
    closeMenu();
    void invoke("yt_sign_out")
      .then(() => {
        state.signedIn = false;
        state.account = null;
        state.subscriptions = [];
        render();
      })
      .catch((error) => toast(`Sign out failed: ${error}`));
    return;
  }

  const desc = target.closest("[data-desc]");
  if (desc && !target.closest("a")) {
    desc.classList.toggle("expanded");
    return;
  }

  if (target.closest("[data-more-comments]")) {
    void loadMoreComments();
    return;
  }

  const readAll = target.closest("[data-read-all]");
  if (readAll) {
    markNotificationsRead();
    return;
  }

  const notif = target.closest("[data-notif]");
  if (notif) {
    const id = notif.getAttribute("data-notif");
    state.notifications = state.notifications.map((item) =>
      item.id === id ? { ...item, read: true } : item,
    );
    state.unread = state.notifications.filter((item) => !item.read).length;
    updateBell();
    closePanel();
    const videoId = notif.getAttribute("data-video");
    const channelId = notif.getAttribute("data-channel-id");
    if (videoId) location.hash = `#/watch?v=${encode(videoId)}`;
    else if (channelId) location.hash = `#/channel/${encode(channelId)}`;
    return;
  }

  if (target.closest("[data-load-more]")) {
    void loadMore();
    return;
  }

  if (target.closest("[data-channel-search]")) {
    searchInput.value = target.closest("[data-channel-search]").getAttribute("data-channel-search");
    searchInput.focus();
    return;
  }

  if (target.closest("[data-channel-desc]")) {
    target.closest("[data-channel-desc]").classList.toggle("expanded");
    return;
  }

  if (target.closest("[data-comment-sort]")) {
    toast("Comment sorting is not exposed by the API this client uses");
    return;
  }

  const commentLike = target.closest("[data-comment-like], [data-comment-dislike]");
  if (commentLike) {
    commentLike.classList.toggle("rated");
    return;
  }

  const replyButton = target.closest("[data-comment-reply]");
  if (replyButton) {
    openReplyBox(replyButton);
    return;
  }

  const repliesButton = target.closest("[data-comment-replies]");
  if (repliesButton) {
    void toggleReplies(repliesButton);
    return;
  }

  const moreReplies = target.closest("[data-more-replies]");
  if (moreReplies) {
    void loadMoreReplies(moreReplies);
    return;
  }

  if (target.closest("[data-comment-cancel]")) {
    target.closest(".reply-composer")?.remove();
    return;
  }

  const sendReply = target.closest("[data-comment-send]");
  if (sendReply) {
    void submitReply(sendReply);
    return;
  }

  const playlist = target.closest("[data-playlist]");
  if (playlist) {
    const id = playlist.getAttribute("data-playlist");
    location.hash = `#/feed?browseId=${encode(`VL${id}`)}&title=${encode("Playlist")}`;
    return;
  }

  const video = target.closest("[data-video]");
  if (video) {
    const id = video.getAttribute("data-video");
    if (id) location.hash = `#/watch?v=${encode(id)}`;
  }
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (state.menu && !state.menu.contains(target) && !target.closest("[data-video-menu]") && !target.closest("[data-save]")) closeMenu();
  if (state.panel && !state.panel.contains(target) && !target.closest("#bell-button")) closePanel();
});

document.getElementById("bell-button")?.addEventListener("click", (event) => {
  event.stopPropagation();
  void toggleNotifications();
});

document.getElementById("account-button")?.addEventListener("click", (event) => {
  event.stopPropagation();
  accountMenu(event.currentTarget);
});

document.getElementById("signin-button")?.addEventListener("click", () => {
  void beginSignIn();
});

document.querySelector('[aria-label="Search with your voice"]')?.addEventListener("click", () => {
  toast("Voice search is not available in this build");
});

document.getElementById("guide-toggle")?.addEventListener("click", () => {
  document.body.classList.toggle("guide-collapsed");
  localStorage.setItem(
    "wintube-guide-collapsed",
    document.body.classList.contains("guide-collapsed") ? "1" : "0",
  );
});

guide.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.closest("[data-signin]")) {
    void beginSignIn();
    return;
  }
  if (target.closest("[data-subs-toggle]")) {
    state.subsExpanded = !state.subsExpanded;
    renderGuide();
    return;
  }
  const unavailable = target.closest("[data-unavailable]");
  if (unavailable) {
    const label = unavailable.getAttribute("data-unavailable");
    const external = {
      Help: "https://support.google.com/youtube",
      "Send feedback": "https://www.youtube.com/t/feedback",
      "YouTube Premium": "https://www.youtube.com/premium",
      "YouTube Music": "https://music.youtube.com",
      "YouTube Kids": "https://www.youtubekids.com",
    }[label];
    if (external) void openExternal(external);
    else toast(`${label} is not available here yet`);
  }
});

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  location.hash = `#/results?q=${encodeURIComponent(query)}`;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    searchInput.blur();
  }
});

/* --------------------------------------------------------------- auth + boot */

async function beginSignIn() {
  if (!bridge()) return;
  try {
    await invoke("yt_sign_in");
    pollForSignIn();
    toast("Finish signing in with Google");
  } catch (error) {
    toast(`Could not open sign-in: ${error}`);
  }
}

let authPoll = null;
function pollForSignIn() {
  if (authPoll) return;
  const started = Date.now();
  authPoll = window.setInterval(() => {
    void (async () => {
      if (Date.now() - started > 10 * 60 * 1000) {
        window.clearInterval(authPoll);
        authPoll = null;
        return;
      }
      try {
        if (await invoke("yt_auth_status")) {
          window.clearInterval(authPoll);
          authPoll = null;
          await refreshAuth();
          render();
        }
      } catch {
        window.clearInterval(authPoll);
        authPoll = null;
      }
    })();
  }, 1500);
}

function markChipOverflow() {
  document.querySelectorAll(".chips").forEach((row) => {
    row.classList.toggle("overflowing", row.scrollWidth > row.clientWidth + 1);
  });
}

function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const [path, queryString] = raw.split("?");
  return { path, params: new URLSearchParams(queryString || "") };
}

function render() {
  if (!bridge()) {
    content.innerHTML = `<div class="empty"><h2>WinTube UI preview</h2><p>Open this inside the Tauri shell.</p></div>`;
    return;
  }
  state.player?.destroy();
  state.player = null;
  window.__wtPlayer = null;
  closeMenu();
  closePanel();
  state.feed = null;
  state.watch = null;
  state.channel = null;
  moreCommentsToken = null;

  const { path, params } = parseHash();
  const isWatch = path.startsWith("/watch");
  document.body.classList.toggle("watch-page", isWatch);
  document.body.classList.toggle("shorts-page", path.startsWith("/shorts"));
  if (!path.startsWith("/shorts")) {
    state.shortsQueue = [];
    state.shortsIndex = 0;
  }
  renderGuide();
  content.scrollTop = 0;

  const channelMatch = /^\/channel\/([^/]+)/.exec(path);
  if (channelMatch) {
    document.body.classList.remove("watch-page", "theater");
    void renderChannel(decodeURIComponent(channelMatch[1]), params.get("tab") || "");
    return;
  }

  if (path.startsWith("/shorts")) {
    void renderShorts(params.get("v") || "");
    return;
  }

  if (path.startsWith("/watch")) {
    void renderWatch(params.get("v") || "");
    return;
  }

  if (path.startsWith("/results")) {
    void renderSearch(params.get("q") || "", params.get("params") || "");
    return;
  }

  if (path.startsWith("/feed")) {
    document.body.classList.remove("watch-page", "theater");
    void renderFeed(
      params.get("browseId") || "",
      params.get("params") || "",
      params.get("title") || "",
    );
    return;
  }

  if (path.startsWith("/settings")) {
    document.body.classList.remove("watch-page", "theater");
    renderSettings();
    return;
  }

  document.title = "YouTube";
  void renderHome();
}

let shortsWheelAt = 0;
document.addEventListener(
  "wheel",
  (event) => {
    if (!document.body.classList.contains("shorts-page")) return;
    if (content.querySelector(".shorts-view.comments-open")) return;
    if (event.target instanceof Element && event.target.closest(".shorts-comments")) return;
    if (Math.abs(event.deltaY) < 12) return;
    const now = Date.now();
    if (now - shortsWheelAt < 650) return;
    shortsWheelAt = now;
    shortStep(event.deltaY > 0 ? 1 : -1);
  },
  { passive: true },
);

document.addEventListener("keydown", (event) => {
  if (!document.body.classList.contains("shorts-page")) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === "Escape") {
    content.querySelector(".shorts-view")?.classList.remove("comments-open");
    return;
  }
  if (event.key === "ArrowDown" || event.key === "PageDown") {
    event.preventDefault();
    shortStep(1);
  } else if (event.key === "ArrowUp" || event.key === "PageUp") {
    event.preventDefault();
    shortStep(-1);
  }
});

document.addEventListener("error", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  const parent = target.parentElement;
  if (!parent) return;
  parent.textContent = "";
}, true);

new MutationObserver(markChipOverflow).observe(content, { childList: true, subtree: true });
window.addEventListener("resize", markChipOverflow);
window.addEventListener("hashchange", render);

if (localStorage.getItem("wintube-guide-collapsed") === "1") {
  document.body.classList.add("guide-collapsed");
}

void (async () => {
  await refreshAuth();
  initDownloads();
  render();
  window.setInterval(() => void refreshNotifications(), 120000);
})();
