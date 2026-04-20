const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const WIRO_BASE = 'https://api.wiro.ai/v1';

function getApiKey(overrideKey) {
  const key = overrideKey || process.env.WIRO_API_KEY;
  if (!key || key === 'your_key_here') throw new Error('WIRO_API_KEY not set');
  return key;
}

async function runModel(slug, params, files = {}, overrideKey) {
  const apiKey = getApiKey(overrideKey);
  const url = `${WIRO_BASE}/Run/${slug}`;
  const hasFiles = Object.keys(files).length > 0;

  let body, headers = { 'x-api-key': apiKey };

  if (hasFiles) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    for (const [k, filePath] of Object.entries(files)) {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      form.append(k, new Blob([buf], { type: mime }), path.basename(filePath));
    }
    body = form;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(params);
  }

  const resp = await fetch(url, { method: 'POST', headers, body });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Wiro run failed (${resp.status}): ${errText.slice(0, 500)}`);
  }
  const data = await resp.json();
  if (!data.result || !data.taskid) {
    throw new Error(`Wiro run error: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { taskid: data.taskid, socketaccesstoken: data.socketaccesstoken };
}

async function pollTask(taskid, { timeoutMs = 300000, intervalMs = 2000, overrideKey } = {}) {
  const apiKey = getApiKey(overrideKey);
  const url = `${WIRO_BASE}/Task/Detail`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskid }),
    });
    if (!resp.ok) {
      await new Promise(r => setTimeout(r, intervalMs));
      continue;
    }
    const data = await resp.json();
    const task = data.tasklist?.[0];
    if (!task) {
      await new Promise(r => setTimeout(r, intervalMs));
      continue;
    }
    if (task.status === 'task_postprocess_end') {
      if (task.pexit && task.pexit !== '0') {
        throw new Error(`Wiro task failed (pexit=${task.pexit}): ${task.debugoutput || 'no output'}`);
      }
      return task;
    }
    if (task.status === 'task_failed' || task.status === 'task_error') {
      throw new Error(`Wiro task status=${task.status}: ${task.debugoutput || 'no detail'}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Wiro task timeout after ${timeoutMs}ms (taskid=${taskid})`);
}

async function downloadOutput(url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed (${resp.status}): ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}

async function runAndDownload(slug, params, files, destPath, opts = {}) {
  const { taskid } = await runModel(slug, params, files, opts.overrideKey);
  const task = await pollTask(taskid, opts);
  const outputUrl = task.outputs?.[0]?.url;
  if (!outputUrl) throw new Error(`Wiro task had no output: ${JSON.stringify(task).slice(0, 300)}`);
  return downloadOutput(outputUrl, destPath);
}

module.exports = { runModel, pollTask, downloadOutput, runAndDownload };
