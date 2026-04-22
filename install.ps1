# Etsy Product Creator - Windows kurulum
# Kullanim: iwr -useb https://raw.githubusercontent.com/digitalvendorxx/etsy-unalta/main/install.ps1 | iex
# Ozel hedef: $env:TARGET="C:\etsy-tool"; iwr ... | iex

$ErrorActionPreference = "Stop"

$REPO_URL = "https://github.com/digitalvendorxx/etsy-unalta.git"
$TARGET = if ($env:TARGET) { $env:TARGET } else { Join-Path $HOME "etsy-unalta" }

Write-Host "=== Etsy Product Creator Windows kurulum ===" -ForegroundColor Cyan
Write-Host "Hedef: $TARGET"

function Test-Command {
    param([string]$Cmd)
    $null -ne (Get-Command $Cmd -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-ViaWinget {
    param([string]$Id, [string]$Name)
    Write-Host ">> $Name kuruluyor (winget)..." -ForegroundColor Yellow
    & winget install --id $Id --exact --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Host
    Refresh-Path
}

# 1. Winget kontrol
if (-not (Test-Command "winget")) {
    Write-Host "HATA: winget yok. Windows 10 1809+ veya Windows 11 gerekli." -ForegroundColor Red
    Write-Host "App Installer'i Microsoft Store'dan kur: https://www.microsoft.com/store/productId/9NBLGGH4NNS1"
    exit 1
}

# 2. Git
if (-not (Test-Command "git")) {
    Install-ViaWinget -Id "Git.Git" -Name "Git"
    if (-not (Test-Command "git")) {
        Write-Host "Git kuruldu ama PATH'te yok. PowerShell'i kapatip tekrar ac, scripti yeniden calistir." -ForegroundColor Red
        exit 1
    }
}
Write-Host "   git: $(git --version)"

# 3. Node 20 LTS
$installNode = $false
if (-not (Test-Command "node")) {
    $installNode = $true
} else {
    $major = [int](((node -v) -replace '^v','') -split '\.')[0]
    if ($major -lt 18) { $installNode = $true }
}
if ($installNode) {
    Install-ViaWinget -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
    if (-not (Test-Command "node")) {
        Write-Host "Node kuruldu ama PATH'te yok. PowerShell'i kapatip tekrar ac." -ForegroundColor Red
        exit 1
    }
}
Write-Host "   node: $(node -v)"

# 4. Chrome
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromePath = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
    Install-ViaWinget -Id "Google.Chrome" -Name "Google Chrome"
    $chromePath = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($chromePath) {
    Write-Host "   chrome: $chromePath"
} else {
    Write-Host "   UYARI: Chrome path tespit edilemedi, config.json'a elle yaz." -ForegroundColor Yellow
}

# 5. Clone veya pull
if (Test-Path (Join-Path $TARGET ".git")) {
    Write-Host ">> Mevcut klasor, guncelleniyor..." -ForegroundColor Yellow
    Push-Location $TARGET
    git pull --ff-only origin main
    Pop-Location
} elseif (Test-Path $TARGET) {
    Write-Host "HATA: $TARGET var ama git deposu degil. Sil veya baska hedef: `$env:TARGET='C:\baska\yol'" -ForegroundColor Red
    exit 1
} else {
    Write-Host ">> Clone: $REPO_URL" -ForegroundColor Yellow
    git clone $REPO_URL $TARGET
}

Set-Location $TARGET

# 6. npm install
if (-not (Test-Path "node_modules")) {
    Write-Host ">> npm install..." -ForegroundColor Yellow
    npm install
}

# 7. Playwright chromium
$playwrightCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (-not (Test-Path $playwrightCache)) {
    Write-Host ">> Playwright Chromium kuruluyor..." -ForegroundColor Yellow
    npx -y playwright install chromium
}

# 8. config.json
if (-not (Test-Path "config.json")) {
    if ($chromePath) {
        $chromeJsonPath = $chromePath -replace '\\','/'
        $config = @{
            mockup = @{ x = 280; y = 350; width = 400; height = 500 }
            keepPhotoIndexes = @()
            keepPhotoCount = 6
            operaPath = $chromeJsonPath
            cdpPort = 9333
        }
        $config | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 "config.json"
        Write-Host "   config.json yazildi"
    } else {
        Copy-Item "config.example.json" "config.json"
        Write-Host "   config.json: Chrome path'ini 'operaPath' alanina ELLE yaz" -ForegroundColor Yellow
    }
}

# 9. .env - interaktif key doldurma
$envPath = Join-Path $TARGET ".env"
$envHasPlaceholder = $false
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath -Raw
    if ($envContent -match "your_" -or $envContent -match "^\s*GEMINI_API_KEY\s*=\s*$") {
        $envHasPlaceholder = $true
    }
} else {
    Copy-Item ".env.example" $envPath
    $envHasPlaceholder = $true
}

if ($envHasPlaceholder) {
    Write-Host ""
    Write-Host "=== API Key girisi ===" -ForegroundColor Cyan
    Write-Host "Bos birakirsan .env'i sonradan elle doldurmalisin."
    Write-Host ""

    $gemini = Read-Host "GEMINI_API_KEY (Google Gemini / Imagen)"
    $wiro = Read-Host "WIRO_API_KEY (opsiyonel, bos birak gecer)"
    $openrouter = Read-Host "OPENROUTER_API_KEY (opsiyonel, bos birak gecer)"

    $envLines = @()
    if ($gemini)     { $envLines += "GEMINI_API_KEY=$gemini" }     else { $envLines += "GEMINI_API_KEY=your_gemini_api_key_here" }
    if ($wiro)       { $envLines += "WIRO_API_KEY=$wiro" }         else { $envLines += "WIRO_API_KEY=your_wiro_api_key_here" }
    if ($openrouter) { $envLines += "OPENROUTER_API_KEY=$openrouter" } else { $envLines += "OPENROUTER_API_KEY=your_openrouter_api_key_here" }
    $envLines += "PORT=3000"

    $envLines -join "`r`n" | Set-Content -Encoding UTF8 $envPath
    Write-Host "   .env yazildi" -ForegroundColor Green

    if (-not $gemini) {
        Write-Host "   UYARI: GEMINI_API_KEY eksik, tasarim uretimi calismaz. Sonra notepad ile ac: $envPath" -ForegroundColor Yellow
    }
}

# 10. Kisayol bat dosyalari
@"
@echo off
cd /d "%~dp0"
npm run browser
"@ | Set-Content -Encoding ASCII "start-browser.bat"

@"
@echo off
cd /d "%~dp0"
npm start
"@ | Set-Content -Encoding ASCII "start.bat"

# 11. Desktop shortcut (opsiyonel)
try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut((Join-Path $desktop "Etsy Creator - Server.lnk"))
    $lnk.TargetPath = (Join-Path $TARGET "start.bat")
    $lnk.WorkingDirectory = $TARGET
    $lnk.Save()

    $lnk2 = $wsh.CreateShortcut((Join-Path $desktop "Etsy Creator - Browser.lnk"))
    $lnk2.TargetPath = (Join-Path $TARGET "start-browser.bat")
    $lnk2.WorkingDirectory = $TARGET
    $lnk2.Save()
    Write-Host "   Masaustu kisayollari olusturuldu"
} catch {
    Write-Host "   (masaustu kisayol atlandi)"
}

