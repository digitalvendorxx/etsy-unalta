const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const IMAGE_MODEL = 'google/gemini-2.5-flash-image';

const OR_HEADERS = (apiKey) => ({
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'http://localhost:3000',
  'X-Title': 'Etsy Lifestyle Mockup',
});

const SCENE_POOLS = {
  kitchen: [
    'warm kitchen counter with herbs, olive oil bottle, mediterranean feel',
    'marble kitchen island with morning sunlight, fresh bread and linen towel',
    'rustic dark wood kitchen table with a candle and small plant',
    'white subway tile backdrop, wooden cutting board with fresh basil',
    'farmhouse kitchen counter with ceramic jars and dried herbs',
    'modern kitchen island with sleek black surface and warm pendant light',
    'sunlit breakfast nook with coffee cup and croissant nearby',
    'rustic butcher block counter with cast iron and copper pots',
    'cozy kitchen with open shelving of spices and vintage scales',
    'travertine counter with a bowl of lemons and linen cloth',
  ],
  bathroom: [
    'natural stone bathroom vanity with soft towels, spa atmosphere',
    'marble bathroom counter with rolled white towels and eucalyptus sprig',
    'minimalist bathroom shelf with candle and small plant',
    'white ceramic sink surround with amber soap bottle',
    'dark slate bathroom counter with brass fixtures, moody spa look',
    'scandinavian bathroom vanity with wooden accessories',
    'bright bathroom window ledge with fresh flowers',
    'travertine bathroom surround with linen hand towel',
  ],
  desk_office: [
    'light oak wood desk with a green potted plant, scandinavian minimal',
    'walnut desk with open notebook, pen, and warm lamp light',
    'white modern desk with books, reading glasses and coffee',
    'industrial metal desk with leather notebook and brass accents',
    'home office shelf with stacked books and soft daylight',
    'minimalist desk with laptop off to the side, morning light',
  ],
  living_room: [
    'cozy coffee table with books and a warm throw blanket visible',
    'rustic wood coffee table with open hardcover book and candle',
    'modern side table next to a linen sofa, soft ambient lighting',
    'fireplace mantle with warm ambient glow, winter cozy',
    'mid-century sideboard with a vase of branches and vintage frame',
    'round coffee table with magazines and a steaming mug',
  ],
  bedroom: [
    'vintage wooden tray on white bedding, lifestyle morning scene',
    'nightstand with open book, brass lamp glow, and linen sheets',
    'boho bedroom dresser with dried flowers and jewelry dish',
    'sunlit bed with wrinkled white linen and coffee cup',
    'minimalist bedside table with small plant and reading glasses',
  ],
  dining: [
    'elegant dining table with fresh flowers in a vase, dinner setting',
    'rustic wooden dining table with linen runner and candlesticks',
    'set dinner table with wine glass and soft candlelight',
    'brunch table with fresh fruit, pastries and fresh flowers',
    'formal dining surface with silverware and cloth napkin',
  ],
  outdoor: [
    'outdoor wooden table with garden bokeh and golden hour sunlight',
    'woven picnic blanket on green grass, dappled sunlight',
    'patio table with greenery background and iced drink',
    'weathered garden bench with wildflowers and morning dew',
    'terracotta tile surface with small succulents, bohemian warm',
  ],
  jewelry: [
    'dark velvet fabric draped surface with warm accent lighting, gift presentation style',
    'marble jewelry dish with soft diffused light and rose petals',
    'cream silk fabric with pearl accents, luxury editorial style',
    'open vintage jewelry box on a wooden vanity, soft light',
    'black velvet pad with spotlight, high-end jewelry display',
    'soft pink satin surface with golden hour window light',
  ],
  clothing: [
    'wooden hanger against a neutral wall with soft window light',
    'folded on a linen chair with natural daylight',
    'flat lay on white bedsheet with coffee and sunglasses',
    'hung on a vintage clothing rack with boutique vibes',
    'wooden mannequin with plants in the background',
  ],
  wall_art: [
    'bright modern living room wall with linen sofa and indoor plant in the foreground',
    'bedroom wall above a minimalist nightstand with warm lamp glow',
    'scandinavian hallway wall with wooden bench and coat rack',
    'cozy reading nook wall next to a leather armchair and throw blanket',
    'entryway wall with a wooden console table, vase of branches and key dish',
    'home office wall behind a walnut desk with open books',
  ],
  decor_general: [
    'clean white marble surface with minimal shadows, modern and elegant',
    'warm marble countertop with morning sunlight and dried eucalyptus',
    'rustic dark wood table with soft window light and candle',
    'dark slate surface with dramatic side lighting, moody luxury aesthetic',
    'concrete surface with architectural shadows, industrial modern',
    'windowsill scene with soft rain light, atmospheric and moody',
    'artisan workshop bench with natural textures, handcrafted feel',
    'beach house weathered wood table, seashells nearby, coastal light',
    'glass shelf with soft backlighting, modern retail display',
  ],
};

