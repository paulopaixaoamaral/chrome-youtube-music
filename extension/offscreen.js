const player = document.getElementById("player");

let throttleTimer = null;
const THROTTLE_MS = 500;

player.addEventListener("timeupdate", () => {
  if (throttleTimer) return;
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
  }, THROTTLE_MS);

  chrome.runtime.sendMessage({
    source: "offscreen",
    event: "timeupdate",
    currentTime: player.currentTime,
    duration: player.duration || 0,
  });
});

player.addEventListener("ended", () => {
  chrome.runtime.sendMessage({ source: "offscreen", event: "ended" });
});

player.addEventListener("error", () => {
  const err = player.error;
  chrome.runtime.sendMessage({
    source: "offscreen",
    event: "error",
    message: err ? err.message : "Unknown playback error",
  });
});

player.addEventListener("loadedmetadata", () => {
  chrome.runtime.sendMessage({
    source: "offscreen",
    event: "loadedmetadata",
    duration: player.duration,
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;

  switch (msg.action) {
    case "play":
      player.src = msg.url;
      player.play().catch((e) => {
        chrome.runtime.sendMessage({
          source: "offscreen",
          event: "error",
          message: e.message,
        });
      });
      break;

    case "pause":
      player.pause();
      break;

    case "resume":
      player.play().catch(() => {});
      break;

    case "seek":
      if (Number.isFinite(msg.time)) {
        player.currentTime = msg.time;
      }
      break;

    case "setVolume":
      player.volume = Math.max(0, Math.min(1, msg.volume));
      break;
  }
});

// Restore volume from storage on load
chrome.storage.local.get("volume").then(({ volume }) => {
  if (typeof volume === "number") {
    player.volume = volume;
  }
});
