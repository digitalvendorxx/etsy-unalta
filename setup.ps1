#Requires -Version 5.1
# Etsy Product Creator - Windows kurulum scripti
# Kullanim: PowerShell icinde:  .\setup.ps1
# Eger "running scripts is disabled" hatasi alirsan:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Say($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "   $msg" -ForegroundColor Green }
function Warn($msg){ Write-Host "   UYARI: $msg" -ForegroundColor Yellow }
function Need($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "=== Etsy Product Creator - Windows kurulum ===" -ForegroundColor Magenta

# 1. winget
if (-not (Need winget)) {
  throw "winget bulunamadi. Windows 10/11 guncel olmali. https://aka.ms/getwinget"
}

# 2. Git
if (-not (Need git)) {
  Say "Git kuruluyor (winget)..."
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Ok "Git: $(git --version)"

# 3. Node 18+
$needNode = $true
if (Need node) {
  $ver = (node -v) -replace '^v',''
  $major = [int]($ver.Split('.')[0])
  if ($major -ge 18) { $needNode = $false }
}
if ($needNode) {
  Say "Node LTS kuruluyor (winget)..."
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Ok "Node: $(node -v)"

# 4. Chrome tespit / kur
function Detect-Chrome {
  $paths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($p in $paths) { if (Test-Path $p) { return $p } }
  return $null
}

$ChromePath = Detect-Chrome
if (-not $ChromePath) {
  Say "Google Chrome kuruluyor (winget)..."
  winget install --id Google.Chrome -e --source winget --accept-package-agreements --accept-source-agreements
  $ChromePath = Detect-Chrome
}
if ($ChromePath) { Ok "Chrome: $ChromePath" } else { Warn "Chrome otomatik kurulamadi. https://www.google.com/chrome/" }

# 5. npm install
if (-not (Test-Path (Join-Path $Root "node_modules"))) {
  Say "npm install..."
  npm install
}
Ok "node_modules OK"

# 6. Playwright Chromium (cookie-mode fallback)
$pwCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (-not (Test-Path $pwCache)) {
  Say "Playwright Chromium kuruluyor..."
  try { npx -y playwright install chromium } catch { Warn "Playwright indirilirken hata: $_" }
}

# 7. config.json
$cfgPath = Join-Path $Root "config.json"
if (-not (Test-Path $cfgPath)) {
  $cpJson = if ($ChromePath) { ($ChromePath -replace '\\','\\') } else { "" }
  $cfg = @"
{
  "mockup": { "x": 280, "y": 350, "width": 400, "height": 500 },
  "keepPhotoIndexes": [],
  "keepPhotoCount": 6,
  "operaPath": "$cpJson",
  "cdpPort": 9334,
  "userDataDir": "$($env:LOCALAPPDATA -replace '\\','\\')\\EtsyProductCreator\\chrome-profile"
}
"@
  Set-Content -Path $cfgPath -Value $cfg -Encoding UTF8
  Ok "config.json yazildi"
}

# 8. .env
$envPath = Join-Path $Root ".env"
if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $Root ".env.example") $envPath
  Ok ".env olusturuldu (bos — sihirbazdan doldur)"
}

Write-Host ""
Write-Host "Kurulum tamam." -ForegroundColor Green
Write-Host ""
Write-Host "KALAN ADIMLAR:"
Write-Host "  1. npm start"
Write-Host "  2. Tarayicida acilan sayfada Kurulum Sihirbazi ile API key gir"
Write-Host "  3. Kutu icinden CDP Chrome ac, etsy+pinterest login (1 kez)"
Write-Host ""
Write-Host "Eski yol (CLI):"
Write-Host "  npm run browser  (CDP Chrome ayri profilde acilir)"
Write-Host "  npm start        (http://localhost:3000)"
