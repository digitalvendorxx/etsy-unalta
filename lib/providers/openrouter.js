const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { withRetry } = require('./retry');

const NAME = 'openrouter';
const BASE = 'https://openrouter.ai/api/v1';
const HEADERS_EXTRA = {
  'HTTP-Referer': 'http://localhost:3000',
  'X-Title': 'Etsy Product Creator',
};

function hasKey() {
  const k = process.env.OPENROUTER_API_KEY;
  return !!(k && k !== 'your_key_here' && k !== 'your_openrouter_api_key_here');
}

function apiKey() {
  const k = process.env.OPENROUTER_API_KEY;
  if (!hasKey()) throw new Error('OPENROUTER_API_KEY not set');
  return k;
}

function readAsDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function generateDesign({ refImagePath, sku, prompt, outputPath }) {
  const defaultPrompt =
    'Generate a very similar design to this reference image. Keep the same style, colors, and composition but make it unique enough to be a new product. Output only the design image on a clean white background, print-ready.';

  const refAbs = path.resolve(refImagePath);
  if (!fs.existsSync(refAbs)) throw new Error(`Reference image not found: ${refAbs}`);
  const dataUri = readAsDataUri(refAbs);

  const run = async () => {
    const resp = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        ...HEADERS_EXTRA,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUri } },
              { type: 'text', text: prompt || defaultPrompt },
            ],
          },
        ],
        response_modalities: ['IMAGE', 'TEXT'],
      }),
    });
    if (!resp.ok) throw new Error(`OpenRouter image ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('OpenRouter no choices');

    const parts = [];
    if (Array.isArray(msg.content)) parts.push(...msg.content.filter(p => p.type === 'image_url'));
    if (Array.isArray(msg.images)) parts.push(...msg.images.filter(p => p.type === 'image_url'));

    for (const p of parts) {
      const url = p.image_url?.url;
      if (!url) continue;
      let buf;
      if (url.startsWith('data:')) buf = Buffer.from(url.split(',')[1], 'base64');
      else {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Fetch image ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buf);
      return outputPath;
    }
    throw new Error('OpenRouter response had no image');
  };

  await withRetry(run, { attempts: 2, label: 'openrouter/image' });
  console.log(`  [openrouter] design saved: ${outputPath}`);
  return outputPath;
}

async function chat({ messages, model = 'anthropic/claude-3.5-sonnet', maxTokens = 1024, temperature = 0.7 }) {
  const run = async () => {
    const resp = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        ...HEADERS_EXTRA,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    if (!resp.ok) throw new Error(`OpenRouter chat ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('OpenRouter no choices');
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) return msg.content.filter(p => p.type === 'text').map(p => p.text).join(' ');
    throw new Error('OpenRouter chat empty content');
  };
  return withRetry(run, { attempts: 3, label: 'openrouter/chat' });
}

async function vision({ imagePath, prompt, model = 'meta-llama/llama-4-maverick', maxTokens = 1024 }) {
  const dataUri = readAsDataUri(path.resolve(imagePath));
  return chat({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    maxTokens,
  });
}

module.exports = { NAME, hasKey, generateDesign, chat, vision };
