const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const POSITIONS_FILE = path.join(__dirname, '..', 'mockup-positions.json');

function loadPositions() {
  try { return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8')); } catch { return {}; }
}

function getPositionForTemplate(templatePath, opts) {
  if (opts?.customPosition) return opts.customPosition;
  const key = path.basename(templatePath);
  const positions = loadPositions();
  return positions[key] || null;
}

const PRODUCT_TYPE_HINTS = {
  tshirt:   { subject: 't-shirt', area: 'chest center (between collar and hem)', widthPct: '60-70%', extra: 'Match fabric drape, subtle wrinkles, natural fabric texture.' },
  hoodie:   { subject: 'hoodie',  area: 'chest center, below the hood',           widthPct: '55-65%', extra: 'Soft cotton texture, slight fold shadows around pocket.' },
  mug:      { subject: 'ceramic mug', area: 'front curved face of the mug',       widthPct: '70-80% of visible face', extra: 'Apply cylindrical curvature distortion along mug surface.' },
  poster:   { subject: 'poster/print', area: 'full print area, centered with margin', widthPct: '85-95%', extra: 'Keep sharp edges, flat paper feel, preserve print colors accurately.' },
  wallart:  { subject: 'framed wall art / canvas print', area: 'inside the frame or canvas boundary, centered', widthPct: '92-98% of frame inner area', extra: 'Preserve frame shadows and wall lighting. Matte paper or canvas texture. Respect aspect ratio — do not crop. If frame visible, keep frame edges untouched.' },
  tote:     { subject: 'tote bag', area: 'center of bag front panel',              widthPct: '60-75%', extra: 'Flat canvas texture, slight fabric weave visible.' },
  sticker:  { subject: 'die-cut sticker', area: 'full sticker area',               widthPct: '90-95%', extra: 'White die-cut border around the design silhouette.' },
  phonecase:{ subject: 'phone case back', area: 'center of case back',             widthPct: '75-85%', extra: 'Avoid camera cutout, wrap around edges slightly.' },
};

function getProductHint() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    const key = cfg.activeProductType || 'tshirt';
    if (PRODUCT_TYPE_HINTS[key]) return { key, ...PRODUCT_TYPE_HINTS[key] };
    const custom = cfg.productTypes && cfg.productTypes[key];
    if (custom) {
      return {
        key,
        subject: custom.label || key,
        area: custom.hint || `center of ${custom.label || key}`,
        widthPct: '60-75%',
        extra: 'Preserve mockup surface texture and lighting.',
      };
    }
    return { key: 'tshirt', ...PRODUCT_TYPE_HINTS.tshirt };
  } catch {
    return { key: 'tshirt', ...PRODUCT_TYPE_HINTS.tshirt };
  }
}

async function composeMockup(designPath, mockupPaths, sku) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env');
  const productHint = getProductHint();

  if (!fs.existsSync(designPath)) {
    throw new Error(`Design not found: ${designPath}`);
  }

  const designBase64 = fs.readFileSync(designPath).toString('base64');
  const designExt = path.extname(designPath).toLowerCase();
  const designMime = designExt === '.png' ? 'image/png' : designExt === '.webp' ? 'image/webp' : 'image/jpeg';

  const outputPaths = [];

  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) {
      console.warn(`  Warning: Mockup not found, skipping: ${mockupPath}`);
      continue;
    }

    const mockupBase64 = fs.readFileSync(mockupPath).toString('base64');
    const mockupExt = path.extname(mockupPath).toLowerCase();
    const mockupMime = mockupExt === '.png' ? 'image/png' : mockupExt === '.webp' ? 'image/webp' : 'image/jpeg';

    console.log(`  Composing mockup ${i + 1}/${mockupPaths.length} via AI...`);

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
                image_url: { url: `data:${designMime};base64,${designBase64}` },
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mockupMime};base64,${mockupBase64}` },
              },
              {
                type: 'text',
                text: `First image is a design/graphic. Second image is a product mockup photo.

PRODUCT TYPE: ${productHint.subject}
PLACEMENT AREA: ${productHint.area}
TARGET DESIGN WIDTH: ${productHint.widthPct} of the printable area
PRODUCT-SPECIFIC NOTE: ${productHint.extra}

You MUST place the design onto the ${productHint.subject} mockup. Follow these rules EXACTLY:

