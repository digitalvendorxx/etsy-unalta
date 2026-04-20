#!/usr/bin/env bash
# Create a new branded instance of Etsy Product Creator.
# Usage: bash clone-instance.sh <target-dir> [brand-name] [port] [cdp-port] [primary-color]
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

TARGET="${1:?Usage: clone-instance.sh <target-dir> [brand-name] [port] [cdp-port] [primary-color]}"
BRAND_NAME="${2:-Product Creator}"
PORT_N="${3:-3002}"
CDP_N="${4:-9334}"
PRIMARY="${5:-#f59e0b}"
ACCENT="${6:-#a78bfa}"

if [ -e "$TARGET" ]; then
  echo "ERROR: $TARGET already exists"
  exit 1
fi

echo ">> Copying repo to $TARGET (excluding node_modules, data, designs, output, logs, profiles)..."
rsync -a \
  --exclude node_modules \
  --exclude data \
  --exclude designs \
  --exclude output \
  --exclude uploads \
  --exclude templates \
  --exclude mockups \
  --exclude logs \
  --exclude .git \
  --exclude '.env' \
  --exclude 'config.json' \
  --exclude 'mockup-positions.json' \
  "$ROOT"/ "$TARGET"/

cd "$TARGET"

# Detect Chrome for target OS (same logic as setup.sh)
CHROME_PATH=""
case "$(uname -s)" in
  Darwin)
    for p in \
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
      "/Applications/Arc.app/Contents/MacOS/Arc" \
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
      [ -f "$p" ] && CHROME_PATH="$p" && break
    done
    ;;
  Linux)
    for p in /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
      [ -x "$p" ] && CHROME_PATH="$p" && break
    done
    ;;
esac

SLUG=$(echo "$BRAND_NAME" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/-\+/-/g;s/^-//;s/-$//')
USER_DATA_DIR="$HOME/.epc-$SLUG-chrome"

cat > config.json <<EOF
{
  "mockup": { "x": 280, "y": 350, "width": 400, "height": 500 },
  "keepPhotoIndexes": [],
  "keepPhotoCount": 6,
  "operaPath": "$CHROME_PATH",
  "cdpPort": $CDP_N,
  "userDataDir": "$USER_DATA_DIR",
  "brand": {
    "name": "$BRAND_NAME",
    "primary": "$PRIMARY",
    "accent": "$ACCENT",
    "logoUrl": ""
  }
}
EOF

cat > .env <<EOF
WIRO_API_KEY=
OPENROUTER_API_KEY=
PORT=$PORT_N
EOF

echo ""
echo "Instance hazir: $TARGET"
echo "  Brand:       $BRAND_NAME"
echo "  Port:        $PORT_N"
echo "  CDP port:    $CDP_N"
echo "  Chrome prof: $USER_DATA_DIR"
echo "  Primary:     $PRIMARY"
echo ""
echo "Kalan adimlar:"
echo "  1. cd $TARGET"
echo "  2. .env ac, WIRO_API_KEY + OPENROUTER_API_KEY gir"
echo "  3. npm install"
echo "  4. npm run browser    # CDP Chrome ayri profilde acilir"
echo "  5. Acilan Chrome'da etsy + pinterest login (bir defa)"
echo "  6. npm start          # http://localhost:$PORT_N"
