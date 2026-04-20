const path = require('path');
const { chromium } = require('playwright');
const { generateDescription, optimizeTags, generateAltTexts } = require('./optimize');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

async function connectBrowser(port) {
  // First try: maybe browser is already running with CDP
  try {
    return await chromium.connectOverCDP(`http://localhost:${port}`);
  } catch (e) {
    // Not running with CDP
  }

  const fs = require('fs');
  const { exec, spawn } = require('child_process');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const browserPath = config.operaPath || 'C:/Users/berka/AppData/Local/Programs/Opera GX/opera.exe';

  // Kill existing Opera instances that don't have CDP enabled
  console.log(`  Closing existing Opera instances...`);
  await new Promise((resolve) => {
    exec('powershell -Command "Get-Process opera -ErrorAction SilentlyContinue | Stop-Process -Force"', () => {
      setTimeout(resolve, 4000);
    });
  });

  console.log(`  Launching Opera with CDP on port ${port}...`);
  const child = spawn(browserPath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for browser to start accepting CDP connections
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      return await chromium.connectOverCDP(`http://localhost:${port}`);
    } catch (e) {
      // still starting up
    }
  }
  return null;
}

async function scrapeTags(competitorUrl) {
  const fs = require('fs');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const port = config.cdpPort || 9333;

  console.log(`  Connecting to browser on port ${port}...`);
  const browser = await connectBrowser(port);
  if (!browser) throw new Error('Could not connect to browser via CDP');

  try {
    const context = browser.contexts()[0];
    const pages = context.pages();
    let page = pages.find(p => p.url().includes('etsy.com/listing'))
             || pages.find(p => p.url().includes('etsy.com'))
             || pages[0];

    if (!page) throw new Error('No browser page found');

    // Navigate to competitor listing
    console.log(`  Opening: ${competitorUrl}`);
    await page.goto(competitorUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Wait for Alura extension element
    console.log('  Waiting for Alura...');
    for (let i = 0; i < 20; i++) {
      try {
        const found = await page.evaluate(() => !!document.querySelector('alura-chrome-extension'));
        if (found) break;
      } catch (e) { /* page navigating */ }
      await page.waitForTimeout(1500);
    }

    // Click the listing-specific Alura launcher to open the panel
    console.log('  Opening Alura listing report...');
    await page.evaluate(() => {
      const btn = document.querySelector('.ae_launcher-listing:not(.hide)')
               || document.querySelector('button.custom-alura-launcher-listi');
      if (btn) btn.click();
    }).catch(() => {});

    // Wait for Alura to load listing data
    console.log('  Waiting for Alura to load listing data...');
    await page.waitForTimeout(20000);

    // Click "Details" tab
    console.log('  Opening Details tab...');
    await page.evaluate(() => {
      const alura = document.querySelector('alura-chrome-extension');
      if (!alura) return;
      alura.querySelectorAll('a.p-badge.is-sidebar-header').forEach(el => {
        if (el.textContent.trim() === 'Details') el.click();
      });
    }).catch(() => {});

    // Wait for tags to appear
    console.log('  Waiting for tags...');
    for (let i = 0; i < 20; i++) {
      try {
        const count = await page.evaluate(() => {
          const alura = document.querySelector('alura-chrome-extension');
          if (!alura) return 0;
          return alura.querySelectorAll('.p-table-text.is-table-text-bold.is-clickable').length;
        });
        if (count > 0) break;
      } catch (e) { /* ignore */ }
      await page.waitForTimeout(3000);
    }

    await page.waitForTimeout(2000);

    // Scrape title from the Etsy listing page
    const title = await page.evaluate(() => {
      const h1 = document.querySelector('h1[data-buy-box-listing-title], h1.wt-text-body-01, h1');
      return h1 ? h1.textContent.trim() : '';
    });
    console.log(`  Found title: ${title.substring(0, 60)}...`);

    // Scrape tags
    const tags = await page.evaluate(() => {
      const tagSet = new Set();
      const alura = document.querySelector('alura-chrome-extension');

      if (alura) {
        alura.querySelectorAll('.p-table-text.is-table-text-bold.is-clickable').forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > 1 && text.length < 60) tagSet.add(text);
        });
      }

      // Fallback: Etsy's own tags
      if (tagSet.size === 0) {
        document.querySelectorAll('a[href*="/search?q="]').forEach(a => {
          const text = a.textContent?.trim();
          if (text && text.length > 1 && text.length < 60) tagSet.add(text);
        });
      }

      return [...tagSet];
    });

    console.log(`  Found ${tags.length} tags`);

    // Generate SEO-optimized title with AI
    console.log('  Generating SEO title with AI...');
    const seoTitle = await generateSEOTitle(title, tags);
    console.log(`  SEO Title: ${seoTitle}`);

    // Optimize using etsy-optimizer logic
    const listing = { title: seoTitle, tags };
    const optimizedTags = optimizeTags(listing);
    const description = generateDescription(seoTitle, tags);
    const altTexts = generateAltTexts(seoTitle, optimizedTags);
    console.log(`  Optimized: ${optimizedTags.length} tags, description ready, ${altTexts.length} alt texts`);

    return { tags: optimizedTags, title: seoTitle, description, altTexts };

  } finally {
    // Don't close the browser
  }
}