POSITION:
- Find the chest area of the t-shirt (the flat front panel between collar and hem).
- Place the design CENTERED horizontally on the chest.
- Place the design in the UPPER-MIDDLE area of the chest (roughly 1/3 from collar, 2/3 from hem).

SIZE:
- The design width should be approximately 60-70% of the t-shirt's chest width (seam to seam). Make it LARGE and prominent.
- Maintain the design's original aspect ratio. Do NOT stretch, squash, or distort.
- The design should look like a bold, large screen-printed graphic.

QUALITY:
- Match the t-shirt's perspective, angle, and any rotation or fold.
- Apply subtle fabric texture, lighting, and wrinkles over the design so it looks naturally printed on the shirt.
- If the design has a white or solid background, remove it — only place the artwork itself.
- Do NOT alter the mockup photo in any way — same background, same colors, same everything. ONLY add the design.
- Do NOT add any borders, frames, or extra elements around the design.

OUTPUT: A single high-quality image of the mockup with the design placed on it.`,
              },
            ],
          },
        ],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Mockup compose failed: ${errBody}`);
    }

    const data = await response.json();
    console.log('  [DEBUG] Gemini mockup response structure:', JSON.stringify(data, null, 2).slice(0, 1500));

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No choices returned from OpenRouter');
    }

    const message = data.choices[0].message;
    console.log('  [DEBUG] message keys:', Object.keys(message));
    if (Array.isArray(message.content)) {
      console.log('  [DEBUG] content types:', message.content.map(p => p.type));
    }

    // Collect image parts from both message.content and message.images
    const imageParts = [];
    if (Array.isArray(message.content)) {
      imageParts.push(...message.content.filter(p => p.type === 'image_url'));
    }
    if (Array.isArray(message.images)) {
      imageParts.push(...message.images.filter(p => p.type === 'image_url'));
    }
    console.log('  [DEBUG] imageParts count:', imageParts.length);

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
        console.log(`  Mockup saved: ${outputPath}`);
        outputPaths.push(outputPath);
        saved = true;
        break;
      }
    }

    if (!saved) {
      const msgContent = JSON.stringify(data.choices[0].message, null, 2).slice(0, 500);
      console.warn(`  Warning: No image in response for mockup ${i + 1}. Response: ${msgContent}`);
    }
  }

  if (outputPaths.length === 0) {
    const lastData = 'Check server terminal for full response';
    throw new Error('No mockups were generated - Gemini returned no images. ' + lastData);
  }

  return outputPaths;
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const designIdx = args.indexOf('--design');
  const mockupsIdx = args.indexOf('--mockups');
  const skuIdx = args.indexOf('--sku');

  if (designIdx === -1 || mockupsIdx === -1) {
    console.error('Usage: node compose-mockup.js --design <image> --mockups <m1.png,m2.png> [--sku <sku>]');
    process.exit(1);
  }

  const design = args[designIdx + 1];
  const mockups = args[mockupsIdx + 1].split(',');
  const sku = skuIdx !== -1 ? args[skuIdx + 1] : 'test';

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  composeMockup(design, mockups, sku).then(paths => {
    console.log(`  Generated ${paths.length} mockup(s)`);
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

// ── AI-powered background removal (runs locally, no content filtering) ──
let bgRemovalLoaded = false;
let removeBackgroundAI = null;

async function removeBackground(designBuffer) {
  if (!bgRemovalLoaded) {
    const bgModule = await import('@imgly/background-removal-node');
    removeBackgroundAI = bgModule.removeBackground || bgModule.default;
    bgRemovalLoaded = true;
  }

  console.log('  Removing background with AI (local model)...');
  const blob = new Blob([designBuffer], { type: 'image/png' });
  const resultBlob = await removeBackgroundAI(blob);
  const arrayBuffer = await resultBlob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Programmatic mockup composer using Sharp (no AI, no content filtering) ──
async function composeMockupSharp(designPath, mockupPaths, sku, opts) {
  const sharp = require('sharp');
  opts = opts || {};

  if (!fs.existsSync(designPath)) {
    throw new Error(`Design not found: ${designPath}`);
  }

  const designBuffer = fs.readFileSync(designPath);
  const outputPaths = [];
  const scaleFactor = opts.scale || 1.0;

  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) {
      console.warn(`  Warning: Mockup not found, skipping: ${mockupPath}`);
      continue;
    }

    console.log(`  Composing mockup ${i + 1}/${mockupPaths.length} via Sharp...`);

    const mockupMeta = await sharp(mockupPath).metadata();
    const mw = mockupMeta.width;
    const mh = mockupMeta.height;

    // Check for per-template custom position
    const pos = getPositionForTemplate(mockupPath, opts);
    let designWidth, designHeight, left, top;

    if (pos) {
      designWidth = Math.round(pos.w * scaleFactor);
      designHeight = Math.round(pos.h * scaleFactor);
      left = Math.round(pos.x);
      top = Math.round(pos.y);
    } else {
      const baseW = opts.position === 'center' ? 0.50 : 0.50;
      const baseH = opts.position === 'center' ? 0.50 : 0.45;
      const baseTop = opts.position === 'center' ? 0.25 : 0.22;
      designWidth = Math.round(mw * baseW * scaleFactor);
      designHeight = Math.round(mh * baseH * scaleFactor);
      left = Math.round((mw - designWidth) / 2);
      top = Math.round(mh * baseTop);
    }

    // Prepare design buffer - if whiteMode, flatten onto white then use 'over' blend
    let inputBuffer = designBuffer;
    const blendMode = opts.whiteMode ? 'over' : 'multiply';

    if (opts.whiteMode) {
      // Add white background behind design
      const designMeta = await sharp(designBuffer).metadata();
      inputBuffer = await sharp({
        create: { width: designMeta.width, height: designMeta.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } }
      }).composite([{ input: designBuffer, blend: 'over' }]).png().toBuffer();
    }

    const resizedDesign = await sharp(inputBuffer)
      .resize(designWidth, designHeight, {
        fit: 'inside',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'lanczos3',
      })
      .png()
      .toBuffer();

    const resizedMeta = await sharp(resizedDesign).metadata();
    const actualLeft = Math.round(left + (designWidth - resizedMeta.width) / 2);
    const actualTop = Math.round(top + (designHeight - resizedMeta.height) / 2);

    const outputName = `${sku}_mockup${i + 1}.png`;
    const outputPath = path.join(OUTPUT_DIR, outputName);

    await sharp(mockupPath)
      .composite([{
        input: resizedDesign,
        left: actualLeft,
        top: actualTop,
        blend: blendMode,
      }])
      .png()
      .toFile(outputPath);

    console.log(`  Mockup saved: ${outputPath}`);
    outputPaths.push(outputPath);
  }

  if (outputPaths.length === 0) {
    throw new Error('No mockups were generated');
  }

  return outputPaths;
}