function pickScenePool(desc) {
  const t = (desc || '').toLowerCase();
  if (/wall.art|poster|canvas|print|painting|tablo|poster|kanvas|duvar/.test(t)) return 'wall_art';
  if (/kitchen|cook|chef|spatula|utensil|cutting.board|apron|pot.holder|oven.mitt|coaster|trivet|towel.holder|paper.towel|spice|salt|pepper|olive.oil|recipe|mug|cup|tea|coffee|bowl|plate|mutfak|kupa|kase|tabak/.test(t)) return 'kitchen';
  if (/bathroom|bath|shower|soap|towel|toothbrush|vanity|spa|toilet|banyo|havlu/.test(t)) return 'bathroom';
  if (/desk|office|pen|notebook|journal|laptop|mouse.pad|monitor|bookend|planner|calendar|ofis|defter/.test(t)) return 'desk_office';
  if (/living.room|sofa|couch|throw|pillow|blanket|coffee.table|fireplace|mantel|mantle|salon|şömine|somine|yastık/.test(t)) return 'living_room';
  if (/bedroom|bed|nightstand|sheet|duvet|lamp|yatak|nevresim/.test(t)) return 'bedroom';
  if (/dining|dinner|placemat|napkin|centerpiece|candlestick|tablecloth|yemek.masası/.test(t)) return 'dining';
  if (/garden|outdoor|patio|porch|yard|lawn|picnic|bbq|grill|bahçe|bahce/.test(t)) return 'outdoor';
  if (/necklace|ring|earring|bracelet|jewelry|pendant|charm|brooch|anklet|kolye|küpe|yüzük/.test(t)) return 'jewelry';
  if (/shirt|tee|tshirt|hoodie|sweater|sweatshirt|dress|pants|hat|cap|scarf|clothing|apparel|tişört|elbise|şapka/.test(t)) return 'clothing';
  return 'decor_general';
}

function readAsBase64(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { base64: buf.toString('base64'), mime };
}

async function geminiGenerateImage({ imageParts, prompt, apiKey }) {
  const content = imageParts.map(img => ({
    type: 'image_url',
    image_url: { url: `data:${img.mime};base64,${img.base64}` },
  }));
  content.push({ type: 'text', text: prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  let response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: OR_HEADERS(apiKey),
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: 'user', content }],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Image gen failed (${response.status}): ${errBody.slice(0, 400)}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('No message from image model');

  const allParts = [];
  if (Array.isArray(message.content)) allParts.push(...message.content.filter(p => p.type === 'image_url'));
  if (Array.isArray(message.images)) allParts.push(...message.images.filter(p => p.type === 'image_url'));

  for (const part of allParts) {
    const url = part.image_url?.url;
    if (!url) continue;
    if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
    const r = await fetch(url);
    return Buffer.from(await r.arrayBuffer());
  }
  return null;
}

