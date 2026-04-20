const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadNiche() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return cfg.niche || {};
  } catch {
    return {};
  }
}

function get() {
  return loadNiche();
}

function buildDesignPrompt(userPrompt) {
  const n = loadNiche();
  const parts = [];
  if (userPrompt) parts.push(userPrompt);
  if (n.category) parts.push(`Product category: ${n.category}`);
  if (n.style) parts.push(`Style: ${n.style}`);
  if (n.designPromptExtra) parts.push(n.designPromptExtra);
  if (!userPrompt && !n.designPromptExtra) {
    parts.push(
      'Generate a very similar design to this reference image. Keep the same style, colors, and composition but make it unique enough to be a new product. Output only the design image on a clean white background, print-ready.'
    );
  }
  return parts.join('. ');
}

function titleSystemRules() {
  const n = loadNiche();
  const lines = [];
  if (n.targetAudience) lines.push(`Target audience: ${n.targetAudience}`);
  if (n.category) lines.push(`Product category: ${n.category}`);
  if (Array.isArray(n.keywordSeed) && n.keywordSeed.length) {
    lines.push(`Prefer niche keywords (use naturally, do not stuff): ${n.keywordSeed.join(', ')}`);
  }
  const banned = Array.isArray(n.bannedWords) ? n.bannedWords : [];
  if (banned.length) lines.push(`NEVER use these words: ${banned.join(', ')}`);
  return lines.join('\n');
}

function tagSeed() {
  const n = loadNiche();
  return Array.isArray(n.keywordSeed) ? n.keywordSeed : [];
}

function bannedWords() {
  const n = loadNiche();
  const base = ['comfort colors'];
  const extra = Array.isArray(n.bannedWords) ? n.bannedWords : [];
  return Array.from(new Set([...base, ...extra].map(w => w.toLowerCase())));
}

function descriptionAddon() {
  const n = loadNiche();
  const lines = [];
  if (n.descriptionVoice) lines.push(`Tone: ${n.descriptionVoice}`);
  if (n.targetAudience) lines.push(`Audience: ${n.targetAudience}`);
  if (n.priceHint) lines.push(`Price hint: ${n.priceHint}`);
  if (n.category) lines.push(`Category: ${n.category}`);
  return lines.length ? `\n\nNiche context:\n${lines.join('\n')}` : '';
}

function stripBanned(text) {
  if (!text) return text;
  let out = text;
  for (const w of bannedWords()) {
    const re = new RegExp(`,?\\s*${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*`, 'gi');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

module.exports = {
  get,
  buildDesignPrompt,
  titleSystemRules,
  tagSeed,
  bannedWords,
  descriptionAddon,
  stripBanned,
};
