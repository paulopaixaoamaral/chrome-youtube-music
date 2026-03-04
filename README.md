# Chrome YouTube Music Downloader

A Chrome extension that downloads YouTube videos as MP3 files to a local directory, with a built-in persistent audio player.

## Features

- Paste a YouTube URL and download it as an MP3 file
- Configurable output directory on your machine
- Browse your library of downloaded tracks
- Persistent audio player that keeps playing across tabs

## Architecture

The extension consists of two parts:

1. **Chrome Extension** (Manifest V3) — popup UI, background service worker, and an offscreen document for audio playback
2. **Python Native Messaging Host** — handles downloads via yt-dlp/ffmpeg and serves audio files over a local HTTP server

## Prerequisites

- macOS (the install script uses Homebrew)
- Google Chrome
- [Homebrew](https://brew.sh/) (for automated dependency installation)

## Installation

```bash
# Clone or download this repository, then:
cd chrome-youtube-music
./install.sh
```

The install script will:
- Check for / install Python 3 and ffmpeg via Homebrew
- Create a Python virtual environment and install yt-dlp
- Register the native messaging host with Chrome
- Create the default output directory at `~/Music/YouTubeMusic/`

### Load the Extension

1. Open `chrome://extensions` in Google Chrome
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked** and select the `extension/` folder
4. Note the **Extension ID** shown on the card

### Register the Extension ID

```bash
./install.sh --extension-id <YOUR_EXTENSION_ID>
```

This updates the native messaging manifest so Chrome allows communication between the extension and the Python host.

## Usage

1. Click the extension icon in the Chrome toolbar
2. Paste a YouTube URL and click **Download**
3. Watch the progress bar as the track is downloaded and converted
4. Browse your library in the **Library** tab
5. Click any track to play it — audio persists even if you close the popup

## Configuration

- **Output Directory**: Set in the extension popup under Settings
- **Server Port**: The local file server defaults to port `18932`; configurable in Settings

## Troubleshooting

- **"Native host has exited"**: Re-run `./install.sh --extension-id <ID>` to re-register the host
- **No audio playback**: Ensure the Python host is reachable — check that no firewall blocks `localhost:18932`
- **Download fails**: Make sure `yt-dlp` and `ffmpeg` are up to date: `host/venv/bin/pip install -U yt-dlp`

## License

MIT
