#!/usr/bin/env python3
"""
Native Messaging Host for Chrome YouTube Music extension.

Responsibilities:
  1. Read/write length-prefixed JSON messages on stdin/stdout (Chrome native messaging protocol)
  2. Download YouTube videos as MP3 using yt-dlp
  3. Serve MP3 files over a local HTTP server for the extension to stream
"""
import json
import logging
import os
import struct
import sys
import threading
import uuid
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# ---------------------------------------------------------------------------
# Protect stdin/stdout BEFORE importing anything that might write to them.
# yt-dlp and ffmpeg can write to stdout/stderr, which would corrupt the
# native messaging binary protocol and cause Chrome to kill the connection.
# ---------------------------------------------------------------------------

_native_stdin = os.fdopen(os.dup(sys.stdin.fileno()), "rb", buffering=0)
_native_stdout = os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0)

_devnull = open(os.devnull, "w")
sys.stdout = _devnull
sys.stderr = _devnull
os.dup2(_devnull.fileno(), 1)
os.dup2(_devnull.fileno(), 2)

import yt_dlp  # noqa: E402 — must import after stdout/stderr redirect

# ---------------------------------------------------------------------------
# Logging — writes to a file next to this script so we can debug
# ---------------------------------------------------------------------------

LOG_PATH = Path(__file__).parent / "host.log"

