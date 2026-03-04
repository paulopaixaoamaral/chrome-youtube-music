const NATIVE_HOST = "com.ytmusic.host";

let nativePort = null;
let serverBaseUrl = "http://127.0.0.1:18932";

// ---------------------------------------------------------------------------
// Native messaging
// ---------------------------------------------------------------------------

function connectNative() {
  if (nativePort) return nativePort;

  console.log("[YTMusic] Connecting to native host:", NATIVE_HOST);

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    console.error("[YTMusic] connectNative() threw:", err);
    nativePort = null;
    return null;
  }

  nativePort.onMessage.addListener((msg) => {
    console.log("[YTMusic] Native message received:", msg.type || msg);
    handleNativeMessage(msg);
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    console.error("[YTMusic] Native host disconnected:", err?.message || "no error info");
    nativePort = null;
  });

  return nativePort;
}

function sendNative(msg) {
  const port = connectNative();
  if (port) {
    console.log("[YTMusic] Sending to native:", msg.action);
    port.postMessage(msg);
  } else {
    console.error("[YTMusic] Cannot send — native port is null");
  }
}

async function handleNativeMessage(msg) {
  if (msg.type === "server_started") {
    serverBaseUrl = msg.baseUrl;
    await chrome.storage.local.set({ serverBaseUrl: msg.baseUrl, serverPort: msg.port });
  }

  if (msg.type === "download_complete") {
    const { files = [] } = await chrome.storage.local.get("files");
    const newFile = {
      name: msg.filename,
      title: msg.title,
      duration: msg.duration,
      size: msg.size,
    };
    const updated = [newFile, ...files.filter((f) => f.name !== msg.filename)];
    await chrome.storage.local.set({ files: updated });

    // Also request a fresh file listing from native host
    const { outputDir } = await chrome.storage.local.get("outputDir");
    sendNative({ action: "list_files", outputDir: outputDir || "~/Music/YouTubeMusic" });
  }

  if (msg.type === "file_list") {
    await chrome.storage.local.set({ files: msg.files });
  }

  if (msg.type === "config_saved") {
    serverBaseUrl = msg.baseUrl;
    await chrome.storage.local.set({
      serverBaseUrl: msg.baseUrl,
      outputDir: msg.config.output_dir,
      serverPort: msg.config.server_port,
    });
  }

  // Relay all native messages to any listening popup
  chrome.runtime.sendMessage({ source: "native", ...msg }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Offscreen document management
// ---------------------------------------------------------------------------

let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (contexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Persistent audio player for downloaded music",
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

// ---------------------------------------------------------------------------
// Message routing (popup <-> background <-> offscreen / native)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target === "background") {
    handleBackgroundMessage(msg, sendResponse);
    return true; // async response
  }

  if (msg.target === "popup" || msg.target === "offscreen") {
    // pass through
    return false;
  }

  return false;
});

async function handleBackgroundMessage(msg, sendResponse) {
  try {
    switch (msg.action) {
      case "download": {
        const { outputDir } = await chrome.storage.local.get("outputDir");
        sendNative({
          action: "download",
          url: msg.url,
          id: msg.id,
          outputDir: outputDir || "~/Music/YouTubeMusic",
        });
        sendResponse({ ok: true });
        break;
      }

      case "list_files": {
        const { outputDir } = await chrome.storage.local.get("outputDir");
        sendNative({
          action: "list_files",
          outputDir: outputDir || "~/Music/YouTubeMusic",
        });
        sendResponse({ ok: true });
        break;
      }

      case "set_config": {
        sendNative({
          action: "set_config",
          outputDir: msg.outputDir,
          port: msg.port,
        });
        if (msg.outputDir) {
          await chrome.storage.local.set({ outputDir: msg.outputDir });
        }
        if (msg.port) {
          await chrome.storage.local.set({ serverPort: msg.port });
        }
        sendResponse({ ok: true });
        break;
      }

      case "play": {
        await ensureOffscreen();
        const url = `${serverBaseUrl}/${encodeURIComponent(msg.filename)}`;
        chrome.runtime.sendMessage({
          target: "offscreen",
          action: "play",
          url,
          filename: msg.filename,
          title: msg.title,
        });
        await chrome.storage.local.set({
          currentTrack: {
            filename: msg.filename,
            title: msg.title || msg.filename,
          },
          isPlaying: true,
        });
        sendResponse({ ok: true });
        break;
      }

      case "pause": {
        chrome.runtime.sendMessage({ target: "offscreen", action: "pause" });
        await chrome.storage.local.set({ isPlaying: false });
        sendResponse({ ok: true });
        break;
      }

      case "resume": {
        await ensureOffscreen();
        chrome.runtime.sendMessage({ target: "offscreen", action: "resume" });
        await chrome.storage.local.set({ isPlaying: true });
        sendResponse({ ok: true });
        break;
      }

      case "seek": {
        chrome.runtime.sendMessage({ target: "offscreen", action: "seek", time: msg.time });
        sendResponse({ ok: true });
        break;
      }

      case "setVolume": {
        chrome.runtime.sendMessage({ target: "offscreen", action: "setVolume", volume: msg.volume });
        await chrome.storage.local.set({ volume: msg.volume });
        sendResponse({ ok: true });
        break;
      }

      case "getState": {
        const state = await chrome.storage.local.get([
          "currentTrack", "isPlaying", "volume", "files",
          "serverBaseUrl", "outputDir", "serverPort",
        ]);
        sendResponse(state);
        break;
      }

      case "ping_native": {
        sendNative({ action: "ping" });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ error: "Unknown action" });
    }
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Handle playback state updates from offscreen document
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source === "offscreen") {
    if (msg.event === "timeupdate") {
      chrome.storage.local.set({ playbackTime: msg.currentTime, playbackDuration: msg.duration });
    } else if (msg.event === "ended") {
      chrome.storage.local.set({ isPlaying: false, playbackTime: 0 });
      chrome.runtime.sendMessage({ target: "popup", event: "ended" }).catch(() => {});
    } else if (msg.event === "error") {
      chrome.runtime.sendMessage({ target: "popup", event: "playback_error", message: msg.message }).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// Startup: connect native host
// ---------------------------------------------------------------------------

chrome.runtime.onStartup.addListener(() => {
  connectNative();
});

chrome.runtime.onInstalled.addListener(async () => {
  const { outputDir } = await chrome.storage.local.get("outputDir");
  if (!outputDir) {
    await chrome.storage.local.set({
      outputDir: "~/Music/YouTubeMusic",
      serverPort: 18932,
      volume: 0.8,
      files: [],
    });
  }
  connectNative();
});
