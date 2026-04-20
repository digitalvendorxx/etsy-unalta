#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== Etsy Product Creator otomatik kurulum ==="
OS="$(uname -s)"

# ── Helpers ──
need() { command -v "$1" >/dev/null 2>&1; }
die() { echo "ERROR: $*" >&2; exit 1; }

install_brew() {
  if ! need brew; then
    echo ">> Homebrew kuruluyor..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for the rest of this script (Apple Silicon vs Intel)
    if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
  fi
}

install_node_mac() {
  install_brew
  echo ">> Node LTS kuruluyor (brew)..."
  brew install node
}

install_chrome_mac() {
  install_brew
  echo ">> Google Chrome kuruluyor (brew cask)..."
  brew install --cask google-chrome
}

install_node_linux() {
  echo ">> Node 20 LTS kuruluyor (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

install_chrome_linux() {
  echo ">> Google Chrome kuruluyor..."
  wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo apt-get install -y /tmp/chrome.deb
  rm -f /tmp/chrome.deb
}

install_git_mac()   { install_brew; brew install git; }
install_git_linux() { sudo apt-get update && sudo apt-get install -y git; }

# ── 1. Git ──
if ! need git; then
  case "$OS" in
    Darwin) install_git_mac ;;
    Linux)  install_git_linux ;;
    *) die "Git yok, elle kur (https://git-scm.com)" ;;
  esac
fi
echo "   Git: $(git --version)"

# ── 2. Node 18+ ──
install_node=0
if ! need node; then
  install_node=1
else
  MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  [ "$MAJOR" -lt 18 ] && install_node=1
fi
if [ "$install_node" = "1" ]; then
  case "$OS" in
    Darwin) install_node_mac ;;
    Linux)  install_node_linux ;;
    MINGW*|MSYS*|CYGWIN*) die "Windows: Node 20 LTS kur (https://nodejs.org/) veya 'winget install OpenJS.NodeJS.LTS'" ;;
    *) die "Bilinmeyen OS, Node elle kur" ;;
  esac
fi
echo "   Node: $(node -v)"

# ── 3. Chrome ──
detect_chrome() {
  case "$OS" in
    Darwin)
      for p in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
        "/Applications/Arc.app/Contents/MacOS/Arc" \
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
        "/Applications/Opera GX.app/Contents/MacOS/Opera"; do
        [ -f "$p" ] && echo "$p" && return
      done
      ;;
    Linux)
      for p in /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/brave-browser; do
        [ -x "$p" ] && echo "$p" && return
      done
      ;;
    MINGW*|MSYS*|CYGWIN*)
      for p in \
        "C:/Program Files/Google/Chrome/Application/chrome.exe" \
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe"; do
        [ -f "$p" ] && echo "$p" && return
      done
      ;;
  esac
}

CHROME_PATH="$(detect_chrome)"
if [ -z "$CHROME_PATH" ]; then
  case "$OS" in
    Darwin) install_chrome_mac; CHROME_PATH="$(detect_chrome)" ;;
    Linux)  install_chrome_linux; CHROME_PATH="$(detect_chrome)" ;;
    *) echo "   UYARI: Chrome otomatik kurulamadi. https://www.google.com/chrome/ ZORUNLU." ;;
  esac
fi
[ -n "$CHROME_PATH" ] && echo "   Chrome: $CHROME_PATH"

# ── 4. Deps ──
if [ ! -d node_modules ]; then
  echo ">> npm install..."
  npm install
fi
echo "   node_modules OK"

# ── 5. Playwright Chromium (cookie-mode fallback) ──
if [ ! -d "$HOME/Library/Caches/ms-playwright" ] && [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$LOCALAPPDATA/ms-playwright" ]; then
  echo ">> Playwright Chromium kuruluyor..."
  npx -y playwright install chromium || true
fi

# ── 6. config.json ──
if [ ! -f config.json ]; then
  if [ -n "$CHROME_PATH" ]; then
    cat > config.json <<EOF
{
  "mockup": { "x": 280, "y": 350, "width": 400, "height": 500 },
  "keepPhotoIndexes": [],
  "keepPhotoCount": 6,
  "operaPath": "$CHROME_PATH",
  "cdpPort": 9333
}
EOF
    echo "   config.json yazildi"
  else
    cp config.example.json config.json
    echo "   config.json: Chrome yolu ELLE doldur (operaPath alani)"
  fi
fi

# ── 7. .env ──
if [ ! -f .env ]; then
  cp .env.example .env
  echo "   .env olusturuldu (bos)"
fi

# ── Done ──
cat <<EOF

Kurulum tamam.

KALAN MANUEL ADIMLAR:
  1. .env acip WIRO_API_KEY + OPENROUTER_API_KEY gir
  2. npm run browser      (CDP Chrome acilir, ayri profil)
  3. Acilan pencerede etsy.com + pinterest.com login (bir defa, kalici)
  4. npm start            (server :3000)
  5. http://localhost:3000
EOF