async function toSquareBuffer(buffer) {
  const meta = await sharp(buffer).metadata();
  const size = Math.min(meta.width || 1024, meta.height || 1024);
  return sharp(buffer)
    .resize(size, size, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();
}

function buildPrompt({ productDesc, scene, mode, idx, total }) {
  if (mode === 'bg-replace') {
    return `Edit this product photo: REPLACE ONLY THE BACKGROUND. The product in the image is a ${productDesc}.

NEW BACKGROUND: ${scene}

CRITICAL RULES:
1. DO NOT touch, modify, reshape, recolor, or redraw the product itself. The product must remain PIXEL-PERFECT identical to the input photo.
2. ONLY replace the background/surroundings behind and around the product.
3. Make the lighting on the new background match naturally with the product.
4. Add small contextual props around (not on top of) the product to create a lifestyle Etsy listing look.
5. Square 1:1 output.
6. DO NOT add any text, watermarks, labels, or logos.

This is an IMAGE EDITING task, not image generation. Keep the product untouched, change everything else.`;
  }
  return `These images show a product (${productDesc}). Create a professional Etsy listing mockup photo. This is mockup ${idx} of ${total} -- each one must have a unique styled background, never repeat.

SCENE: ${scene}

The mockup must look like a top-selling Etsy shop's listing photo -- warm natural lighting, lifestyle-styled with complementary props and textures, cozy and inviting atmosphere. The product is the hero of the image.

RULES:
1. Square 1:1 output.
2. The product MUST be placed dead center of the image.
3. Keep the product EXACTLY as it is -- do NOT alter, redesign, or modify it in any way.
4. DO NOT add any text, labels, watermarks, tags, or writing of any kind.
5. DO NOT add logos or branding.

Output a single high-quality Etsy mockup image.`;
}

async function generateLifestyleMockups({ productImagePath, productImagePaths, productDescription, sku, count = 10, mode = 'bg-replace', onProgress }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const imagePaths = Array.isArray(productImagePaths) && productImagePaths.length
    ? productImagePaths
    : (productImagePath ? [productImagePath] : []);
  if (imagePaths.length === 0) throw new Error('No product image provided');

  const poolKey = pickScenePool(productDescription);
  const scenes = SCENE_POOLS[poolKey];
  onProgress?.({ type: 'step-start', step: 'scene', message: `Kategori: ${poolKey} (${scenes.length} sahne)` });
  onProgress?.({ type: 'step-done', step: 'scene', message: `Kategori: ${poolKey}`, pool: poolKey, scenes });

  const imgParts = imagePaths.map(readAsBase64);
  const outputs = [];
  const concepts = [];

  for (let i = 0; i < count; i++) {
    const scene = scenes[i % scenes.length];
    concepts.push({ angle: `scene ${i + 1}`, scene });
    onProgress?.({ type: 'mockup-start', idx: i + 1, total: count, angle: `#${i + 1}`, scene });
    const primary = imgParts[i % imgParts.length];
    const refs = imgParts.length > 1
      ? [primary, ...imgParts.filter(p => p !== primary).slice(0, 2)]
      : [primary];
    const prompt = buildPrompt({ productDesc: productDescription, scene, mode, idx: i + 1, total: count });
    try {
      const imgBuffer = await geminiGenerateImage({ imageParts: refs, prompt, apiKey });
      if (!imgBuffer) throw new Error('Model did not return an image');
      const squared = await toSquareBuffer(imgBuffer);
      const outName = `${sku}_mockup${String(i + 1).padStart(2, '0')}.png`;
      const outPath = path.join(OUTPUT_DIR, outName);
      fs.writeFileSync(outPath, squared);
      const relPath = '/output/' + outName;
      outputs.push(relPath);
      onProgress?.({ type: 'mockup-done', idx: i + 1, total: count, path: relPath, angle: `#${i + 1}`, scene });
    } catch (err) {
      console.warn(`[lifestyle-mockup] idx=${i + 1} failed: ${err.message}`);
      onProgress?.({ type: 'mockup-error', idx: i + 1, total: count, error: err.message, angle: `#${i + 1}` });
    }
  }

  return { outputs, concepts, pool: poolKey };
}

module.exports = { generateLifestyleMockups, pickScenePool, SCENE_POOLS };