Write-Host ""
Write-Host "=== KURULUM TAMAM ===" -ForegroundColor Green
Write-Host "Klasor: $TARGET"
Write-Host ""

# 12. Auto-launch prompt
$launch = Read-Host "Simdi baslatayim mi? (browser + server + tarayici) [E/h]"
if ($launch -eq "" -or $launch -match "^[eEyY]") {

    Write-Host ">> Browser aciliyor (CDP Chrome)..." -ForegroundColor Yellow
    Start-Process -FilePath (Join-Path $TARGET "start-browser.bat") -WorkingDirectory $TARGET

    Write-Host "   Acilan pencerede etsy.com + pinterest.com login ol." -ForegroundColor Cyan
    Write-Host "   (pencereyi KAPATMA, arka planda kalmali)"
    Write-Host ""
    Read-Host "Login bitince ENTER'a bas (server baslayacak)"

    Write-Host ">> Server baslatiliyor..." -ForegroundColor Yellow
    Start-Process -FilePath (Join-Path $TARGET "start.bat") -WorkingDirectory $TARGET

    Start-Sleep -Seconds 5
    Write-Host ">> Tarayici aciliyor..." -ForegroundColor Yellow
    Start-Process "http://localhost:3000"

    Write-Host ""
    Write-Host "HAZIR. http://localhost:3000" -ForegroundColor Green
    Write-Host "Sonraki aciliistra: masaustu kisayollari (Browser -> Server)."
} else {
    Write-Host ""
    Write-Host "MANUEL BASLATMA:"
    Write-Host "  1. Masaustu > 'Etsy Creator - Browser' (etsy+pinterest login)"
    Write-Host "  2. Masaustu > 'Etsy Creator - Server'"
    Write-Host "  3. http://localhost:3000"
}