// CLI mode
if (require.main === module) {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf('--url');

  if (urlIdx === -1) {
    console.error('Usage: node scrape-tags.js --url <etsy_listing_url>');
    process.exit(1);
  }

  const url = args[urlIdx + 1];
  scrapeTags(url).then(tags => {
    console.log('Tags:', JSON.stringify(tags, null, 2));
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

async function generateSEOTitle(originalTitle, tags) {
  const providers = require('./providers');
  const niche = require('./niche');

  const cleanFallback = () => {
    let t = niche.stripBanned(originalTitle);
    return t
      .replace(/\s*[–—\-|]+\s*/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const nicheAddon = niche.titleSystemRules();

  try {
    const { text } = await providers.chat({
      messages: [
        {
          role: 'user',
          content: `You are an Etsy SEO expert. Rewrite this listing title following the 2025/2026 Etsy SEO rules.

Original title: "${originalTitle}"
Tags: ${tags.slice(0, 10).join(', ')}

${nicheAddon ? 'NICHE CONTEXT:\n' + nicheAddon + '\n\n' : ''}STRICT RULES:
1. UNDER 70 CHARACTERS - natural language, not keyword stuffing
2. Most important product phrase goes FIRST (first 30-40 chars are visible on mobile)
3. Follow this template: [What you're selling], [Key feature], [For whom/occasion]
4. NO word repetition - each word appears only once
5. REMOVE "Gift for her/him/mom/dad" from title (these go in tags only)
6. Use ONLY commas (,) or colons (:) to separate sections. NEVER use dashes (–, —, -) or pipes (|)
7. Be specific and natural, like a human wrote it

GOOD examples:
- Minimalist Sterling Silver Ring for Women, Handmade Boho Gift
- Personalized Leather Wallet for Men, Engraved Anniversary Gift
- Watercolor Cat Portrait, Custom Pet Painting from Photo

Output ONLY the new title, nothing else.`,
        },
      ],
      temperature: 0.6,
      maxTokens: 120,
    });

    let newTitle = (text || '').trim().replace(/^["']|["']$/g, '').trim();
    newTitle = niche.stripBanned(newTitle);
    newTitle = newTitle.replace(/\s*[–—\-|]+\s*/g, ', ').replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim();

    if (newTitle && newTitle.length <= 70 && newTitle.length > 10) return newTitle;
    return cleanFallback();
  } catch (e) {
    console.warn(`  Warning: AI title generation failed (${e.message?.slice(0, 120)}), using original`);
    return cleanFallback();
  }
}

module.exports = { scrapeTags, generateSEOTitle };
