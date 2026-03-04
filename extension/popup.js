// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const urlInput = $("#url-input");
const btnDownload = $("#btn-download");
const downloadsList = $("#downloads-list");
const noDownloads = $("#no-downloads");
const libraryList = $("#library-list");
const noFiles = $("#no-files");
const outputDirInput = $("#output-dir");
const serverPortInput = $("#server-port");
const btnSaveSettings = $("#btn-save-settings");
const settingsStatus = $("#settings-status");
const connectionStatus = $("#connection-status");
const playerTitle = $("#player-title");
const btnPlayPause = $("#btn-play-pause");
const btnPrev = $("#btn-prev");
const btnNext = $("#btn-next");
const seekBar = $("#seek-bar");
const timeCurrent = $("#time-current");
const timeTotal = $("#time-total");
const volumeBar = $("#volume-bar");
const iconPlay = $("#icon-play");
const iconPause = $("#icon-pause");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentFiles = [];
let currentTrackIndex = -1;
let isPlaying = false;
let activeDownloads = new Map();
let seekDragging = false;

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#panel-${tab.dataset.tab}`).classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ target: "background", ...msg }, resolve);
  });
}

function formatTime(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname.includes("youtube.com") ||
      u.hostname.includes("youtu.be") ||
      u.hostname.includes("music.youtube.com")
    );
  } catch {
    return false;
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

btnDownload.addEventListener("click", startDownload);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startDownload();
});

function startDownload() {
  const url = urlInput.value.trim();
  if (!url || !isYouTubeUrl(url)) {
    urlInput.style.borderColor = "#f44336";
    setTimeout(() => (urlInput.style.borderColor = ""), 1500);
    return;
  }

  const id = generateId();
  activeDownloads.set(id, { url, percent: 0, status: "starting", title: url });
  renderDownloads();
  urlInput.value = "";

  sendBg({ action: "download", url, id });
}

