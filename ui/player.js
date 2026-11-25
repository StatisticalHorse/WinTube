/* WinTube player. Plays the stream URLs the Rust side resolves (yt-dlp, with
   YouTube's muxed format as a fallback): video and audio are separate media
   elements that are kept in sync, so there is no iframe and no borrowed chrome. */

(function () {
  const ICON = (name) => `<svg class="icon"><use href="#i-${name}"></use></svg>`;

  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  const prefs = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(`wintube-player-${key}`);
        return value === null ? fallback : JSON.parse(value);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`wintube-player-${key}`, JSON.stringify(value));
      } catch {
        /* storage disabled */
      }
    },
  };

  function fmt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  class Player {
    constructor(container, options) {
      this.container = container;
      this.options = options || {};
      this.shorts = options.variant === "shorts";
      this.loop = Boolean(options.loop);
      this.live = Boolean(options.live);
      this.videoFormats = (options.formats || []).filter(
        (format) => format.kind === "video" || format.kind === "live",
      );
      this.audioFormats = (options.formats || []).filter((format) => format.kind === "audio");
      this.muxed = (options.formats || []).find((format) => format.kind === "muxed");
      this.speed = Number(prefs.get("speed", 1));
      this.quality = prefs.get("quality", "auto");
      if (this.quality !== "auto" && Number.isNaN(Number(this.quality))) this.quality = "auto";
      this.captions = prefs.get("captions", false);
      this.volume = Number(prefs.get("volume", 100));
      this.muted = prefs.get("muted", false);
      this.playing = false;
      this.duration = 0;
      this.dragging = false;
      this.hideTimer = null;
      this.ticker = null;
      this.stallTimer = null;
      this.startTimer = null;
      this.audioNudge = 0;
      this.startAt = Number(options.startAt) || 0;
      this.startApplied = false;
      this.finished = false;
      this.lastReport = 0;
      this.separate = false;
      this.subtitleUrl = null;
      this.build();
      this.bind();
      this.mount();
    }

    build() {
      this.container.classList.add("wt-player");
      if (this.live) this.container.classList.add("live");
      if (this.shorts) {
        this.buildShorts();
        return;
      }
      this.container.innerHTML = `
        <div class="wt-player-stage">
          <video class="wt-video" playsinline preload="auto"></video>
          <audio class="wt-audio" preload="auto"></audio>
          <button class="wt-big-play" type="button" aria-label="Play">${ICON("play")}</button>
          <div class="wt-spinner" aria-hidden="true"></div>
          <div class="wt-player-top">
            <div class="wt-player-title"></div>
          </div>
          <div class="wt-player-bottom">
            <div class="wt-progress" tabindex="0" role="slider" aria-label="Seek">
              <div class="wt-progress-buffer"></div>
              <div class="wt-progress-played"></div>
              <div class="wt-progress-thumb"></div>
              <div class="wt-progress-tip">0:00</div>
            </div>
            <div class="wt-controls">
              <button type="button" data-act="toggle" aria-label="Play">${ICON("play")}</button>
              <button type="button" data-act="next" aria-label="Next video">${ICON("next")}</button>
              <div class="wt-volume">
                <button type="button" data-act="mute" aria-label="Mute">${ICON("volume")}</button>
                <input type="range" min="0" max="100" value="${this.volume}" class="wt-volume-slider" aria-label="Volume" />
              </div>
              <div class="wt-time">0:00 / 0:00</div>
              <span class="wt-live-badge hidden">LIVE</span>
              <div class="wt-spacer"></div>
              <button type="button" data-act="cc" class="wt-cc" aria-label="Subtitles">${ICON("cc")}</button>
              <button type="button" data-act="settings" aria-label="Settings">${ICON("settings")}</button>
              <button type="button" data-act="theater" aria-label="Theater mode">${ICON("theater")}</button>
              <button type="button" data-act="fullscreen" aria-label="Full screen">${ICON("fullscreen")}</button>
            </div>
          </div>
          <div class="wt-settings hidden">
            <div class="wt-menu" data-page="main">
              <button type="button" data-open="speed"><span>Playback speed</span><span class="wt-value">${this.speed}x</span></button>
              <button type="button" data-open="quality"><span>Quality</span><span class="wt-value">${this.qualityLabel()}</span></button>
              <button type="button" data-act="cc"><span>Subtitles</span><span class="wt-value" data-cc-state>${this.captions ? "On" : "Off"}</span></button>
            </div>
            <div class="wt-menu hidden" data-page="speed">
              <button type="button" class="wt-back" data-back>${ICON("chevron-left")}<span>Playback speed</span></button>
              ${SPEEDS.map(
                (value) =>
                  `<button type="button" data-speed="${value}"><span>${value}x</span>${
                    value === this.speed ? ICON("check") : ""
                  }</button>`,
              ).join("")}
            </div>
            <div class="wt-menu hidden" data-page="quality">
              <button type="button" class="wt-back" data-back>${ICON("chevron-left")}<span>Quality</span></button>
              ${this.qualityOptions()
                .map(
                  (option) =>
                    `<button type="button" data-quality="${option.value}"><span>${option.label}</span>${
                      option.value === this.quality ? ICON("check") : ""
                    }</button>`,
                )
                .join("")}
            </div>
          </div>
          <div class="wt-error hidden">
            <p class="wt-error-text"></p>
            <button type="button" data-act="retry">Retry</button>
          </div>
        </div>`;

      this.stage = this.container.querySelector(".wt-player-stage");
      this.video = this.container.querySelector(".wt-video");
      this.audio = this.container.querySelector(".wt-audio");
      this.bigPlay = this.container.querySelector(".wt-big-play");
      this.progress = this.container.querySelector(".wt-progress");
      this.played = this.container.querySelector(".wt-progress-played");
      this.buffer = this.container.querySelector(".wt-progress-buffer");
      this.thumb = this.container.querySelector(".wt-progress-thumb");
      this.tip = this.container.querySelector(".wt-progress-tip");
      this.toggleButton = this.container.querySelector('[data-act="toggle"]');
      this.timeLabel = this.container.querySelector(".wt-time");
      this.liveBadge = this.container.querySelector(".wt-live-badge");
      if (this.live) {
        this.timeLabel?.classList.add("hidden");
        this.liveBadge?.classList.remove("hidden");
      }
      this.volumeSlider = this.container.querySelector(".wt-volume-slider");
      this.muteButton = this.container.querySelector('[data-act="mute"]');
      this.titleLabel = this.container.querySelector(".wt-player-title");
      this.settings = this.container.querySelector(".wt-settings");
      this.ccState = this.container.querySelector("[data-cc-state]");
      this.errorBox = this.container.querySelector(".wt-error");
      this.errorText = this.container.querySelector(".wt-error-text");
      if (this.options.title) this.titleLabel.textContent = this.options.title;
      this.updateVolumeIcon();
    }

    buildShorts() {
      this.container.classList.add("wt-shorts-player");
      this.container.innerHTML = `
        <div class="wt-player-stage wt-shorts-stage">
          <video class="wt-video" playsinline preload="auto"></video>
          <audio class="wt-audio" preload="auto"></audio>
          <button class="wt-big-play" type="button" aria-label="Play">${ICON("play")}</button>
          <div class="wt-spinner" aria-hidden="true"></div>
          <button class="wt-shorts-mute" type="button" data-act="mute" aria-label="Mute">${ICON("volume")}</button>
          <div class="wt-shorts-progress" tabindex="0" role="slider" aria-label="Seek">
            <div class="wt-progress-buffer"></div>
            <div class="wt-progress-played"></div>
          </div>
          <div class="wt-error hidden">
            <p class="wt-error-text"></p>
            <button type="button" data-act="retry">Retry</button>
          </div>
        </div>`;

      this.stage = this.container.querySelector(".wt-player-stage");
      this.video = this.container.querySelector(".wt-video");
      this.audio = this.container.querySelector(".wt-audio");
      this.bigPlay = this.container.querySelector(".wt-big-play");
      this.progress = this.container.querySelector(".wt-shorts-progress");
      this.played = this.container.querySelector(".wt-progress-played");
      this.buffer = this.container.querySelector(".wt-progress-buffer");
      this.thumb = null;
      this.tip = null;
      this.toggleButton = null;
      this.timeLabel = null;
      this.volumeSlider = null;
      this.muteButton = this.container.querySelector('[data-act="mute"]');
      this.titleLabel = null;
      this.settings = null;
      this.ccState = null;
      this.errorBox = this.container.querySelector(".wt-error");
      this.errorText = this.container.querySelector(".wt-error-text");
      this.updateVolumeIcon();
    }

    qualityOptions() {
      if (!this.videoFormats.length) {
        return [{ value: "auto", label: "Auto" }];
      }
      const heights = [...new Set(this.videoFormats.map((format) => format.height))]
        .filter((height) => height > 0)
        .sort((a, b) => b - a);
      return [
        { value: "auto", label: "Auto" },
        ...heights.map((height) => ({ value: String(height), label: `${height}p` })),
      ];
    }

    qualityLabel() {
      if (this.quality === "auto") return "Auto";
      return `${this.quality}p`;
    }

    pickVideo() {
      if (!this.videoFormats.length) return null;
      if (this.quality === "auto") {
        // 720p keeps the download modest; the bitrate jump to 1080p is what
        // makes the first minute stutter on this class of machine.
        const wanted = 720;
        const under = this.videoFormats
          .filter((format) => format.height <= wanted)
          .sort((a, b) => b.height - a.height);
        return under[0] || this.videoFormats[0];
      }
      const height = Number(this.quality);
      return (
        this.videoFormats.find((format) => format.height === height) ||
        this.videoFormats.sort((a, b) => b.height - a.height)[0]
      );
    }

    pickAudio() {
      return this.audioFormats[0] || null;
    }

    mount() {
      const video = this.pickVideo();
      const audio = this.pickAudio();
      this.separate = Boolean(video && audio);

      if (this.separate) {
        this.activeVideoUrl = video.url;
        this.video.src = video.url;
        this.video.muted = true;
        this.audio.src = audio.url;
        this.audio.volume = this.volume / 100;
        this.audio.muted = this.muted;
      } else if (this.muxed) {
        this.activeVideoUrl = this.muxed.url;
        this.video.src = this.muxed.url;
        this.video.volume = this.volume / 100;
        this.video.muted = this.muted;
      } else if (video) {
        this.activeVideoUrl = video.url;
        this.video.src = video.url;
        this.video.volume = this.volume / 100;
        this.video.muted = this.muted;
      } else {
        this.fail("No playable stream was returned for this video.");
        return;
      }

      if (this.options.subtitle?.text) {
        this.subtitleUrl = URL.createObjectURL(
          new Blob([this.options.subtitle.text], { type: "text/vtt" }),
        );
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = this.options.subtitle.lang || "English";
        track.srclang = (this.options.subtitle.lang || "en").slice(0, 2);
        track.src = this.subtitleUrl;
        this.video.append(track);
      }

      this.video.addEventListener("loadedmetadata", () => this.onLoaded());
      this.audio.addEventListener("loadedmetadata", () => this.applyStart());
      this.video.addEventListener("canplay", () => this.stage.classList.remove("buffering"));
      this.video.addEventListener("waiting", () => {
        this.stage.classList.add("buffering");
        // Only stop the audio once the stall is real, not on a momentary dip.
        window.clearTimeout(this.stallTimer);
        this.stallTimer = window.setTimeout(() => {
          if (this.separate) this.audio.pause();
        }, 300);
      });
      this.video.addEventListener("playing", () => {
        window.clearTimeout(this.stallTimer);
        this.playing = true;
        this.stage.classList.remove("buffering", "errored");
        this.stage.classList.add("playing");
        this.updateToggle();
        this.scheduleHide();
        if (this.separate && this.audio.paused && !this.audio.ended) {
          if (Math.abs(this.audio.currentTime - this.video.currentTime) > 0.4) {
            this.audio.currentTime = this.video.currentTime;
          }
          void this.audio.play().catch(() => {});
        }
      });
      this.video.addEventListener("pause", () => {
        this.playing = false;
        this.stage.classList.remove("playing");
        this.stage.classList.add("active");
        this.updateToggle();
        this.syncAudio("pause");
        this.saveProgress(true);
      });
      this.video.addEventListener("play", () => {
        if (this.separate) this.audio.playbackRate = this.speed;
        this.syncAudio("play");
      });
      this.video.addEventListener("ended", () => {
        this.finished = true;
        this.options.onFinished?.();
        if (this.loop) {
          this.seekTo(0);
          void this.video.play().catch(() => {});
          return;
        }
        this.playing = false;
        this.updateToggle();
        this.showControls();
        this.options.onEnded?.();
      });
      this.video.addEventListener("error", () => {
        this.fail(
          this.live
            ? "This live stream has ended or is unavailable."
            : "This stream could not be played. YouTube may have expired the link.",
        );
      });

      this.ticker = window.setInterval(() => this.tick(), 250);
      this.leaveHandler = () => this.saveProgress(true);
      this.visibilityHandler = () => {
        if (document.visibilityState === "hidden") this.saveProgress(true);
      };
      window.addEventListener("beforeunload", this.leaveHandler);
      document.addEventListener("visibilitychange", this.visibilityHandler);
      this.applySpeed(this.speed);
      this.applyQuality(this.quality);
      this.setVolume(this.volume, { silent: true });
      this.enableCaptions(this.captions, { silent: true });
      this.tick();
      // Shorts are small and start instantly. A full video needs a runway:
      // Chromium will happily start on one decoded frame and then stutter
      // while it catches up, which is the start-of-video buffering loop.
      this.stage.classList.add("buffering");
      const start = () => {
        void this.video.play().catch(() => {
          this.playing = false;
          this.updateToggle();
          this.showControls();
        });
      };
      if (this.shorts || this.live) {
        if (this.video.readyState >= 3) start();
        else this.video.addEventListener("canplay", start, { once: true });
      } else {
        const gateStart = Date.now();
        const tryStart = () => {
          if (!this.video.isConnected) return;
          const audioReady = !this.separate || this.audio.readyState >= 2;
          if (
            this.video.readyState >= 3 &&
            audioReady &&
            (this.bufferedAhead() >= 4 || Date.now() - gateStart > 8000)
          ) {
            start();
            return;
          }
          if (Date.now() - gateStart > 12000) {
            start();
            return;
          }
          this.startTimer = window.setTimeout(tryStart, 200);
        };
        tryStart();
      }
    }

    bufferedAhead() {
      try {
        const ranges = this.video.buffered;
        if (!ranges.length) return 0;
        return ranges.end(ranges.length - 1) - (this.video.currentTime || 0);
      } catch {
        return 0;
      }
    }

    onLoaded() {
      if (!this.live) {
        this.duration = Number.isFinite(this.video.duration)
          ? this.video.duration
          : this.options.duration || 0;
      }
      this.video.playbackRate = this.speed;
      if (this.audio) this.audio.playbackRate = this.speed;
      this.applyStart();
      this.options.onReady?.(this);
      this.tick();
    }

    /// Seeks to the point where this video was left last time. It runs on the
    /// first metadata for either track, so the video and its audio land on the
    /// same frame before playback starts.
    applyStart() {
      if (this.startApplied || this.startAt <= 0) return;
      if (this.video.readyState < 1) return;
      this.startApplied = true;
      const limit = this.duration > 1 ? this.duration - 1 : this.startAt;
      const target = Math.max(0, Math.min(this.startAt, limit));
      this.video.currentTime = target;
      if (this.separate && this.audio.readyState >= 1) this.audio.currentTime = target;
    }

    /// Reports the stop point while playing (at most every 5 seconds) and on
    /// every real stop: pause, seek, page change and window close.
    saveProgress(force = false) {
      if (this.shorts || this.live || this.finished || !this.options.onProgress) return;
      const duration = this.duration;
      const seconds = this.video.currentTime || 0;
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (seconds < 5) {
        // Left at the very beginning: forget the old stop point instead of
        // resuming ahead of where the viewer actually is.
        if (force && this.lastReport > 0) {
          this.lastReport = 0;
          this.options.onFinished?.();
        }
        return;
      }
      if (seconds >= duration - 10) {
        this.finished = true;
        this.options.onFinished?.();
        return;
      }
      const now = Date.now();
      if (!force && now - this.lastReport < 5000) return;
      this.lastReport = now;
      this.options.onProgress(seconds, duration);
    }

    syncAudio(action) {
      if (!this.separate) return;
      if (action === "play") {
        if (Math.abs(this.audio.currentTime - this.video.currentTime) > 0.4) {
          this.audio.currentTime = this.video.currentTime;
        }
        void this.audio.play().catch(() => {
          // Autoplay with sound was refused. Stop the muted picture rather than
          // playing silently; the next click will start both tracks.
          this.audioBlocked = true;
          this.video.pause();
        });
      } else if (action === "pause") {
        this.audio.pause();
      }
    }

    tick() {
      if (this.live) {
        if (!this.dragging) {
          this.played.style.width = "100%";
          this.buffer.style.width = "100%";
        }
        return;
      }
      this.duration = Number.isFinite(this.video.duration)
        ? this.video.duration
        : this.duration || this.options.duration || 0;
      const current = this.video.currentTime || 0;
      if (!this.video.paused && this.separate && this.audio.readyState >= 2) {
        const drift = this.audio.currentTime - current;
        if (Math.abs(drift) > 0.35) {
          this.audio.currentTime = current;
          this.audioNudge = 0;
        } else if (Math.abs(drift) > 0.1) {
          this.audioNudge = drift > 0 ? -0.02 : 0.02;
        } else if (Math.abs(drift) < 0.03) {
          this.audioNudge = 0;
        }
        const rate = this.speed * (1 + this.audioNudge);
        if (this.audio.playbackRate !== rate) {
          this.audio.playbackRate = rate;
        }
      }
      if (!this.video.paused) this.saveProgress(false);
      if (!this.dragging) {
        const progress = this.duration ? (current / this.duration) * 100 : 0;
        this.played.style.width = `${progress}%`;
        if (this.thumb) this.thumb.style.left = `${progress}%`;
        const buffered = this.video.buffered;
        const end = buffered.length ? buffered.end(buffered.length - 1) : 0;
        this.buffer.style.width = `${this.duration ? Math.min(100, (end / this.duration) * 100) : 0}%`;
        this.updateTime(current);
      }
    }

    updateTime(current = this.video.currentTime || 0) {
      if (this.timeLabel) {
        this.timeLabel.textContent = `${fmt(current)} / ${fmt(this.duration)}`;
      }
      if (!this.progress) return;
      this.progress.setAttribute("aria-valuenow", String(Math.round(current)));
      this.progress.setAttribute("aria-valuemax", String(Math.round(this.duration)));
    }

    updateToggle() {
      const paused = this.video.paused;
      if (this.toggleButton) {
        this.toggleButton.innerHTML = ICON(paused ? "play" : "pause");
        this.toggleButton.setAttribute("aria-label", paused ? "Play" : "Pause");
      }
      this.bigPlay.classList.toggle("hidden", !paused);
    }

    scheduleHide() {
      if (this.shorts) return;
      window.clearTimeout(this.hideTimer);
      this.stage.classList.add("active");
      this.hideTimer = window.setTimeout(() => {
        if (this.playing && !this.settings?.matches(":hover")) {
          this.stage.classList.remove("active");
        }
      }, 2800);
    }

    showControls() {
      if (this.shorts) return;
      window.clearTimeout(this.hideTimer);
      this.stage.classList.add("active");
    }

    fail(message) {
      this.stage.classList.remove("playing", "buffering");
      this.stage.classList.add("errored");
      this.errorText.textContent = message;
      this.errorBox.classList.remove("hidden");
    }

    bind() {
      const act = (event) => {
        const button = event.target.closest("[data-act]");
        if (!button || !this.container.contains(button)) return;
        event.preventDefault();
        event.stopPropagation();
        const action = button.getAttribute("data-act");
        if (action === "toggle") this.toggle();
        if (action === "next") this.options.onNext?.();
        if (action === "mute") this.toggleMute();
        if (action === "cc") this.enableCaptions(!this.captions);
        if (action === "settings") this.settings?.classList.toggle("hidden");
        if (action === "theater") this.options.onTheater?.();
        if (action === "fullscreen") this.toggleFullscreen();
        if (action === "retry") this.options.onRetry?.();
      };

      this.container.addEventListener("click", (event) => {
        const target = event.target;
        if (target.closest("[data-act]")) {
          act(event);
          return;
        }
        const open = target.closest("[data-open]");
        if (open) {
          this.container.querySelectorAll(".wt-menu").forEach((menu) => menu.classList.add("hidden"));
          this.container
            .querySelector(`[data-page="${open.getAttribute("data-open")}"]`)
            ?.classList.remove("hidden");
          return;
        }
        if (target.closest("[data-back]")) {
          this.container.querySelectorAll(".wt-menu").forEach((menu) => menu.classList.add("hidden"));
          this.container.querySelector('[data-page="main"]')?.classList.remove("hidden");
          return;
        }
        const speed = target.closest("[data-speed]");
        if (speed) {
          this.applySpeed(Number(speed.getAttribute("data-speed")));
          return;
        }
        const quality = target.closest("[data-quality]");
        if (quality) {
          this.applyQuality(quality.getAttribute("data-quality"));
          return;
        }
        if (this.settings) {
          if (this.settings.contains(target)) return;
          this.settings.classList.add("hidden");
        }
        // A click on the picture toggles playback, like YouTube.
        if (!this.stage.classList.contains("errored")) this.toggle();
      });

      this.bigPlay.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggle();
      });

      if (!this.shorts) {
        this.stage.addEventListener("mousemove", () => this.scheduleHide());
        this.stage.addEventListener("mouseleave", () => {
          if (this.playing) this.stage.classList.remove("active");
        });
        this.container.addEventListener("dblclick", () => this.toggleFullscreen());
      }

      this.progress.addEventListener("pointerdown", (event) => this.startSeek(event));
      this.progress.addEventListener("pointermove", (event) => this.moveSeek(event));
      this.progress.addEventListener("pointerup", (event) => this.endSeek(event));
      this.progress.addEventListener("pointerleave", () => this.tip?.classList.remove("visible"));

      if (this.volumeSlider) {
        this.volumeSlider.addEventListener("input", () => {
          this.setVolume(Number(this.volumeSlider.value));
        });
      }

      this.keyHandler = (event) => this.onKey(event);
      document.addEventListener("keydown", this.keyHandler);
      this.fullscreenHandler = () => {
        const active = document.fullscreenElement === this.container;
        this.container.classList.toggle("wt-fullscreen", active);
        const button = this.container.querySelector('[data-act="fullscreen"]');
        if (button) button.innerHTML = ICON(active ? "fullscreen-exit" : "fullscreen");
      };
      document.addEventListener("fullscreenchange", this.fullscreenHandler);
    }

    onKey(event) {
      const page = this.shorts ? "shorts-page" : "watch-page";
      if (!document.body.classList.contains(page)) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const key = event.key.toLowerCase();
      if (key === " " || key === "k") {
        event.preventDefault();
        this.toggle();
      } else if (key === "m") {
        this.toggleMute();
      } else if (this.shorts) {
        return;
      } else if (key === "j") {
        this.seekBy(-10);
      } else if (key === "l") {
        this.seekBy(10);
      } else if (key === "arrowleft") {
        this.seekBy(-5);
      } else if (key === "arrowright") {
        this.seekBy(5);
      } else if (key === "arrowup") {
        event.preventDefault();
        this.setVolume(this.volume + 5);
      } else if (key === "arrowdown") {
        event.preventDefault();
        this.setVolume(this.volume - 5);
      } else if (key === "f") {
        this.toggleFullscreen();
      } else if (key === "t") {
        this.options.onTheater?.();
      } else if (key === "c") {
        this.enableCaptions(!this.captions);
      } else if (/^[0-9]$/.test(key)) {
        this.seekTo((this.duration || 0) * (Number(key) / 10));
      } else if (key === ">" || key === ".") {
        this.applySpeed(Math.min(2, this.speed + 0.25));
      } else if (key === "<" || key === ",") {
        this.applySpeed(Math.max(0.25, this.speed - 0.25));
      }
    }

    toggle() {
      if (this.video.paused) {
        this.audioBlocked = false;
        if (this.separate) {
          this.audio.currentTime = this.video.currentTime;
          void this.audio.play().catch(() => {});
        }
        void this.video.play().catch(() => {});
      } else {
        this.video.pause();
      }
    }

    seekTo(seconds) {
      if (this.live) return;
      const target = Math.max(0, Math.min(this.duration || 0, seconds));
      this.video.currentTime = target;
      if (this.separate) this.audio.currentTime = target;
      this.tick();
      this.saveProgress(true);
    }

    seekBy(delta) {
      this.seekTo((this.video.currentTime || 0) + delta);
    }

    seekFraction(event) {
      const rect = this.progress.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      return ratio * (this.duration || 0);
    }

    startSeek(event) {
      if (this.live) return;
      this.dragging = true;
      this.progress.setPointerCapture(event.pointerId);
      this.seekPreview(event);
    }

    moveSeek(event) {
      if (this.live) return;
      if (this.dragging) this.seekPreview(event);
      if (!this.tip) return;
      const seconds = this.seekFraction(event);
      const rect = this.progress.getBoundingClientRect();
      const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
      this.tip.style.left = `${x}px`;
      this.tip.textContent = fmt(seconds);
      this.tip.classList.add("visible");
    }

    seekPreview(event) {
      const seconds = this.seekFraction(event);
      const progress = this.duration ? (seconds / this.duration) * 100 : 0;
      this.played.style.width = `${progress}%`;
      if (this.thumb) this.thumb.style.left = `${progress}%`;
      if (this.timeLabel) this.timeLabel.textContent = `${fmt(seconds)} / ${fmt(this.duration)}`;
    }

    endSeek(event) {
      if (!this.dragging) return;
      this.dragging = false;
      this.seekTo(this.seekFraction(event));
    }

    applySpeed(value) {
      this.speed = value;
      prefs.set("speed", value);
      this.video.playbackRate = value;
      if (this.audio) this.audio.playbackRate = value;
      const label = this.container.querySelector('[data-page="main"] [data-open="speed"] .wt-value');
      if (label) label.textContent = `${value}x`;
      this.container.querySelectorAll("[data-speed]").forEach((button) => {
        const active = Number(button.getAttribute("data-speed")) === value;
        button.querySelector(".icon")?.remove();
        if (active) button.insertAdjacentHTML("beforeend", ICON("check"));
      });
    }

    applyQuality(value) {
      this.quality = value;
      prefs.set("quality", value);
      const label = this.container.querySelector('[data-page="main"] [data-open="quality"] .wt-value');
      if (label) label.textContent = this.qualityLabel();
      this.container.querySelectorAll("[data-quality]").forEach((button) => {
        const active = button.getAttribute("data-quality") === value;
        button.querySelector(".icon")?.remove();
        if (active) button.insertAdjacentHTML("beforeend", ICON("check"));
      });

      if (!this.videoFormats.length || !this.activeVideoUrl) return;
      const format = this.pickVideo();
      if (!format || this.activeVideoUrl === format.url) return;

      // A live stream is always at the live edge, so there is no position to
      // restore across a quality switch: just reopen the new rendition.
      if (this.live) {
        this.activeVideoUrl = format.url;
        this.stage.classList.add("buffering");
        this.video.src = format.url;
        this.video.load();
        this.video.addEventListener(
          "loadedmetadata",
          () => void this.video.play().catch(() => {}),
          { once: true },
        );
        return;
      }

      const time = this.video.currentTime;
      const wasPlaying = !this.video.paused;
      this.stage.classList.add("buffering");
      if (this.separate) this.audio.pause();
      this.activeVideoUrl = format.url;
      this.video.src = format.url;
      this.video.load();
      this.video.addEventListener(
        "loadedmetadata",
        () => {
          this.video.currentTime = time;
          if (this.separate) {
            this.audio.currentTime = time;
            if (wasPlaying) void this.audio.play().catch(() => {});
          }
          if (wasPlaying) void this.video.play().catch(() => {});
          this.stage.classList.remove("buffering");
        },
        { once: true },
      );
    }

    enableCaptions(on, options = {}) {
      this.captions = on;
      prefs.set("captions", on);
      const tracks = this.video.textTracks;
      if (tracks.length) {
        for (const track of tracks) track.mode = on ? "showing" : "disabled";
      } else if (on && !options.silent && !this.subtitleUrl) {
        this.options.onCaptionNotice?.();
      }
      this.container.querySelector('[data-act="cc"]')?.classList.toggle("wt-on", on);
      if (this.ccState) this.ccState.textContent = on ? "On" : "Off";
    }

    toggleMute() {
      this.muted = !this.muted;
      prefs.set("muted", this.muted);
      this.applyMuted();
      this.updateVolumeIcon();
    }

    applyMuted() {
      if (this.separate) {
        this.audio.muted = this.muted;
      } else {
        this.video.muted = this.muted;
      }
    }

    setVolume(value, options = {}) {
      this.volume = Math.max(0, Math.min(100, Math.round(value)));
      if (!options.silent) prefs.set("volume", this.volume);
      if (this.volumeSlider) this.volumeSlider.value = String(this.volume);
      const level = this.volume / 100;
      if (this.separate) {
        this.audio.volume = level;
        if (this.volume > 0) this.audio.muted = this.muted;
      } else {
        this.video.volume = level;
        if (this.volume > 0) this.video.muted = this.muted;
      }
      if (this.volume === 0) {
        this.muted = true;
        this.applyMuted();
        if (!options.silent) prefs.set("muted", true);
      }
      this.updateVolumeIcon();
    }

    updateVolumeIcon() {
      const level =
        this.muted || this.volume === 0 ? "mute" : this.volume < 40 ? "volume-low" : "volume";
      this.muteButton.innerHTML = ICON(level);
      this.muteButton.setAttribute("aria-label", this.muted ? "Unmute" : "Mute");
      if (this.volumeSlider) this.volumeSlider.value = String(this.volume);
    }

    toggleFullscreen() {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void this.container.requestFullscreen?.();
      }
    }

    destroy() {
      this.saveProgress(true);
      window.clearInterval(this.ticker);
      window.clearTimeout(this.hideTimer);
      window.clearTimeout(this.stallTimer);
      window.clearTimeout(this.startTimer);
      window.removeEventListener("beforeunload", this.leaveHandler);
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      document.removeEventListener("keydown", this.keyHandler);
      document.removeEventListener("fullscreenchange", this.fullscreenHandler);
      try {
        this.video.pause();
        this.video.removeAttribute("src");
        this.video.load();
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
      } catch {
        /* already gone */
      }
      if (this.subtitleUrl) URL.revokeObjectURL(this.subtitleUrl);
      this.container.innerHTML = "";
    }
  }

  window.WinTubePlayer = Player;
  window.WinTubePlayerFmt = fmt;
})();
