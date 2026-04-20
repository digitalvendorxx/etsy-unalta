async function withRetry(fn, { attempts = 3, baseMs = 800, label = 'op' } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = /(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|fetch failed|5\d\d|timeout)/i.test(
        String(err?.message || err)
      );
      if (!transient || i === attempts) break;
      const delay = baseMs * Math.pow(2, i - 1) + Math.random() * 300;
      console.log(`  [retry/${label}] attempt ${i} failed (${err.message?.slice(0, 120)}), waiting ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { withRetry };