function renderDownloads() {
  if (activeDownloads.size === 0) {
    downloadsList.innerHTML = "";
    noDownloads.style.display = "";
    return;
  }

  noDownloads.style.display = "none";
  downloadsList.innerHTML = "";

  for (const [id, dl] of activeDownloads) {
    const div = document.createElement("div");
    const stateClass = dl.status === "complete" ? " complete" : dl.status === "error" ? " error" : "";
    div.className = `download-item${stateClass}`;
    div.innerHTML = `
      <div class="dl-title">${escapeHtml(dl.title)}</div>
      <div class="dl-progress-bar"><div class="dl-progress-fill" style="width:${dl.percent}%"></div></div>
      <div class="dl-status">${dl.status === "error" ? dl.message || "Error" : dl.status + (dl.percent ? ` — ${dl.percent}%` : "")}</div>
    `;
    downloadsList.appendChild(div);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

function renderLibrary() {
  if (currentFiles.length === 0) {
    libraryList.innerHTML = "";
    noFiles.style.display = "";
    return;
  }

  noFiles.style.display = "none";
  libraryList.innerHTML = "";

  currentFiles.forEach((file, idx) => {
    const div = document.createElement("div");
    div.className = `library-item${idx === currentTrackIndex ? " playing" : ""}`;
    div.innerHTML = `
      <div class="lib-play-icon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>
      </div>
      <div class="lib-info">
        <div class="lib-title">${escapeHtml(file.title || file.name)}</div>
        <div class="lib-meta">${formatSize(file.size)}${file.duration ? " · " + formatTime(file.duration) : ""}</div>
      </div>
    `;
    div.addEventListener("click", () => playTrack(idx));
    libraryList.appendChild(div);
  });
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function playTrack(index) {
  if (index < 0 || index >= currentFiles.length) return;
  currentTrackIndex = index;
  const file = currentFiles[index];
  isPlaying = true;

  sendBg({ action: "play", filename: file.name, title: file.title || file.name });
  updatePlayerUI();
  renderLibrary();
}

function togglePlayPause() {
  if (currentTrackIndex < 0) return;
  if (isPlaying) {
    sendBg({ action: "pause" });
    isPlaying = false;
  } else {
    sendBg({ action: "resume" });
    isPlaying = true;
  }
  updatePlayerUI();
}

function playNext() {
  if (currentFiles.length === 0) return;
  const next = (currentTrackIndex + 1) % currentFiles.length;
  playTrack(next);
}

function playPrev() {
  if (currentFiles.length === 0) return;
  const prev = (currentTrackIndex - 1 + currentFiles.length) % currentFiles.length;
  playTrack(prev);
}

function updatePlayerUI() {
  if (currentTrackIndex >= 0 && currentTrackIndex < currentFiles.length) {
    const file = currentFiles[currentTrackIndex];
    playerTitle.textContent = file.title || file.name;
    playerTitle.title = file.title || file.name;
  }

  iconPlay.style.display = isPlaying ? "none" : "";
  iconPause.style.display = isPlaying ? "" : "none";
  btnPlayPause.title = isPlaying ? "Pause" : "Play";
}

btnPlayPause.addEventListener("click", togglePlayPause);
btnNext.addEventListener("click", playNext);
btnPrev.addEventListener("click", playPrev);

// Seek bar
seekBar.addEventListener("mousedown", () => (seekDragging = true));
seekBar.addEventListener("mouseup", () => {
  seekDragging = false;
  sendBg({ action: "seek", time: parseFloat(seekBar.value) });
});
seekBar.addEventListener("change", () => {
  seekDragging = false;
  sendBg({ action: "seek", time: parseFloat(seekBar.value) });
});

// Volume
volumeBar.addEventListener("input", () => {
  sendBg({ action: "setVolume", volume: parseFloat(volumeBar.value) });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

btnSaveSettings.addEventListener("click", async () => {
  const outputDir = outputDirInput.value.trim();
  const port = parseInt(serverPortInput.value, 10);

  const msg = { action: "set_config" };
  if (outputDir) msg.outputDir = outputDir;
  if (port && port >= 1024 && port <= 65535) msg.port = port;

  await sendBg(msg);
  settingsStatus.textContent = "Settings saved!";
  settingsStatus.className = "settings-status success";
  setTimeout(() => {
    settingsStatus.textContent = "";
    settingsStatus.className = "settings-status";
  }, 2000);
});

// ---------------------------------------------------------------------------
// React to storage changes (reliable — works even when message relay fails)
// ---------------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.files) {
    currentFiles = changes.files.newValue || [];
    renderLibrary();

    // Mark any active downloads whose file appeared as complete
    for (const [id, dl] of activeDownloads) {
      if (dl.status === "converting" || dl.status === "downloading") {
        const found = currentFiles.some(
          (f) => f.name === dl.expectedFilename || f.title === dl.title
        );
        if (found) {
          dl.status = "complete";
          dl.percent = 100;
          renderDownloads();
          setTimeout(() => {
            activeDownloads.delete(id);
            renderDownloads();
          }, 3000);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Listen for messages from background (native relay, offscreen events)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source === "native") {
    handleNativeRelay(msg);
  }

  if (msg.target === "popup") {
    if (msg.event === "ended") {
      playNext();
    }
  }
});

function handleNativeRelay(msg) {
  if (msg.type === "progress") {
    const dl = activeDownloads.get(msg.id);
    if (dl) {
      dl.percent = msg.percent;
      dl.status = msg.status;
      renderDownloads();
    }
  }

  if (msg.type === "download_complete") {
    const dl = activeDownloads.get(msg.id);
    if (dl) {
      dl.percent = 100;
      dl.status = "complete";
      dl.title = msg.title || dl.title;
      renderDownloads();
      setTimeout(() => {
        activeDownloads.delete(msg.id);
        renderDownloads();
      }, 3000);
    }
    refreshFiles();
  }

  if (msg.type === "file_list") {
    currentFiles = msg.files || [];
    renderLibrary();
  }

  if (msg.type === "error" && msg.id) {
    const dl = activeDownloads.get(msg.id);
    if (dl) {
      dl.status = "error";
      dl.message = msg.message;
      renderDownloads();
    }
  }

  if (msg.type === "server_started") {
    connectionStatus.textContent = `Connected — port ${msg.port}`;
    connectionStatus.className = "status-badge connected";
  }

  if (msg.type === "pong") {
    connectionStatus.textContent = "Connected";
    connectionStatus.className = "status-badge connected";
  }
}

function refreshFiles() {
  sendBg({ action: "list_files" });
}

// ---------------------------------------------------------------------------
// Poll storage for playback state AND file list changes
// ---------------------------------------------------------------------------

let poller = null;
let lastFilesJson = "";

function startPolling() {
  if (poller) return;
  poller = setInterval(async () => {
    const data = await chrome.storage.local.get([
      "playbackTime", "playbackDuration", "isPlaying", "files",
    ]);

    // Playback time
    if (!seekDragging && data.playbackDuration) {
      seekBar.max = data.playbackDuration;
      seekBar.value = data.playbackTime || 0;
      timeCurrent.textContent = formatTime(data.playbackTime || 0);
      timeTotal.textContent = formatTime(data.playbackDuration);
    }
    if (typeof data.isPlaying === "boolean" && data.isPlaying !== isPlaying) {
      isPlaying = data.isPlaying;
      updatePlayerUI();
    }

    // File list — detect changes by comparing serialized snapshots
    const filesJson = JSON.stringify(data.files || []);
    if (filesJson !== lastFilesJson) {
      lastFilesJson = filesJson;
      const prevCount = currentFiles.length;
      currentFiles = data.files || [];
      renderLibrary();

      // If new files appeared, mark matching active downloads as complete
      if (currentFiles.length > prevCount) {
        for (const [id, dl] of activeDownloads) {
          if (dl.status !== "complete" && dl.status !== "error") {
            dl.status = "complete";
            dl.percent = 100;
            renderDownloads();
            setTimeout(() => {
              activeDownloads.delete(id);
              renderDownloads();
            }, 3000);
          }
        }
      }
    }
  }, 500);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  const state = await sendBg({ action: "getState" });

  if (state.outputDir) outputDirInput.value = state.outputDir;
  if (state.serverPort) serverPortInput.value = state.serverPort;
  if (typeof state.volume === "number") volumeBar.value = state.volume;

  currentFiles = state.files || [];
  lastFilesJson = JSON.stringify(currentFiles);
  renderLibrary();

  if (state.currentTrack) {
    const idx = currentFiles.findIndex((f) => f.name === state.currentTrack.filename);
    if (idx >= 0) {
      currentTrackIndex = idx;
      playerTitle.textContent = state.currentTrack.title || state.currentTrack.filename;
      playerTitle.title = state.currentTrack.title || state.currentTrack.filename;
    }
  }

  if (state.isPlaying) {
    isPlaying = true;
  }
  updatePlayerUI();

  // Ping native host to check connection
  sendBg({ action: "ping_native" });

  // Refresh file list
  refreshFiles();

  startPolling();
}

init();