logging.basicConfig(
    filename=str(LOG_PATH),
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("yt_music_host")

# ---------------------------------------------------------------------------
# Native messaging I/O helpers
# ---------------------------------------------------------------------------

_write_lock = threading.Lock()


def read_message() -> dict | None:
    """Read a single native-messaging message from the saved stdin fd."""
    raw_length = _native_stdin.read(4)
    if not raw_length or len(raw_length) < 4:
        return None
    length = struct.unpack("=I", raw_length)[0]
    payload = _native_stdin.read(length)
    if len(payload) < length:
        return None
    msg = json.loads(payload.decode("utf-8"))
    log.debug("Received: %s", msg)
    return msg


def send_message(msg: dict) -> None:
    """Write a single native-messaging message to the saved stdout fd (thread-safe)."""
    encoded = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    with _write_lock:
        _native_stdout.write(struct.pack("=I", len(encoded)))
        _native_stdout.write(encoded)
        _native_stdout.flush()
    log.debug("Sent: %s", msg)


# ---------------------------------------------------------------------------
# HTTP file server (runs in a daemon thread)
# ---------------------------------------------------------------------------

class CORSRequestHandler(SimpleHTTPRequestHandler):
    """Serves files with CORS headers and Range request support."""

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(200)
        self.end_headers()

    def do_GET(self) -> None:
        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes="):
            self._handle_range_request(range_header)
        else:
            super().do_GET()

    def _handle_range_request(self, range_header: str) -> None:
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            self.send_error(404)
            return

        file_size = os.path.getsize(path)
        range_spec = range_header.replace("bytes=", "")
        start_str, _, end_str = range_spec.partition("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Length", str(content_length))
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

        with open(path, "rb") as f:
            f.seek(start)
            remaining = content_length
            buf_size = 64 * 1024
            while remaining > 0:
                chunk = f.read(min(buf_size, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def log_message(self, format: str, *args: object) -> None:
        log.debug("HTTP: " + (format % args))


_http_server: HTTPServer | None = None
_http_thread: threading.Thread | None = None


def start_file_server(directory: str, port: int) -> int:
    """Start the HTTP file server in a daemon thread. Returns the port."""
    global _http_server, _http_thread

    if _http_server is not None:
        stop_file_server()

    directory = str(Path(directory).expanduser().resolve())
    os.makedirs(directory, exist_ok=True)

    handler = partial(CORSRequestHandler, directory=directory)
    _http_server = HTTPServer(("127.0.0.1", port), handler)
    _http_thread = threading.Thread(target=_http_server.serve_forever, daemon=True)
    _http_thread.start()
    log.info("HTTP server started on 127.0.0.1:%d serving %s", port, directory)
    return _http_server.server_address[1]


def stop_file_server() -> None:
    global _http_server, _http_thread
    if _http_server:
        _http_server.shutdown()
        _http_server = None
        _http_thread = None


# ---------------------------------------------------------------------------
# yt-dlp download logic
# ---------------------------------------------------------------------------

def download_video(url: str, output_dir: str, download_id: str) -> None:
    """Download a YouTube video as MP3, sending progress messages."""
    output_dir = str(Path(output_dir).expanduser().resolve())
    os.makedirs(output_dir, exist_ok=True)

    import time as _time

    result_info: dict = {}
    last_progress_time = 0.0

    def progress_hook(d: dict) -> None:
        nonlocal last_progress_time
        if d["status"] == "downloading":
            now = _time.monotonic()
            if now - last_progress_time < 0.5:
                return
            last_progress_time = now
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            percent = (downloaded / total * 100) if total else 0
            send_message({
                "type": "progress",
                "id": download_id,
                "percent": round(percent, 1),
                "status": "downloading",
            })
        elif d["status"] == "finished":
            send_message({
                "type": "progress",
                "id": download_id,
                "percent": 100,
                "status": "converting",
            })

    def postprocessor_hook(d: dict) -> None:
        if d["status"] == "finished" and d.get("postprocessor") == "MoveFiles":
            filepath = d.get("info_dict", {}).get("filepath", "")
            result_info["filepath"] = filepath

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [postprocessor_hook],
        "quiet": True,
        "no_warnings": True,
    }

    try:
        log.info("Starting download: %s -> %s", url, output_dir)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        title = info.get("title", "Unknown")
        duration = info.get("duration", 0)

        filepath = result_info.get("filepath", "")
        if not filepath:
            filepath = os.path.join(output_dir, ydl.prepare_filename(info))
            base, _ = os.path.splitext(filepath)
            filepath = base + ".mp3"

        filename = os.path.basename(filepath)
        file_size = os.path.getsize(filepath) if os.path.exists(filepath) else 0

        send_message({
            "type": "download_complete",
            "id": download_id,
            "filename": filename,
            "title": title,
            "duration": duration,
            "size": file_size,
        })
        log.info("Download complete: %s -> %s", title, filepath)
    except Exception as exc:
        log.error("Download failed: %s", exc, exc_info=True)
        send_message({
            "type": "error",
            "id": download_id,
            "message": str(exc),
        })


# ---------------------------------------------------------------------------
# File listing
# ---------------------------------------------------------------------------

def list_files(output_dir: str) -> list[dict]:
    output_dir = str(Path(output_dir).expanduser().resolve())
    if not os.path.isdir(output_dir):
        return []

    files: list[dict] = []
    for entry in sorted(Path(output_dir).iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if entry.suffix.lower() == ".mp3":
            stat = entry.stat()
            files.append({
                "name": entry.name,
                "title": entry.stem,
                "size": stat.st_size,
                "modified": stat.st_mtime,
            })
    return files


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(__file__).parent / "config.json"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {"output_dir": "~/Music/YouTubeMusic", "server_port": 18932}


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


# ---------------------------------------------------------------------------
# Main message loop
# ---------------------------------------------------------------------------

def main() -> None:
    log.info("=== Native host starting (pid=%d) ===", os.getpid())
    config = load_config()
    output_dir = config.get("output_dir", "~/Music/YouTubeMusic")
    server_port = config.get("server_port", 18932)
    log.info("Config: output_dir=%s, server_port=%d", output_dir, server_port)

    actual_port = start_file_server(output_dir, server_port)
    send_message({
        "type": "server_started",
        "port": actual_port,
        "baseUrl": f"http://127.0.0.1:{actual_port}",
    })

    while True:
        msg = read_message()
        if msg is None:
            break

        action = msg.get("action")

        if action == "download":
            url = msg.get("url", "")
            dl_dir = msg.get("outputDir", output_dir)
            download_id = msg.get("id", str(uuid.uuid4()))
            thread = threading.Thread(
                target=download_video,
                args=(url, dl_dir, download_id),
                daemon=True,
            )
            thread.start()

        elif action == "list_files":
            dl_dir = msg.get("outputDir", output_dir)
            files = list_files(dl_dir)
            send_message({"type": "file_list", "files": files})

        elif action == "start_server":
            dl_dir = msg.get("outputDir", output_dir)
            port = msg.get("port", server_port)
            actual_port = start_file_server(dl_dir, port)
            send_message({
                "type": "server_started",
                "port": actual_port,
                "baseUrl": f"http://127.0.0.1:{actual_port}",
            })

        elif action == "set_config":
            new_dir = msg.get("outputDir")
            new_port = msg.get("port")
            if new_dir:
                config["output_dir"] = new_dir
                output_dir = new_dir
            if new_port:
                config["server_port"] = new_port
                server_port = new_port
            save_config(config)
            actual_port = start_file_server(output_dir, server_port)
            send_message({
                "type": "config_saved",
                "config": config,
                "baseUrl": f"http://127.0.0.1:{actual_port}",
            })

        elif action == "ping":
            send_message({"type": "pong"})

        else:
            send_message({"type": "error", "message": f"Unknown action: {action}"})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log.critical("Unhandled exception", exc_info=True)
        raise
