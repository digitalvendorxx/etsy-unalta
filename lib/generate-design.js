const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const providers = require('./providers');
const niche = require('./niche');

const DESIGNS_DIR = path.join(__dirname, '..', 'designs');

async function generateDesign(refImagePath, sku, prompt) {
  const outputPath = path.join(DESIGNS_DIR, `${sku}_design.png`);
  fs.mkdirSync(DESIGNS_DIR, { recursive: true });

  const finalPrompt = niche.buildDesignPrompt(prompt);
  const { path: saved, provider } = await providers.generateDesign({
    refImagePath,
    sku,
    prompt: finalPrompt,
    outputPath,
  });
  console.log(`  design via ${provider}: ${saved}`);
  return saved;
}

async function generateDesignFlux(refImagePath, sku, prompt) {
  const refAbs = path.resolve(refImagePath);
  if (!fs.existsSync(refAbs)) throw new Error(`Reference image not found: ${refAbs}`);

  console.log(`  [flux] step 1: vision describe`);
  const { text: description } = await providers.vision({
    imagePath: refAbs,
    prompt:
      `Describe this t-shirt/product design in extreme detail for an AI image generator. ` +
      `Include every visual element: characters (describe their appearance without using brand/character names - ` +
      `use generic descriptions like "a cartoon mouse with round ears"), poses, art style, colors, ` +
      `text/typography (describe similar but different text), background, composition, mood, line style, shading. ` +
      `Write as a single detailed image generation prompt. No commentary.`,
    maxTokens: 800,
  });

  if (!description) throw new Error('Vision could not describe reference');
  console.log(`  [flux] description: ${description.slice(0, 200)}...`);

  const trimmed = description.slice(0, 800);
  const fluxPrompt = prompt
    ? `${prompt}. ${trimmed}`
    : `T-shirt print design, clean white background, DTF printing ready. ${trimmed}`;

  console.log(`  [flux] step 2: image gen (prompt len: ${fluxPrompt.length})`);
  const outputPath = path.join(DESIGNS_DIR, `${sku}_design.png`);
  fs.mkdirSync(DESIGNS_DIR, { recursive: true });

  const { path: saved, provider } = await providers.generateDesign({
    refImagePath: refAbs,
    sku,
    prompt: fluxPrompt,
    outputPath,
  });
  console.log(`  flux design via ${provider}: ${saved}`);
  return saved;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const refIdx = args.indexOf('--ref');
  const skuIdx = args.indexOf('--sku');
  const promptIdx = args.indexOf('--prompt');
  if (refIdx === -1) {
    console.error('Usage: node generate-design.js --ref <image> [--sku <sku>] [--prompt <text>]');
    process.exit(1);
  }
  const ref = args[refIdx + 1];
  const sku = skuIdx !== -1 ? args[skuIdx + 1] : 'test';
  const prompt = promptIdx !== -1 ? args[promptIdx + 1] : undefined;
  fs.mkdirSync(DESIGNS_DIR, { recursive: true });
  generateDesign(ref, sku, prompt).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

module.exports = { generateDesign, generateDesignFlux };
