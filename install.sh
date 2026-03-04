#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_DIR="$SCRIPT_DIR/host"
VENV_DIR="$HOST_DIR/venv"
HOST_SCRIPT="$HOST_DIR/yt_music_host.py"
NATIVE_MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
NATIVE_MANIFEST_FILE="$NATIVE_MANIFEST_DIR/com.ytmusic.host.json"
DEFAULT_MUSIC_DIR="$HOME/Music/YouTubeMusic"

echo "=== YouTube Music Chrome Extension - Installer ==="
echo ""

# --- Check / install Python 3 ---
if command -v python3 &>/dev/null; then
    PYTHON="$(command -v python3)"
    echo "[OK] Python 3 found: $PYTHON"
else
    echo "[!!] Python 3 not found."
    if command -v brew &>/dev/null; then
        echo "     Installing via Homebrew..."
        brew install python
        PYTHON="$(command -v python3)"
    else
        echo "     Please install Python 3 and re-run this script."
        exit 1
    fi
fi

# --- Check / install ffmpeg ---
if command -v ffmpeg &>/dev/null; then
    echo "[OK] ffmpeg found: $(command -v ffmpeg)"
else
    echo "[!!] ffmpeg not found."
    if command -v brew &>/dev/null; then
        echo "     Installing via Homebrew..."
        brew install ffmpeg
    else
        echo "     Please install ffmpeg and re-run this script."
        exit 1
    fi
fi

# --- Create virtual environment ---
echo ""
echo "--- Setting up Python virtual environment ---"
if [ -d "$VENV_DIR" ]; then
    echo "[OK] Virtual environment already exists at $VENV_DIR"
else
    "$PYTHON" -m venv "$VENV_DIR"
    echo "[OK] Created virtual environment at $VENV_DIR"
fi

# --- Install Python dependencies ---
echo ""
echo "--- Installing Python dependencies ---"
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -r "$HOST_DIR/requirements.txt" -q
echo "[OK] Dependencies installed"

# --- Make host script executable ---
chmod +x "$HOST_SCRIPT"

# --- Register Chrome Native Messaging Host ---
echo ""
echo "--- Registering Native Messaging Host ---"
mkdir -p "$NATIVE_MANIFEST_DIR"

cat > "$NATIVE_MANIFEST_FILE" <<MANIFEST
{
  "name": "com.ytmusic.host",
  "description": "YouTube Music Downloader Native Host",
  "path": "$VENV_DIR/bin/python",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://\$(EXTENSION_ID)/"
  ]
}
MANIFEST

# We need the actual extension ID. Provide a placeholder and instructions.
echo "[!!] Native messaging manifest written to:"
echo "     $NATIVE_MANIFEST_FILE"
echo ""
echo "     IMPORTANT: After loading the extension in Chrome, update the"
echo "     allowed_origins in that file with your actual extension ID."
echo "     Then re-run this script with your extension ID:"
echo ""
echo "       ./install.sh --extension-id <YOUR_EXTENSION_ID>"
echo ""

# Handle --extension-id flag
EXTENSION_ID=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --extension-id)
            EXTENSION_ID="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Always create the wrapper script so the manifest path launches the actual host
WRAPPER="$HOST_DIR/run_host.sh"
cat > "$WRAPPER" <<'WRAPPER_SCRIPT'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec "$DIR/venv/bin/python" "$DIR/yt_music_host.py"
WRAPPER_SCRIPT
chmod +x "$WRAPPER"

if [ -n "$EXTENSION_ID" ]; then
    cat > "$NATIVE_MANIFEST_FILE" <<MANIFEST
{
  "name": "com.ytmusic.host",
  "description": "YouTube Music Downloader Native Host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
MANIFEST
    echo "[OK] Manifest updated with extension ID: $EXTENSION_ID"
else
    cat > "$NATIVE_MANIFEST_FILE" <<MANIFEST
{
  "name": "com.ytmusic.host",
  "description": "YouTube Music Downloader Native Host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://*/"
  ]
}
MANIFEST
    echo "[!!] Manifest written with wildcard origin (development mode)."
    echo "     For production, re-run with --extension-id <ID>."
fi

# --- Create default music directory ---
echo ""
echo "--- Creating default output directory ---"
mkdir -p "$DEFAULT_MUSIC_DIR"
echo "[OK] $DEFAULT_MUSIC_DIR"

echo ""
echo "=== Installation complete! ==="
echo ""
echo "Next steps:"
echo "  1. Open chrome://extensions in Google Chrome"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked' and select: $SCRIPT_DIR/extension"
echo "  4. Note the extension ID and re-run:"
echo "     ./install.sh --extension-id <YOUR_EXTENSION_ID>"
echo ""
