const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { generateDesign, generateDesignFlux } = require('./lib/generate-design');
const { composeMockup, composeMockupSharp, composeMockupFlux, composeMockupCopyrighted, POSITIONS_FILE } = require('./lib/compose-mockup');
const { scrapeTags, generateSEOTitle } = require('./lib/scrape-tags');
const { uploadToEtsy } = require('./lib/upload-etsy');
const { pinToPinterest } = require('./lib/pin-to-pinterest');
const { uploadToEtsyWithCookies } = require('./lib/upload-etsy-cookies');
const { pinToPinterestWithCookies } = require('./lib/pin-to-pinterest-cookies');
const { execFile } = require('child_process');
const providers = require('./lib/providers');
const niche = require('./lib/niche');

// Prevent server crash on unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message || err);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
['designs', 'output', 'uploads', 'mockups', 'data'].forEach(dir => {
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
});

// Multer config
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// Parse JSON body
app.use(express.json());

// API key middleware
app.use((req, res, next) => {
  req.apiKey = process.env.OPENROUTER_API_KEY || '';
  next();
});

// Quick CDP check helper
async function isCdpAvailable() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    const port = config.cdpPort || 9333;
    const { chromium } = require('playwright');
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    return true;
  } catch { return false; }
}

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/designs', express.static(path.join(__dirname, 'designs')));
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/mockups', express.static(path.join(__dirname, 'mockups')));

// Cookie storage (file-based, no auth needed)
const COOKIES_FILE = path.join(__dirname, 'data', 'cookies.json');
function loadCookies() {
  try { return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8')); } catch { return {}; }
}
function saveCookiesFile(data) {
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/brand', (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    const brand = cfg.brand || {};
    res.json({
      name: brand.name || 'Etsy Product Creator',
      primary: brand.primary || '#f59e0b',
      accent: brand.accent || '#a78bfa',
      logoUrl: brand.logoUrl || '',
    });
  } catch (err) {
    res.json({ name: 'Etsy Product Creator', primary: '#f59e0b', accent: '#a78bfa', logoUrl: '' });
  }
});

app.post('/api/etsy-cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Cookie verisi gerekli' });
  const data = loadCookies();
  data.etsy = cookies;
  saveCookiesFile(data);
  res.json({ ok: true });
});

app.post('/api/pinterest-cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Cookie verisi gerekli' });
  const data = loadCookies();
  data.pinterest = cookies;
  saveCookiesFile(data);
  res.json({ ok: true });
});

app.get('/api/cookie-status', (req, res) => {
  const data = loadCookies();
  res.json({ hasEtsy: !!data.etsy, hasPinterest: !!data.pinterest });
});

// List designs
app.get('/api/designs', (req, res) => {
  const dir = path.join(__dirname, 'designs');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => ({ name: f, path: '/designs/' + f }));
  res.json(files);
});

// List output mockups
app.get('/api/output', (req, res) => {
  const dir = path.join(__dirname, 'output');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => ({ name: f, path: '/output/' + f }));
  res.json(files);
});

// ── CDP Browser Launch ──
app.get('/api/cdp-status', async (req, res) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const port = config.cdpPort || 9333;
  try {
    const resp = await fetch(`http://localhost:${port}/json/version`);
    const data = await resp.json();
    res.json({ running: true, browser: data.Browser || 'unknown', port });
  } catch {
    res.json({ running: false, port });
  }
});

app.post('/api/cdp-launch', (req, res) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const port = config.cdpPort || 9333;
  const browserPath = config.operaPath || config.chromePath || '';
  if (!browserPath || !fs.existsSync(browserPath)) {
    return res.status(400).json({ error: 'Tarayici yolu bulunamadi: ' + browserPath });
  }
  const args = [`--remote-debugging-port=${port}`, '--restore-last-session'];
  execFile(browserPath, args, { detached: true, stdio: 'ignore' }).unref();
  // Wait a bit and check if it started
  setTimeout(async () => {
    try {
      const resp = await fetch(`http://localhost:${port}/json/version`);
      const data = await resp.json();
      res.json({ ok: true, browser: data.Browser || 'unknown', port });
    } catch {
      res.json({ ok: true, message: 'Baslatildi, baglanti bekleniyor...', port });
    }
  }, 3000);
});

// ── Mockup Library ──
app.get('/api/mockups', (req, res) => {
  const dir = path.join(__dirname, 'mockups');
  const files = fs.readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => ({ name: f, path: '/mockups/' + f }));
  res.json(files);
});

app.post('/api/mockups/upload', upload.array('mockups', 20), (req, res) => {
  const dir = path.join(__dirname, 'mockups');
  const saved = [];
  for (const file of req.files) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(dir, safeName);
    fs.renameSync(file.path, dest);
    saved.push({ name: safeName, path: '/mockups/' + safeName });
  }
  res.json(saved);
});

