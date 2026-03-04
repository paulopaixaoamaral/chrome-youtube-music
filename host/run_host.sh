#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$DIR/venv/bin/python" "$DIR/yt_music_host.py"
