const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const port = config.cdpPort || 9333;
const browserPath = config.operaPath || 'C:/Users/berka/AppData/Local/Programs/Opera GX/opera.exe';
// Use user's default profile (so Alura extension + Etsy login are available).
// Override via config.userDataDir if a separate profile is explicitly desired.
const userDataDir = config.userDataDir || null;

async function isCdpRunning() {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function killExistingOpera() {
  return new Promise((resolve) => {
    exec('powershell -Command "Get-Process opera -ErrorAction SilentlyContinue | Stop-Process -Force"', () => {
      setTimeout(resolve, 3500);
    });
  });
}

async function main() {
  if (await isCdpRunning()) {
    console.log(`Browser already running on CDP port ${port}`);
    return;
  }

  console.log('Closing existing Opera instances to free default profile...');
  await killExistingOpera();

  const profileArg = userDataDir ? ` --user-data-dir="${userDataDir}"` : '';
  if (userDataDir) fs.mkdirSync(userDataDir, { recursive: true });

  console.log(`Launching Opera with CDP on port ${port}${userDataDir ? ` (profile: ${userDataDir})` : ' (default profile)'}...`);
  const child = exec(`"${browserPath}" --remote-debugging-port=${port}${profileArg} --no-first-run --no-default-browser-check`, { windowsHide: false });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isCdpRunning()) {
      console.log(`Browser ready on CDP port ${port}`);
      return;
    }
  }

  console.error(`ERROR: Browser did not start CDP on port ${port} within 30s`);
  process.exit(1);
}

main();