app.delete('/api/mockups/:name', (req, res) => {
  const safeName = path.basename(req.params.name);
  const filePath = path.join(__dirname, 'mockups', safeName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Helper: rename uploaded file with proper extension
function renameWithExt(file) {
  const ext = path.extname(file.originalname) || '.png';
  const newPath = file.path + ext;
  fs.renameSync(file.path, newPath);
  return newPath;
}

// ── Get meta info for a SKU ──
app.get('/api/meta/:sku', (req, res) => {
  const sku = req.params.sku;
  let meta = {};
  const metaPath = path.join(__dirname, 'output', sku + '.meta.json');
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}

  // Fill in designPath if missing - scan designs/ dir
  if (!meta.designPath) {
    try {
      const designsDir = path.join(__dirname, 'designs');
      const designFile = fs.readdirSync(designsDir).find(f => f.startsWith(sku + '_design'));
      if (designFile) meta.designPath = '/designs/' + designFile;
    } catch {}
  }

  // Fallback: if mockupTemplatePaths missing, scan mockups/ dir for available templates
  if (!meta.mockupTemplatePaths || meta.mockupTemplatePaths.length === 0) {
    try {
      const mockupsDir = path.join(__dirname, 'mockups');
      const files = fs.readdirSync(mockupsDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
      meta.mockupTemplatePaths = files.map(f => '/mockups/' + f);
    } catch {
      meta.mockupTemplatePaths = [];
    }
  }

  res.json(meta);
});

// ── Mockup positions CRUD ──
app.get('/api/mockup-positions', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
    res.json(data);
  } catch {
    res.json({});
  }
});

app.post('/api/mockup-positions', (req, res) => {
  try {
    const { template, x, y, w, h } = req.body;
    if (!template) return res.status(400).json({ error: 'template required' });
    let data = {};
    try { data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch {}
    data[template] = { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, positions: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Regenerate a single mockup ──
app.post('/api/regenerate-mockup',
  upload.fields([
    { name: 'design', maxCount: 1 },
    { name: 'backDesign', maxCount: 1 },
    { name: 'mockupTemplate', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const designFile = req.files?.design?.[0];
      const backDesignFile = req.files?.backDesign?.[0];
      const mockupTemplateFile = req.files?.mockupTemplate?.[0];
      const sku = req.body.sku || `SKU${Date.now()}`;
      const index = parseInt(req.body.index) || 0;
      const mode = req.body.mode || 'single';

      // Regen options
      const regenScale = req.body.scale ? parseFloat(req.body.scale) : undefined;
      const regenPosition = req.body.position || undefined;
      const regenWhiteMode = req.body.whiteMode === 'true' || req.body.whiteMode === '1';
      const sharpOpts = {};
      if (regenScale) sharpOpts.scale = regenScale;
      if (regenPosition) sharpOpts.position = regenPosition;
      if (regenWhiteMode) sharpOpts.whiteMode = true;

      // Accept either uploaded files or existing paths
      const designPath = designFile ? renameWithExt(designFile) : req.body.designPath;
      const backDesignPath = backDesignFile ? renameWithExt(backDesignFile) : req.body.backDesignPath;
      const mockupTemplatePath = mockupTemplateFile ? renameWithExt(mockupTemplateFile) : req.body.mockupTemplatePath;

      console.log(`[regen] index=${index}, mode=${mode}, designPath=${designPath}, mockupTemplatePath=${mockupTemplatePath}, opts=${JSON.stringify(sharpOpts)}`);

      if (!designPath || !mockupTemplatePath) {
        return res.status(400).json({ error: 'designPath and mockupTemplatePath required' });
      }

      const toAbs = (p) => p.match(/^[a-zA-Z]:/) ? p : path.join(__dirname, p.replace(/^\//, ''));
      const absDesign = toAbs(designPath);
      const absBack = backDesignPath ? toAbs(backDesignPath) : null;
      const absMockup = toAbs(mockupTemplatePath);
      console.log(`[regen] resolved template: ${absMockup}`);

      // Use Sharp for regen when options are specified (scale, position, whiteMode)
      const hasSharpOpts = Object.keys(sharpOpts).length > 0;
      let outputPaths;
      if (mode === 'front-back' && absBack) {
        outputPaths = await composeFrontBackMockup(absDesign, absBack, [absMockup], sku, req.apiKey);
      } else if (hasSharpOpts) {
        outputPaths = await composeMockupSharp(absDesign, [absMockup], sku, sharpOpts);
      } else if (mode === 'copyrighted') {
        outputPaths = await composeMockupCopyrighted(absDesign, [absMockup], sku);
      } else {
        outputPaths = await composeMockup(absDesign, [absMockup], sku);
      }

      const outputName = path.basename(outputPaths[0]);
      res.json({ path: '/output/' + outputName, name: outputName });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Generate tags with AI ──
app.post('/api/generate-tags-ai', async (req, res) => {
  try {
    const { title, tags: existingTags } = req.body;
    const seed = niche.tagSeed();
    const nicheContext = niche.titleSystemRules();
    const { text: content } = await providers.chat({
      temperature: 0.7,
      maxTokens: 400,
      messages: [{
        role: 'user',
        content: `You are an Etsy SEO expert. Generate exactly 13 optimized tags for this Etsy listing.

Title: "${title || 'T-shirt design'}"
${existingTags?.length ? `Current tags for reference: ${existingTags.slice(0, 5).join(', ')}` : ''}
${seed.length ? `Seed keywords (expand around these, do not repeat verbatim): ${seed.join(', ')}` : ''}
${nicheContext ? 'Niche context:\n' + nicheContext + '\n' : ''}
RULES:
1. Each tag max 20 characters
2. Mix broad + niche keywords
3. Include style, occasion, and target audience terms
4. No repetition across tags
5. Think like a buyer searching on Etsy

Output ONLY a JSON array of 13 strings, nothing else. Example: ["tag1","tag2",...]`,
      }],
    });
    const match = (content || '').match(/\[[\s\S]*?\]/);
    const tags = match ? JSON.parse(match[0]) : [];
    res.json({ tags: tags.slice(0, 13) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate title with AI ──
app.post('/api/generate-title-ai', async (req, res) => {
  try {
    const { title, tags } = req.body;
    const newTitle = await generateSEOTitle(title || '', tags || [], req.apiKey);
    res.json({ title: newTitle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate description with AI ──
app.post('/api/generate-description-ai', async (req, res) => {
  try {
    const { title, tags } = req.body;
    const addon = niche.descriptionAddon();
    const { text: content } = await providers.chat({
      temperature: 0.7,
      maxTokens: 600,
      messages: [{
        role: 'user',
        content: `You are an Etsy listing description writer. Write a compelling product description for this listing.

Title: "${title || ''}"
Tags: ${(tags || []).join(', ')}
${addon}

Write a professional Etsy listing description. Include:
1. Eye-catching opening line
2. Product details (material, fit, style)
3. Sizing info mention
4. Care instructions
5. Perfect for gifting note

Keep it concise, 150-250 words. Use short paragraphs. Output ONLY the description text.`,
      }],
    });
    res.json({ description: niche.stripBanned((content || '').trim()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Main pipeline endpoint — SSE response
app.post('/api/create',
  upload.fields([
    { name: 'ref', maxCount: 1 },
    { name: 'backDesign', maxCount: 1 },
    { name: 'mockups', maxCount: 20 },
  ]),
  async (req, res) => {
    // Disable request timeout — pipeline can take several minutes
    req.setTimeout(0);
    res.setTimeout(0);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // SSE keepalive — prevent browser from dropping idle connection
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);
    res.on('close', () => clearInterval(keepalive));

    const mode = req.body.mode || 'single'; // single | front-back | copyrighted
    const refFile = req.files?.ref?.[0];
    const backDesignFile = req.files?.backDesign?.[0];

    // DEBUG: log what server receives
    console.log('[REQ] body keys:', Object.keys(req.body));
    console.log('[REQ] resumeFrom:', req.body.resumeFrom, '| continueFrom:', req.body.continueFrom);
    console.log('[REQ] existingTags:', req.body.existingTags ? req.body.existingTags.substring(0, 80) : 'NULL');
    console.log('[REQ] existingTitle:', req.body.existingTitle ? req.body.existingTitle.substring(0, 60) : 'NULL');
    console.log('[REQ] existingMockups:', req.body.existingMockups ? 'YES' : 'NULL');
    console.log('[REQ] existingListingUrl:', req.body.existingListingUrl || 'NULL');

    const isResume = !!req.body.resumeFrom || !!req.body.continueFrom;

    if (!refFile && !isResume) {
      send({ type: 'error', message: 'No reference image uploaded' });
      return res.end();
    }

    if (mode === 'front-back' && !backDesignFile && !isResume) {
      send({ type: 'error', message: 'Front-back mode requires a back design image' });
      return res.end();
    }

    const sku = req.body.sku || `SKU${Date.now()}`;
    const competitor = req.body.competitor || '';
    const prompt = req.body.prompt || undefined;
    const skipTags = req.body.skipTags === '1';
    const fullAuto = req.body.fullAuto === '1';
    const mockupFiles = req.files?.mockups || [];

    // Library mockups: resolve paths from mockups/ directory
    const libraryMockupPaths = (req.body.libraryMockups || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => path.join(__dirname, p.replace(/^\//, '')));

    // Resume support: skip already-completed steps
    const resumeFrom = req.body.resumeFrom || null; // 'mockup' | 'tags' | 'upload' | 'pinterest'
    const existingDesign = req.body.existingDesign || null;       // /designs/xxx.png
    const existingMockups = req.body.existingMockups || null;     // comma-separated /output/xxx.png
    const existingTags = req.body.existingTags || null;           // comma-separated tags
    const existingTitle = req.body.existingTitle || null;
    const existingDescription = req.body.existingDescription || null;
    const existingListingUrl = req.body.existingListingUrl || null;
    const continueFrom = req.body.continueFrom || null;

    const STEP_ORDER = ['generate', 'mockup', 'tags', 'upload', 'pinterest'];
    // continueFrom maps to resumeFrom equivalent for step skipping
    const effectiveResumeFrom = resumeFrom
      || (continueFrom === 'mockup-approve' ? 'tags' : null)
      || (continueFrom === 'upload' ? 'upload' : null)
      || (continueFrom === 'upload-and-pin' ? 'upload' : null)
      || (continueFrom === 'pinterest' ? 'pinterest' : null);
    const resumeIdx = effectiveResumeFrom ? STEP_ORDER.indexOf(effectiveResumeFrom) : 0;
    const shouldRun = (step) => STEP_ORDER.indexOf(step) >= resumeIdx;

    // Rename files with proper extensions
    const refPath = refFile ? renameWithExt(refFile) : null;
    const backDesignPath = backDesignFile ? renameWithExt(backDesignFile) : null;
    // Save uploaded mockup templates to mockups/ so they persist for regeneration
    const mockupsDir = path.join(__dirname, 'mockups');
    const uploadedMockupPaths = mockupFiles.map(f => {
      const tmp = renameWithExt(f);
      const safeName = f.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(mockupsDir, safeName);
      fs.copyFileSync(tmp, dest);
      return dest;
    });
    const mockupPaths = [...uploadedMockupPaths, ...libraryMockupPaths];
    // Send template paths to client for regeneration
    const mockupTemplatePaths = mockupPaths.map(p => '/mockups/' + path.basename(p));

    const allTempFiles = mockupFiles.map(f => f.path + (path.extname(f.originalname) || '.png'));
    if (refPath) allTempFiles.push(refPath);
    if (backDesignPath) allTempFiles.push(backDesignPath);

    // Save metadata for resume — preserve existing meta when resuming
    const metaPath = path.join(__dirname, 'output', sku + '.meta.json');
    let meta;
    if (isResume && fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { meta = {}; }
      meta.timestamp = Date.now();
      if (competitor) meta.competitor = competitor;
      if (mockupTemplatePaths.length > 0) meta.mockupTemplatePaths = mockupTemplatePaths;
    } else {
      meta = { sku, competitor, mode, timestamp: Date.now(), mockupTemplatePaths };
    }
    // Write meta immediately so mockupTemplatePaths is always persisted
    try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch {}

    send({ type: 'sku', sku });

    try {
      // ── Step 1: Design ──
      let designPath;
      let backDesignFinalPath = null;

      if (!shouldRun('generate') && existingDesign) {
        // Resume: use existing design
        designPath = path.join(__dirname, existingDesign.replace(/^\//, ''));
        send({ type: 'step-done', step: 'generate', message: 'Tasarım (önceden hazır)' });
        send({ type: 'design', path: existingDesign, name: path.basename(existingDesign) });
        send({ type: 'log', message: 'Tasarım adımı atlandı (devam)' });
      } else if (!shouldRun('generate')) {
        // Resume without design - try to find design by SKU
        send({ type: 'step-done', step: 'generate', message: 'Tasarım adımı atlandı' });
        try {
          const designsDir = path.join(__dirname, 'designs');
          const found = fs.readdirSync(designsDir).find(f => f.startsWith(sku + '_design'));
          if (found) {
            designPath = path.join(designsDir, found);
            send({ type: 'design', path: '/designs/' + found, name: found });
          }
        } catch {}
      } else if (mode === 'copyrighted') {
        const designExt = path.extname(refFile.originalname) || '.png';
        const designName = `${sku}_design${designExt}`;
        designPath = path.join(__dirname, 'designs', designName);
        fs.copyFileSync(refPath, designPath);
        send({ type: 'step-done', step: 'generate', message: 'Tasarım hazır (orijinal kullanılıyor)' });
        send({ type: 'design', path: '/designs/' + designName, name: designName });
      } else {
        send({ type: 'step-start', step: 'generate', message: 'Wiro ile tasarım üretiliyor (nano-banana-pro)...' });
        try {
          designPath = await generateDesign(refPath, sku, prompt);
          const designName = path.basename(designPath);
          send({ type: 'step-done', step: 'generate', message: 'Tasarım üretildi' });
          send({ type: 'design', path: '/designs/' + designName, name: designName });
        } catch (err) {
          send({ type: 'error', step: 'generate', message: `Tasarım üretimi başarısız: ${err.message}` });
          return res.end();
        }

        if (mode === 'front-back' && backDesignPath) {
          try {
            backDesignFinalPath = await generateDesign(backDesignPath, `${sku}_back`, prompt);
            send({ type: 'design', path: '/designs/' + path.basename(backDesignFinalPath), name: path.basename(backDesignFinalPath) });
          } catch (err) {
            send({ type: 'error', step: 'generate', message: `Arka tasarım üretimi başarısız: ${err.message}` });
            return res.end();
          }
        }
      }


      // Save meta with design info
      meta.designPath = designPath ? '/designs/' + path.basename(designPath) : null;
      if (backDesignFinalPath) meta.backDesignPath = '/designs/' + path.basename(backDesignFinalPath);
      try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch {}

      // Helper to persist meta updates
      const saveMeta = () => {
        try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch {}
      };

      // ── Step 2: Compose Mockups ──
      let mockupOutputs = [];

      if ((!shouldRun('mockup') || continueFrom) && existingMockups) {
        // Resume or continueFrom: use existing mockups
        mockupOutputs = existingMockups.split(',').map(p => path.join(__dirname, p.trim().replace(/^\//, '')));
        send({ type: 'step-done', step: 'mockup', message: `Mockup (${mockupOutputs.length} adet hazır)` });
        send({ type: 'mockupTemplates', paths: mockupTemplatePaths });
        // Send mockup events to frontend
        mockupOutputs.forEach((p, i) => {
          const name = path.basename(p);
          send({ type: 'mockup', path: '/output/' + name, name, templatePath: mockupTemplatePaths[i] || '' });
        });
        send({ type: 'log', message: 'Mockup adımı atlandı (devam)' });
      } else if (!shouldRun('mockup')) {
        send({ type: 'step-done', step: 'mockup', message: 'Mockup adımı atlandı' });
      } else if (mockupPaths.length > 0) {
        send({ type: 'step-start', step: 'mockup', message: 'Composing mockups...' });
        try {
          if (mode === 'front-back' && backDesignFinalPath) {
            mockupOutputs = await composeFrontBackMockup(designPath, backDesignFinalPath, mockupPaths, sku, req.apiKey);
          } else if (mode === 'copyrighted') {
            mockupOutputs = await composeMockupCopyrighted(designPath, mockupPaths, sku);
          } else {
            mockupOutputs = await composeMockup(designPath, mockupPaths, sku);
          }
          send({ type: 'step-done', step: 'mockup', message: 'Mockups composed' });
          send({ type: 'mockupTemplates', paths: mockupTemplatePaths });
          meta.mockupPaths = mockupOutputs.map(p => '/output/' + path.basename(p));
          saveMeta();
          mockupOutputs.forEach((p, i) => {
            const name = path.basename(p);
            send({ type: 'mockup', path: '/output/' + name, name, templatePath: mockupTemplatePaths[i] || '' });
            send({ type: 'log', message: 'Mockup ready: ' + name });
          });
        } catch (err) {
          console.error('AI mockup error:', err.message);
          send({ type: 'step-error', step: 'mockup', message: 'AI mockup basarisiz: ' + err.message });
        }
      }

      // ── Pause for mockup approval ──
      if (mockupOutputs.length > 0 && !continueFrom) {
        send({ type: 'pause', step: 'mockup', message: 'Mockup hazir — onaylayip devam edin' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        return res.end();
      }

      // ── Step 3: Scrape Tags & Title ──
      let tags = [];
      let title = '';
      let description = '';

      console.log(`  [tags] shouldRun=${shouldRun('tags')}, competitor=${competitor ? competitor.substring(0, 40) : 'NULL'}, skipTags=${skipTags}, existingTags=${existingTags ? 'YES' : 'NULL'}`);

      if (continueFrom === 'pinterest') {
        // Pinterest-only: skip tags entirely
        send({ type: 'log', message: 'Tag adımı atlandı (sadece Pinterest)' });
      } else if (!shouldRun('tags') && existingTags) {
        // Resume: use existing tags/title/description
        tags = existingTags.split(',').map(t => t.trim()).filter(Boolean);
        title = existingTitle || '';
        description = existingDescription || '';
        send({ type: 'step-done', step: 'tags', message: `Etiketler (önceden hazır: ${tags.length})` });
        send({ type: 'log', message: 'Etiket adımı atlandı (devam)' });
        // Persist in meta
        meta.title = title;
        meta.tags = tags;
        meta.description = description;
        saveMeta();
      } else if (competitor && !skipTags) {
        send({ type: 'step-start', step: 'tags', message: 'Etiketler cekilyor...' });
        let tagSuccess = false;
        // Try Alura/CDP scraping first
        try {
          const result = await scrapeTags(competitor);
          tags = result.tags;
          title = result.title;
          description = result.description;
          tagSuccess = true;
          send({ type: 'step-done', step: 'tags', message: `${tags.length} tags, description ready` });
        } catch (err) {
          send({ type: 'log', message: 'CDP/Alura baglantisi yok, AI ile tag uretiliyor...' });
        }
        // Fallback: AI tag generation if CDP failed
        if (!tagSuccess) {
          try {
            const { text: content } = await providers.chat({
              temperature: 0.7,
              maxTokens: 800,
              messages: [{
                role: 'user',
                content: `You are an Etsy SEO expert. Generate 13 SEO-optimized tags for an Etsy listing based on this competitor URL: ${competitor}\n\nRules:\n- Each tag max 20 characters\n- Use lowercase\n- Mix broad and specific keywords\n- Include seasonal/trending terms\n- No trademark/brand names\n\nAlso generate:\n1. An SEO title (under 70 chars, natural language)\n2. A product description (2-3 paragraphs)\n\nFormat your response as JSON: {"tags":["tag1","tag2",...], "title":"...", "description":"..."}`,
              }],
            });
            const jsonMatch = (content || '').match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              tags = (parsed.tags || []).slice(0, 13);
              title = parsed.title || '';
              description = parsed.description || '';
              tagSuccess = true;
              send({ type: 'step-done', step: 'tags', message: `AI ile ${tags.length} tag uretildi` });
            }
          } catch (aiErr) {
            send({ type: 'step-error', step: 'tags', message: 'AI tag uretimi basarisiz: ' + aiErr.message });
          }
        }
        if (tagSuccess) {
          send({ type: 'tags', tags });
          send({ type: 'title', title });
          send({ type: 'description', description });
          meta.title = title;
          meta.tags = tags;
          meta.description = description;
          saveMeta();
        } else {
          send({ type: 'log', message: 'Tag cekilemedi. Manuel girin veya AI ile uretin.' });
        }
      } else if (shouldRun('tags') && !competitor) {
        console.log('  [tags] SKIPPED — no competitor URL provided');
        send({ type: 'log', message: 'Rakip URL girilmedi — tag cekilemedi. Manuel girin veya AI ile uretin.' });
      }

      // Check CDP availability for upload/pinterest steps
      const cdpReady = await isCdpAvailable();

      // ── Pause before upload — ALWAYS pause if tags or title missing ──
      console.log(`  [pause-check] fullAuto=${fullAuto}, continueFrom=${continueFrom}, tags=${tags.length}, title="${(title||'').substring(0,30)}"`);
      if (!continueFrom && (tags.length === 0 || !title)) {
        const msg = 'Etiketler ve baslik henuz cekilmedi — manuel girin veya AI ile uretin, sonra Etsy yuklemeyi onaylayin';
        send({ type: 'pause', step: 'tags', message: msg });
        send({ type: 'done' });
        cleanup(allTempFiles);
        return res.end();
      }
      if (!fullAuto && !continueFrom) {
        send({ type: 'pause', step: 'tags', message: 'Etiketler hazir — duzenleyip Etsy yuklemeyi onaylayin' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        return res.end();
      }

      // ── Step 4: Upload to Etsy ──
      let listingUrl = existingListingUrl || '';

      if ((continueFrom === 'upload-and-pin' || continueFrom === 'pinterest') && existingListingUrl && existingListingUrl.includes('etsy.com')) {
        // Coming from "Pin to Pinterest" button — upload already done, use existing URL
        listingUrl = existingListingUrl;
        send({ type: 'step-done', step: 'upload', message: 'Etsy (önceden yüklendi)' });
        send({ type: 'listingUrl', url: listingUrl });
        send({ type: 'log', message: 'Upload atlandı — mevcut listing kullanılıyor: ' + listingUrl });
      } else if ((continueFrom === 'upload-and-pin' || continueFrom === 'pinterest') && !existingListingUrl) {
        // Pin requested but no listing URL — cannot continue
        send({ type: 'step-error', step: 'upload', message: 'Listing URL bulunamadı — pin iptal edildi' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        return res.end();
      } else if (!shouldRun('upload') && existingListingUrl) {
        send({ type: 'step-done', step: 'upload', message: 'Etsy (önceden yüklendi)' });
        send({ type: 'log', message: 'Etsy adımı atlandı (devam)' });
      } else if (fullAuto || continueFrom === 'upload') {
        // Hard block: never upload without tags and title
        if (tags.length === 0 || !title) {
          send({ type: 'step-error', step: 'upload', message: 'Tag veya baslik bos — upload iptal edildi' });
          send({ type: 'pause', step: 'tags', message: 'Tag/baslik eksik — ekleyip tekrar deneyin' });
          send({ type: 'done' });
          cleanup(allTempFiles);
          return res.end();
        }
        // Hard block: never upload without mockups
        if (mockupOutputs.length === 0) {
          send({ type: 'step-error', step: 'upload', message: 'Mockup yok — upload iptal edildi' });
          send({ type: 'pause', step: 'mockup', message: 'Mockup bulunamadi — once mockup olusturun' });
          send({ type: 'done' });
          cleanup(allTempFiles);
          return res.end();
        }
        send({ type: 'step-start', step: 'upload', message: 'Etsy\'ye yükleniyor...' });
        console.log(`  [upload] title="${(title||'').substring(0,50)}", tags=${tags.length}, desc=${(description||'').length} chars, mockups=${mockupOutputs.length}`);
        try {
          let result;
          if (cdpReady) {
            // Local mode: use CDP browser automation
            result = await uploadToEtsy({ sku, mockupPaths: mockupOutputs, tags, title, description });
          } else if (loadCookies().etsy) {
            // Cookie mode: use saved cookies
            result = await uploadToEtsyWithCookies({ sku, mockupPaths: mockupOutputs, tags, title, description, etsyCookies: loadCookies().etsy });
          } else {
            throw new Error('Etsy hesabi bagli degil. Ayarlardan Etsy cookie\'lerinizi ekleyin.');
          }
          listingUrl = result.listingUrl || '';
          if (!listingUrl || listingUrl === 'about:blank' || !listingUrl.includes('etsy.com')) {
            send({ type: 'step-error', step: 'upload', message: 'Etsy yükleme dogrulanamadi — listing URL alinamadi' });
          } else {
            send({ type: 'step-done', step: 'upload', message: 'Etsy\'ye yuklendi' });
            send({ type: 'listingUrl', url: listingUrl });
            meta.listingUrl = listingUrl;
            saveMeta();
          }
        } catch (err) {
          send({ type: 'step-error', step: 'upload', message: 'Etsy: ' + err.message });
        }
      }

      // ── Pause after upload — ask about Pinterest (only if not fullAuto and not already continuing with pin) ──
      if (!fullAuto && continueFrom !== 'upload-and-pin' && continueFrom !== 'pinterest' && listingUrl && listingUrl.includes('etsy.com')) {
        send({ type: 'pause', step: 'upload', message: 'Etsy yüklendi — Pinterest\'e pinlensin mi?' });
        send({ type: 'done' });
        cleanup(allTempFiles);
        return res.end();
      }

      // ── Step 5: Pin to Pinterest (SKU ile aratarak bulur) ──
      let pinterestDone = false;
      if (fullAuto || continueFrom === 'upload-and-pin' || continueFrom === 'pinterest') {
        if (!shouldRun('pinterest')) {
          send({ type: 'step-done', step: 'pinterest', message: 'Pinterest (önceden pinlendi)' });
          pinterestDone = true;
        } else {
          console.log(`  [pinterest] sku="${sku}"`);
          send({ type: 'step-start', step: 'pinterest', message: 'Pinterest\'e pinleniyor...' });
          try {
            if (cdpReady) {
              const pinResult = await pinToPinterest({ sku });
              if (pinResult.listingUrl) {
                listingUrl = pinResult.listingUrl;
                send({ type: 'listingUrl', url: listingUrl });
              }
            } else if (loadCookies().pinterest) {
              const firstMockup = mockupOutputs[0];
              await pinToPinterestWithCookies({ listingUrl, mockupPath: firstMockup, title, description, pinterestCookies: loadCookies().pinterest });
            } else {
              throw new Error('Pinterest hesabi bagli degil. Ayarlardan Pinterest cookie\'lerinizi ekleyin.');
            }
            send({ type: 'step-done', step: 'pinterest', message: 'Pinterest\'e pinlendi' });
            pinterestDone = true;
          } catch (err) {
            send({ type: 'step-error', step: 'pinterest', message: 'Pinterest: ' + err.message });
          }
        }
      }

      // Mark pipeline as completed only if both upload and pinterest succeeded
      if (listingUrl && listingUrl.includes('etsy.com')) {
        // Update meta with listingUrl
        try {
          const mp = path.join(__dirname, 'output', sku + '.meta.json');
          const existing = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf-8')) : {};
          existing.listingUrl = listingUrl;
          if (pinterestDone) existing.pinterestDone = true;
          existing.completedAt = Date.now();
          fs.writeFileSync(mp, JSON.stringify(existing));
        } catch {}
        // Only write .done marker when pinterest is also completed
        if (pinterestDone) {
          const donePath = path.join(__dirname, 'output', sku + '.done');
          try { fs.writeFileSync(donePath, listingUrl); } catch {}
        }
      }

      send({ type: 'done' });
    } catch (err) {
      send({ type: 'error', message: 'Pipeline error: ' + err.message });
      send({ type: 'done' });
    }

    cleanup(allTempFiles);
    res.end();
  }
);

// Front-back mockup: places front+back designs on a single mockup template
async function composeFrontBackMockup(frontDesignPath, backDesignPath, mockupPaths, sku, overrideApiKey) {
  const apiKey = overrideApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('API key not set. Ayarlar sayfasindan API anahtarinizi girin.');

  const OUTPUT_DIR = path.join(__dirname, 'output');

  function readAsBase64(filePath) {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { base64: data.toString('base64'), mime };
  }

  const front = readAsBase64(frontDesignPath);
  const back = readAsBase64(backDesignPath);
  const outputPaths = [];

  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) continue;

    const mockup = readAsBase64(mockupPath);
    console.log(`  Composing front-back mockup ${i + 1}/${mockupPaths.length}...`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Etsy Product Creator',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${front.mime};base64,${front.base64}` },
              },
              {
                type: 'image_url',
                image_url: { url: `data:${back.mime};base64,${back.base64}` },
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mockup.mime};base64,${mockup.base64}` },
              },
              {
                type: 'text',
                text: `First image is the FRONT design. Second image is the BACK design. Third image is a clothing mockup photo.

You MUST place both designs onto the t-shirt mockup. Follow these rules EXACTLY:

FRONT DESIGN POSITION:
- Place the front design CENTERED horizontally on the chest.
- Place it in the UPPER-MIDDLE area of the chest (roughly 1/3 from collar, 2/3 from hem).

BACK DESIGN POSITION:
- Place the back design CENTERED horizontally on the back of the shirt.
- Same vertical positioning as the front (upper-middle of the back panel).

SIZE (for both):
- Each design's width should be approximately 40-50% of the t-shirt's width (seam to seam).
- Maintain each design's original aspect ratio. Do NOT stretch, squash, or distort.

QUALITY:
- Match the t-shirt's perspective, angle, and any rotation or fold.
- Apply subtle fabric texture, lighting, and wrinkles over the designs so they look naturally printed.
- If designs have white or solid backgrounds, remove them — only place the artwork itself.
- Do NOT alter the mockup photo in any way — same background, same colors, same everything. ONLY add the designs.
- Do NOT add any borders, frames, or extra elements.

OUTPUT: A single high-quality image of the mockup with both designs placed on it.`,
              },
            ],
          },
        ],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Front-back mockup compose failed: ${errBody}`);
    }

    const data = await response.json();
    if (!data.choices || data.choices.length === 0) {
      throw new Error('No choices returned from OpenRouter');
    }

    const message = data.choices[0].message;
    const imageParts = [];
    if (Array.isArray(message.content)) {
      imageParts.push(...message.content.filter(p => p.type === 'image_url'));
    }
    if (Array.isArray(message.images)) {
      imageParts.push(...message.images.filter(p => p.type === 'image_url'));
    }

    let saved = false;
    for (const part of imageParts) {
      if (part.image_url?.url) {
        const url = part.image_url.url;
        let imgBuffer;
        if (url.startsWith('data:')) {
          const b64 = url.split(',')[1];
          imgBuffer = Buffer.from(b64, 'base64');
        } else {
          const imgResp = await fetch(url);
          imgBuffer = Buffer.from(await imgResp.arrayBuffer());
        }
        const outputName = `${sku}_mockup${i + 1}.png`;
        const outputPath = path.join(OUTPUT_DIR, outputName);
        fs.writeFileSync(outputPath, imgBuffer);
        console.log(`  Front-back mockup saved: ${outputPath}`);
        outputPaths.push(outputPath);
        saved = true;
        break;
      }
    }

    if (!saved) {
      console.warn(`  Warning: No image in response for front-back mockup ${i + 1}`);
    }
  }

  if (outputPaths.length === 0) {
    throw new Error('No front-back mockups were generated');
  }

  return outputPaths;
}

// Clean up uploaded temp files
function cleanup(paths) {
  paths.forEach(p => {
    try { fs.unlinkSync(p); } catch {}
  });
}

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ═══════════════════════════════════════════════
// Setup Wizard API
// ═══════════════════════════════════════════════
const ENV_PATH = path.join(__dirname, '.env');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const COOKIES_PATH = path.join(__dirname, 'data', 'cookies.json');

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
  }
  return out;
}
function writeEnvFile(updates) {
  const existing = readEnvFile();
  const merged = { ...existing, ...updates };
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', { mode: 0o600 });
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;
}
function isPlaceholder(v) {
  if (!v) return true;
  const s = String(v).trim().toLowerCase();
  return !s || s.includes('your_') || s.includes('here') || s === 'changeme';
}

app.get('/api/setup/status', async (req, res) => {
  const env = readEnvFile();
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

  const chromePath = cfg.operaPath || '';
  const chromeOk = chromePath && fs.existsSync(chromePath);

  let cdpOk = false;
  try {
    const port = cfg.cdpPort || 9334;
    const r = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    cdpOk = r.ok;
  } catch {}

  let etsyLogged = false, pinLogged = false;
  try {
    const c = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    etsyLogged = Array.isArray(c.etsy) && c.etsy.length > 0;
    pinLogged = Array.isArray(c.pinterest) && c.pinterest.length > 0;
  } catch {}

  const wiroOk = !isPlaceholder(env.WIRO_API_KEY);
  const openrouterOk = !isPlaceholder(env.OPENROUTER_API_KEY);
  const templateIdOk = !!(cfg.etsyTemplateListingId && /^\d{6,15}$/.test(String(cfg.etsyTemplateListingId).trim()));

  const ready = wiroOk && openrouterOk && chromeOk && templateIdOk;
  res.json({
    ready,
    checks: {
      wiroKey: wiroOk,
      openrouterKey: openrouterOk,
      chromePath: chromeOk,
      chromePathValue: chromePath,
      cdpRunning: cdpOk,
      cdpPort: cfg.cdpPort || 9334,
      etsyLoggedIn: etsyLogged,
      pinterestLoggedIn: pinLogged,
      etsyTemplateId: templateIdOk,
      etsyTemplateIdValue: cfg.etsyTemplateListingId || '',
      port: process.env.PORT || 3000,
      activeProductType: cfg.activeProductType || 'tshirt',
    },
    env: {
      WIRO_API_KEY: wiroOk ? mask(env.WIRO_API_KEY) : '',
      OPENROUTER_API_KEY: openrouterOk ? mask(env.OPENROUTER_API_KEY) : '',
    },
  });
});

function mask(v) {
  if (!v) return '';
  const s = String(v);
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}

app.post('/api/setup/save', (req, res) => {
  try {
    const { wiroKey, openrouterKey, chromePath, cdpPort, port } = req.body || {};
    const updates = {};
    if (typeof wiroKey === 'string' && wiroKey.trim() && !wiroKey.includes('••••')) {
      updates.WIRO_API_KEY = wiroKey.trim();
    }
    if (typeof openrouterKey === 'string' && openrouterKey.trim() && !openrouterKey.includes('••••')) {
      updates.OPENROUTER_API_KEY = openrouterKey.trim();
    }
    if (typeof port === 'string' && /^\d{2,5}$/.test(port.trim())) {
      updates.PORT = port.trim();
    }
    if (Object.keys(updates).length) writeEnvFile(updates);

    const { etsyTemplateListingId, productType } = req.body || {};
    const cfgTouch = chromePath || cdpPort || etsyTemplateListingId || productType;
    if (cfgTouch) {
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
      if (typeof chromePath === 'string' && chromePath.trim()) cfg.operaPath = chromePath.trim();
      if (cdpPort && /^\d{2,5}$/.test(String(cdpPort).trim())) cfg.cdpPort = parseInt(String(cdpPort).trim(), 10);
      if (typeof etsyTemplateListingId === 'string') {
        const t = etsyTemplateListingId.trim();
        if (!t) delete cfg.etsyTemplateListingId;
        else if (/^\d{6,15}$/.test(t)) cfg.etsyTemplateListingId = t;
      }
      if (typeof productType === 'string' && productType.trim()) {
        cfg.activeProductType = productType.trim();
        const preset = { ...DEFAULT_PRODUCT_TYPES, ...(cfg.productTypes || {}) }[cfg.activeProductType];
        if (preset && preset.position) cfg.mockup = { ...preset.position };
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════
// Product Types — mockup position presets per product
// ═══════════════════════════════════════════════
const DEFAULT_PRODUCT_TYPES = {
  tshirt: {
    label: 'T-Shirt / Giyim',
    position: { x: 280, y: 350, width: 400, height: 500 },
    hint: 'Tasarimi gogus ortasina yerlestir, kumas kivrimlarina uyum saglat, dokuyu koru.',
  },
  mug: {
    label: 'Kupa / Mug',
    position: { x: 220, y: 260, width: 360, height: 320 },
    hint: 'Tasarimi kupanin on yuzeyine sar, silindirik distorsiyon uygula.',
  },
  poster: {
    label: 'Poster / Baski',
    position: { x: 80, y: 80, width: 720, height: 960 },
    hint: 'Tam kare baski, cerceve icinde kenarlardan bosluk birak.',
  },
  wallart: {
    label: 'Wall Art (Cerceveli/Kanvas)',
    position: { x: 120, y: 100, width: 640, height: 880 },
    hint: 'Duvara asili cerceveli baski ya da kanvas, matte paper texture, realistic wall shadow, frame reflection preserved. Keep design centered within frame boundary, maintain exact aspect ratio.',
  },
  hoodie: {
    label: 'Hoodie / Sweatshirt',
    position: { x: 290, y: 380, width: 380, height: 440 },
    hint: 'Kapson altina, gogus ortasina yerlestir, yumusak kumas dokusu.',
  },
  tote: {
    label: 'Tote Bag',
    position: { x: 200, y: 280, width: 440, height: 500 },
    hint: 'Tote yuzeyine duz baski, kanvas dokusunu goster.',
  },
  sticker: {
    label: 'Sticker / Cikartma',
    position: { x: 100, y: 100, width: 680, height: 680 },
    hint: 'Beyaz kenarli die-cut sticker gorunumu.',
  },
  phonecase: {
    label: 'Telefon Kilifi',
    position: { x: 160, y: 200, width: 320, height: 580 },
    hint: 'Kilif arkasina tam baski, kamera kesiminden kacin.',
  },
};

// ═══════════════════════════════════════════════
// Niche editor
// ═══════════════════════════════════════════════
app.get('/api/niche', (req, res) => {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  res.json(cfg.niche || {});
});

app.post('/api/niche/generate', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'prompt gerekli (min 3 karakter)' });
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY eksik' });

    const sys = `You are a niche-expansion assistant for an Etsy/print-on-demand seller.
Given a short user description, output a JSON object with EXACTLY these fields:
- category: short product category phrase (e.g. "funny graphic t-shirts")
- style: visual style keywords (comma-separated phrase)
- targetAudience: buyer persona keywords
- priceHint: reasonable price range like "$18-$28"
- keywordSeed: array of 7-10 Etsy-ready SEO keywords (2-3 words each)
- bannedWords: array of 4-8 brand/copyright terms to avoid (disney, nike, etc.)
- designPromptExtra: one-sentence directive for AI image generator
- descriptionVoice: 3-5 adjectives for the product description tone

Return ONLY valid JSON, no markdown, no commentary. All field values should be in English (Etsy is English-facing).`;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Etsy Product Creator',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: prompt.trim() },
        ],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return res.status(502).json({ error: 'OpenRouter hata: ' + t.slice(0, 300) });
    }
    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || '{}';
    content = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { return res.status(502).json({ error: 'AI gecersiz JSON dondurdu', raw: content.slice(0, 500) }); }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/niche', (req, res) => {
  try {
    const n = req.body || {};
    const cleaned = {
      category: typeof n.category === 'string' ? n.category.trim() : '',
      style: typeof n.style === 'string' ? n.style.trim() : '',
      targetAudience: typeof n.targetAudience === 'string' ? n.targetAudience.trim() : '',
      priceHint: typeof n.priceHint === 'string' ? n.priceHint.trim() : '',
      keywordSeed: Array.isArray(n.keywordSeed)
        ? n.keywordSeed.map(s => String(s).trim()).filter(Boolean)
        : (typeof n.keywordSeed === 'string'
          ? n.keywordSeed.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
          : []),
      bannedWords: Array.isArray(n.bannedWords)
        ? n.bannedWords.map(s => String(s).trim()).filter(Boolean)
        : (typeof n.bannedWords === 'string'
          ? n.bannedWords.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
          : []),
      designPromptExtra: typeof n.designPromptExtra === 'string' ? n.designPromptExtra.trim() : '',
      descriptionVoice: typeof n.descriptionVoice === 'string' ? n.descriptionVoice.trim() : '',
    };
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    cfg.niche = cleaned;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    res.json({ ok: true, niche: cleaned });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/product-types', (req, res) => {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  const custom = (cfg.productTypes && typeof cfg.productTypes === 'object') ? cfg.productTypes : {};
  const merged = { ...DEFAULT_PRODUCT_TYPES, ...custom };
  const active = cfg.activeProductType || 'tshirt';
  res.json({ types: merged, active });
});

app.post('/api/product-types/custom', (req, res) => {
  try {
    const { key, label, hint, position } = req.body || {};
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key gerekli' });
    if (!label || typeof label !== 'string') return res.status(400).json({ error: 'label gerekli' });
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!cleanKey) return res.status(400).json({ error: 'gecersiz key' });
    const pos = position && typeof position === 'object' ? {
      x: parseInt(position.x, 10) || 280,
      y: parseInt(position.y, 10) || 350,
      width: parseInt(position.width, 10) || 400,
      height: parseInt(position.height, 10) || 500,
    } : { x: 280, y: 350, width: 400, height: 500 };
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    cfg.productTypes = cfg.productTypes || {};
    cfg.productTypes[cleanKey] = {
      label: String(label).trim(),
      position: pos,
      hint: typeof hint === 'string' && hint.trim() ? hint.trim() : `center of ${String(label).toLowerCase()}`,
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    res.json({ ok: true, key: cleanKey, type: cfg.productTypes[cleanKey] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/product-types/custom/:key', (req, res) => {
  try {
    const key = req.params.key;
    if (DEFAULT_PRODUCT_TYPES[key]) return res.status(400).json({ error: 'builtin tip silinemez' });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    if (cfg.productTypes && cfg.productTypes[key]) delete cfg.productTypes[key];
    if (cfg.activeProductType === key) cfg.activeProductType = 'tshirt';
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/product-types/active', (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key gerekli' });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    cfg.activeProductType = key;
    const preset = { ...DEFAULT_PRODUCT_TYPES, ...(cfg.productTypes || {}) }[key];
    if (preset && preset.position) cfg.mockup = { ...preset.position };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    res.json({ ok: true, active: key, mockup: cfg.mockup });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/setup/detect-chrome', (req, res) => {
  const os = process.platform;
  const candidates = os === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Arc.app/Contents/MacOS/Arc',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Opera GX.app/Contents/MacOS/Opera',
  ] : os === 'win32' ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/brave-browser',
  ];
  const found = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || '';
  res.json({ found, candidates });
});

// Global error handler — catches multer errors etc. so connection doesn't just drop
app.use((err, req, res, next) => {
  console.error('Express error:', err.message || err);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Etsy Product Creator running at http://localhost:${PORT}`);
});
