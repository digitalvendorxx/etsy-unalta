#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/digitalvendorxx/etsy-unalta.git"
TARGET_DIR="${1:-$HOME/etsy-unalta}"

echo "=== Etsy Product Creator kurulum ==="
echo "Hedef: $TARGET_DIR"

need() { command -v "$1" >/dev/null 2>&1; }
die()  { echo "ERROR: $*" >&2; exit 1; }

OS="$(uname -s)"

# 1. Git kontrol / kurulum
if ! need git; then
  echo ">> git yok, kuruluyor..."
  case "$OS" in
    Darwin)
      if ! need brew; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
        [ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"
      fi
      brew install git
      ;;
    Linux) sudo apt-get update && sudo apt-get install -y git ;;
    MINGW*|MSYS*|CYGWIN*) die "Windows: git kur (https://git-scm.com) ve tekrar calistir" ;;
    *) die "Bilinmeyen OS, git elle kur" ;;
  esac
fi
echo "   git: $(git --version)"

# 2. Clone veya pull
if [ -d "$TARGET_DIR/.git" ]; then
  echo ">> Mevcut klasor, guncelleniyor..."
  cd "$TARGET_DIR"
  git pull --ff-only origin main || die "git pull basarisiz (local degisiklik var mi?)"
elif [ -e "$TARGET_DIR" ]; then
  die "$TARGET_DIR var ama git deposu degil. Sil veya baska hedef sec: ./install.sh /baska/yol"
else
  echo ">> Clone: $REPO_URL"
  git clone "$REPO_URL" "$TARGET_DIR"
  cd "$TARGET_DIR"
fi

# 3. setup.sh calistir (Node, Chrome, npm install, playwright, config, .env)
if [ ! -f setup.sh ]; then die "setup.sh bulunamadi"; fi
chmod +x setup.sh
bash setup.sh

# 4. Kisayol scripts (start.sh, start-browser.sh) uretimi
cat > start-browser.sh <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
npm run browser
EOF
chmod +x start-browser.sh

cat > start.sh <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
npm start
EOF
chmod +x start.sh

# 5. Ozet
cat <<EOF

=== KURULUM TAMAM ===
Klasor: $TARGET_DIR

SIRAYLA:
  1. .env dosyasini ac, API key'leri doldur:
       $TARGET_DIR/.env
     ( GEMINI_API_KEY / WIRO_API_KEY + OPENROUTER_API_KEY )

  2. CDP browser ac (etsy + pinterest login icin):
       cd "$TARGET_DIR" && ./start-browser.sh
     Acilan pencerede etsy.com ve pinterest.com hesaplarina login ol.
     Bu pencere arka planda acik kalmali.

  3. Server baslat (yeni terminal):
       cd "$TARGET_DIR" && ./start.sh

  4. Tarayicida ac:  http://localhost:3000
EOF
