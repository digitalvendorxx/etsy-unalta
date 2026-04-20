const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { runAndDownload } = require('../wiro-client');
const { withRetry } = require('./retry');

const NAME = 'wiro';

function hasKey() {
  const k = process.env.WIRO_API_KEY;
  return !!(k && k !== 'your_key_here' && k !== 'your_wiro_api_key_here');
}

async function generateDesign({ refImagePath, sku, prompt, outputPath }) {
  if (!hasKey()) throw new Error('WIRO_API_KEY not set');
  const defaultPrompt =
    'Generate a very similar design to this reference image. Keep the same style, colors, and composition but make it unique enough to be a new product. Output only the design image on a clean white background, print-ready.';

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await withRetry(
    () =>
      runAndDownload(
        'google/nano-banana-pro',
        {
          prompt: prompt || defaultPrompt,
          aspectRatio: '1:1',
          resolution: '1K',
          safetySetting: 'OFF',
        },
        { inputImage: path.resolve(refImagePath) },
        outputPath,
        { timeoutMs: 240000, intervalMs: 2500 }
      ),
    { attempts: 2, label: 'wiro/image' }
  );

  console.log(`  [wiro] design saved: ${outputPath}`);
  return outputPath;
}

async function chat({ messages, maxTokens = 1024, temperature = 0.7 }) {
  if (!hasKey()) throw new Error('WIRO_API_KEY not set');
  const apiKey = process.env.WIRO_API_KEY;

  const run = async () => {
    const resp = await fetch('https://api.wiro.ai/v1/Run/wiro/wiroai-turkish-llm-9b', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: messages.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n'),
        max_new_tokens: maxTokens,
        temperature,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Wiro LLM run failed (${resp.status}): ${t.slice(0, 300)}`);
    }
    const data = await resp.json();
    if (!data.taskid) throw new Error(`Wiro LLM bad response: ${JSON.stringify(data).slice(0, 200)}`);
    const { pollTask } = require('../wiro-client');
    const task = await pollTask(data.taskid, { timeoutMs: 120000, intervalMs: 2000 });
    const answer = task.outputs?.[0]?.answer || task.outputs?.[0]?.content || task.outputs?.[0]?.url;
    if (!answer) throw new Error(`Wiro LLM no output: ${JSON.stringify(task).slice(0, 300)}`);
    return typeof answer === 'string' ? answer : JSON.stringify(answer);
  };

  return withRetry(run, { attempts: 2, label: 'wiro/llm' });
}

async function vision({ imagePath, prompt, maxTokens = 1024 }) {
  throw new Error('Wiro vision not supported in adapter (use openrouter for vision)');
}

module.exports = { NAME, hasKey, generateDesign, chat, vision };
