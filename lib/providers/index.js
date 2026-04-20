const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const wiro = require('./wiro');
const openrouter = require('./openrouter');

const IMAGE_ORDER_DEFAULT = ['wiro', 'openrouter'];
const LLM_ORDER_DEFAULT = ['openrouter', 'wiro'];
const VISION_ORDER_DEFAULT = ['openrouter'];

const adapters = { wiro, openrouter };

function resolveChain(envKey, defaultOrder) {
  const pref = (process.env[envKey] || 'auto').toLowerCase();
  if (pref === 'auto') {
    return defaultOrder.filter(n => adapters[n].hasKey());
  }
  const chain = [pref, ...defaultOrder.filter(n => n !== pref)];
  return chain.filter(n => adapters[n] && adapters[n].hasKey());
}

async function runChain(chain, label, fn) {
  if (chain.length === 0) {
    throw new Error(`No provider available for ${label}. Set WIRO_API_KEY or OPENROUTER_API_KEY in .env.`);
  }
  let lastErr;
  for (const name of chain) {
    try {
      console.log(`  [providers/${label}] try ${name}`);
      const result = await fn(adapters[name]);
      return { provider: name, result };
    } catch (err) {
      lastErr = err;
      console.log(`  [providers/${label}] ${name} failed: ${err.message?.slice(0, 200)}`);
    }
  }
  throw new Error(`All providers failed for ${label}. Last error: ${lastErr?.message}`);
}

async function generateDesign(opts) {
  const chain = resolveChain('IMAGE_PROVIDER', IMAGE_ORDER_DEFAULT);
  const { result, provider } = await runChain(chain, 'image', a => a.generateDesign(opts));
  return { path: result, provider };
}

async function chat(opts) {
  const chain = resolveChain('LLM_PROVIDER', LLM_ORDER_DEFAULT);
  const { result, provider } = await runChain(chain, 'llm', a => a.chat(opts));
  return { text: result, provider };
}

async function vision(opts) {
  const chain = resolveChain('LLM_PROVIDER', VISION_ORDER_DEFAULT);
  const { result, provider } = await runChain(chain, 'vision', a => a.vision(opts));
  return { text: result, provider };
}

function status() {
  return {
    wiro: wiro.hasKey(),
    openrouter: openrouter.hasKey(),
    imageChain: resolveChain('IMAGE_PROVIDER', IMAGE_ORDER_DEFAULT),
    llmChain: resolveChain('LLM_PROVIDER', LLM_ORDER_DEFAULT),
    visionChain: resolveChain('LLM_PROVIDER', VISION_ORDER_DEFAULT),
  };
}

module.exports = { generateDesign, chat, vision, status };