// ── Flux.2 Pro mockup composer (no copyright filtering) ──
async function composeMockupFlux(designPath, mockupPaths, sku) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env');
  const productHint = getProductHint();

  if (!fs.existsSync(designPath)) {
    throw new Error(`Design not found: ${designPath}`);
  }

  function readAsBase64(filePath) {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { base64: data.toString('base64'), mime };
  }

  const design = readAsBase64(designPath);
  const outputPaths = [];

  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) {
      console.warn(`  Warning: Mockup not found, skipping: ${mockupPath}`);
      continue;
    }

    const mockup = readAsBase64(mockupPath);
    console.log(`  Composing mockup ${i + 1}/${mockupPaths.length} via Flux.2 Pro...`);

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Etsy Product Creator',
      },
      body: JSON.stringify({
        model: 'black-forest-labs/flux.2-pro',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${design.mime};base64,${design.base64}` },
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mockup.mime};base64,${mockup.base64}` },
              },
              {
                type: 'text',
                text: `First image is a design/graphic. Second image is a product mockup photo.

PRODUCT TYPE: ${productHint.subject}
PLACEMENT AREA: ${productHint.area}
TARGET DESIGN WIDTH: ${productHint.widthPct} of the printable area
PRODUCT-SPECIFIC NOTE: ${productHint.extra}

You MUST place the design onto the ${productHint.subject} mockup. Follow these rules EXACTLY:

POSITION:
- Find the chest area of the t-shirt (the flat front panel between collar and hem).
- Place the design CENTERED horizontally on the chest.
- Place the design in the UPPER-MIDDLE area of the chest (roughly 1/3 from collar, 2/3 from hem).

SIZE:
- The design width should be approximately 60-70% of the t-shirt's chest width (seam to seam). Make it LARGE and prominent.
- Maintain the design's original aspect ratio. Do NOT stretch, squash, or distort.
- The design should look like a bold, large screen-printed graphic.

QUALITY:
- Match the t-shirt's perspective, angle, and any rotation or fold.
- Apply subtle fabric texture, lighting, and wrinkles over the design so it looks naturally printed on the shirt.
- If the design has a white or solid background, remove it — only place the artwork itself.
- Do NOT alter the mockup photo in any way — same background, same colors, same everything. ONLY add the design.
- Do NOT add any borders, frames, or extra elements around the design.

OUTPUT: A single high-quality image of the mockup with the design placed on it.`,
              },
            ],
          },
        ],
        image_config: {
          width: 2048,
          height: 2048,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Flux mockup compose failed: ${errBody}`);
    }

    const data = await response.json();
    console.log('  [DEBUG] Flux mockup response:', JSON.stringify(data, null, 2).slice(0, 500));

    if (!data.choices || data.choices.length === 0) {
      console.warn(`  Warning: No choices for mockup ${i + 1}`);
      continue;
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
        console.log(`  Flux mockup saved: ${outputPath}`);
        outputPaths.push(outputPath);
        saved = true;
        break;
      }
    }

    if (!saved) {
      console.warn(`  Warning: No image in Flux response for mockup ${i + 1}`);
    }
  }

  if (outputPaths.length === 0) {
    throw new Error('No mockups were generated by Flux');
  }

  return outputPaths;
}

// ── High-quality Sharp mockup composer for copyrighted designs ──
async function composeSingleMockupSharp(designPath, mockupPath, outputPath, opts) {
  const sharp = require('sharp');
  opts = opts || {};

  const designBuffer = fs.readFileSync(designPath);
  const mockupMeta = await sharp(mockupPath).metadata();
  const mw = mockupMeta.width;
  const mh = mockupMeta.height;

  const scaleFactor = opts.scale || 1.0;
  const pos = getPositionForTemplate(mockupPath, opts);
  let designWidth, designHeight, left, top;

  if (pos) {
    designWidth = Math.round(pos.w * scaleFactor);
    designHeight = Math.round(pos.h * scaleFactor);
    left = Math.round(pos.x);
    top = Math.round(pos.y);
  } else {
    const baseW = opts.position === 'center' ? 0.50 : 0.50;
    const baseH = opts.position === 'center' ? 0.50 : 0.45;
    const baseTop = opts.position === 'center' ? 0.25 : 0.22;
    designWidth = Math.round(mw * baseW * scaleFactor);
    designHeight = Math.round(mh * baseH * scaleFactor);
    left = Math.round((mw - designWidth) / 2);
    top = Math.round(mh * baseTop);
  }

  // Resize design (high quality lanczos3)
  const resizedDesign = await sharp(designBuffer)
    .resize(designWidth, designHeight, {
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  const resizedMeta = await sharp(resizedDesign).metadata();
  const rw = resizedMeta.width;
  const rh = resizedMeta.height;
  const actualLeft = Math.round(left + (designWidth - rw) / 2);
  const actualTop = Math.round(top + (designHeight - rh) / 2);

  // Smart background removal: white/near-white → transparent with smooth edges
  const { data, info } = await sharp(resizedDesign)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  const w = info.width;
  const h = info.height;

  // Remove white/near-white background pixels
  for (let px = 0; px < pixels.length; px += 4) {
    const r = pixels[px], g = pixels[px + 1], b = pixels[px + 2];
    const brightness = (r + g + b) / 3;
    // Also check saturation — true white has low saturation
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    if (brightness > 248 && saturation < 0.05) {
      pixels[px + 3] = 0; // Pure white → transparent
    } else if (brightness > 230 && saturation < 0.08) {
      // Near-white → gradual transparency
      const alpha = Math.round(((brightness - 230) / 18) * 255);
      pixels[px + 3] = Math.max(0, 255 - alpha);
    }
  }

  const transparentDesign = await sharp(pixels, {
    raw: { width: w, height: h, channels: 4 },
  }).png().toBuffer();

  // Composite design onto mockup (no shadow — keep it clean)
  await sharp(mockupPath)
    .composite([
      {
        input: transparentDesign,
        left: actualLeft,
        top: actualTop,
        blend: 'over',
      },
    ])
    .png()
    .toFile(outputPath);

  return outputPath;
}

// ── Copyrighted mockup composer — Gemini quick try + Sharp guaranteed fallback ──
async function composeMockupCopyrighted(designPath, mockupPaths, sku) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env');
  const productHint = getProductHint();

  if (!fs.existsSync(designPath)) {
    throw new Error(`Design not found: ${designPath}`);
  }

  const designBase64 = fs.readFileSync(designPath).toString('base64');
  const designExt = path.extname(designPath).toLowerCase();
  const designMime = designExt === '.png' ? 'image/png' : designExt === '.webp' ? 'image/webp' : 'image/jpeg';

  const geminiPrompt = `First image is a design/artwork. Second image is a clothing mockup photo.

You MUST place the design onto the t-shirt mockup. Follow these rules EXACTLY:

POSITION:
- Find the chest area of the t-shirt (the flat front panel between collar and hem).
- Place the design CENTERED horizontally on the chest.
- Place the design in the UPPER-MIDDLE area of the chest (roughly 1/3 from collar, 2/3 from hem).

SIZE:
- The design width should be approximately 60-70% of the t-shirt's chest width (seam to seam). Make it LARGE and prominent.
- Maintain the design's original aspect ratio. Do NOT stretch, squash, or distort.
- The design should look like a bold, large screen-printed graphic.

QUALITY:
- Match the t-shirt's perspective, angle, and any rotation or fold.
- Apply subtle fabric texture, lighting, and wrinkles over the design so it looks naturally printed on the shirt.
- If the design has a white or solid background, remove it — only place the artwork itself.
- Do NOT alter the mockup photo in any way — same background, same colors, same everything. ONLY add the design.
- Do NOT add any borders, frames, or extra elements around the design.

OUTPUT: A single high-quality image of the mockup with the design placed on it.`;

  const outputPaths = [];

  for (let i = 0; i < mockupPaths.length; i++) {
    const mockupPath = path.resolve(mockupPaths[i]);
    if (!fs.existsSync(mockupPath)) {
      console.warn(`  Warning: Mockup not found, skipping: ${mockupPath}`);
      continue;
    }

    const outputName = `${sku}_mockup${i + 1}.png`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    let saved = false;

    // Try Gemini once (quick attempt — often refuses copyrighted content)
    console.log(`  Mockup ${i + 1}/${mockupPaths.length}: trying Gemini...`);
    try {
      const mockupBase64 = fs.readFileSync(mockupPath).toString('base64');
      const mockupExt = path.extname(mockupPath).toLowerCase();
      const mockupMime = mockupExt === '.png' ? 'image/png' : mockupExt === '.webp' ? 'image/webp' : 'image/jpeg';

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
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${designMime};base64,${designBase64}` } },
              { type: 'image_url', image_url: { url: `data:${mockupMime};base64,${mockupBase64}` } },
              { type: 'text', text: geminiPrompt },
            ],
          }],
          response_modalities: ['IMAGE', 'TEXT'],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const message = data.choices?.[0]?.message;
        const imageParts = [];
        if (Array.isArray(message?.content)) imageParts.push(...message.content.filter(p => p.type === 'image_url'));
        if (Array.isArray(message?.images)) imageParts.push(...message.images.filter(p => p.type === 'image_url'));

        for (const part of imageParts) {
          if (part.image_url?.url) {
            const url = part.image_url.url;
            let imgBuffer;
            if (url.startsWith('data:')) {
              imgBuffer = Buffer.from(url.split(',')[1], 'base64');
            } else {
              const imgResp = await fetch(url);
              imgBuffer = Buffer.from(await imgResp.arrayBuffer());
            }
            fs.writeFileSync(outputPath, imgBuffer);
            console.log(`  Mockup ${i + 1}: Gemini success!`);
            outputPaths.push(outputPath);
            saved = true;
            break;
          }
        }
      }
    } catch (err) {
      console.warn(`  Mockup ${i + 1}: Gemini error: ${err.message}`);
    }

    // Sharp fallback (guaranteed to work)
    if (!saved) {
      console.log(`  Mockup ${i + 1}: Gemini refused, using Sharp...`);
      try {
        await composeSingleMockupSharp(designPath, mockupPath, outputPath);
        console.log(`  Mockup ${i + 1}: Sharp mockup saved`);
        outputPaths.push(outputPath);
      } catch (sharpErr) {
        console.warn(`  Mockup ${i + 1}: Sharp failed: ${sharpErr.message}`);
      }
    }
  }

  if (outputPaths.length === 0) {
    throw new Error('No copyrighted mockups were generated.');
  }

  return outputPaths;
}

module.exports = { composeMockup, composeMockupSharp, composeMockupFlux, composeMockupCopyrighted, POSITIONS_FILE };
