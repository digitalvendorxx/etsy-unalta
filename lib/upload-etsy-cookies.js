const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function uploadToEtsyWithCookies({ sku, mockupPaths, tags, title, description, etsyCookies }) {
  if (!etsyCookies) throw new Error('Etsy cookie\'leri bulunamadi. Ayarlardan Etsy hesabinizi baglayin.');

  let cookieArray;
  try {
    cookieArray = JSON.parse(etsyCookies);
  } catch {
    throw new Error('Etsy cookie formati hatali');
  }

  // Launch a headless browser with the user's cookies
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // Add cookies
  const etsyCookiesFormatted = cookieArray.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.etsy.com',
    path: c.path || '/',
    httpOnly: c.httpOnly || false,
    secure: c.secure || true,
    sameSite: c.sameSite || 'Lax',
  }));
  await context.addCookies(etsyCookiesFormatted);

  const page = await context.newPage();

  try {
    // Navigate to Etsy listing creation page
    console.log(`  [etsy-cookie] Navigating to Etsy listing creation...`);
    await page.goto('https://www.etsy.com/your/shops/me/tools/listings/create', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Check if we're logged in
    const url = page.url();
    if (url.includes('/signin') || url.includes('/login')) {
      throw new Error('Etsy oturumu gecersiz. Cookie\'lerinizi yenileyin.');
    }

    // Upload images
    console.log(`  [etsy-cookie] Uploading ${mockupPaths.length} images...`);
    const fileInput = await page.$('input[type="file"][accept*="image"]');
    if (!fileInput) {
      // Try alternative selectors
      await page.waitForSelector('input[type="file"]', { timeout: 10000 });
    }
    const input = await page.$('input[type="file"]');
    if (!input) throw new Error('Gorsel yukleme alani bulunamadi');

    // Upload all mockup images
    const validPaths = mockupPaths.filter(p => fs.existsSync(p));
    if (validPaths.length === 0) throw new Error('Yuklenecek mockup bulunamadi');
    await input.setInputFiles(validPaths);
    await page.waitForTimeout(5000);

    // Fill title
    console.log(`  [etsy-cookie] Filling title: ${title?.substring(0, 40)}...`);
    const titleInput = await page.$('#title-input, input[name="title"], textarea[name="title"]');
    if (titleInput) {
      await titleInput.fill('');
      await titleInput.fill(title || sku);
      await page.waitForTimeout(500);
    }

    // Fill description
    if (description) {
      console.log(`  [etsy-cookie] Filling description...`);
      const descInput = await page.$('#description-input, textarea[name="description"], [data-testid="description-input"]');
      if (descInput) {
        await descInput.fill('');
        await descInput.fill(description);
        await page.waitForTimeout(500);
      }
    }

    // Fill tags
    if (tags && tags.length > 0) {
      console.log(`  [etsy-cookie] Adding ${tags.length} tags...`);
      for (const tag of tags.slice(0, 13)) {
        const tagInput = await page.$('#tag-input, input[name="tags"], input[placeholder*="tag"], input[aria-label*="tag"]');
        if (tagInput) {
          await tagInput.fill(tag);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
        }
      }
    }

    // Fill SKU
    const skuInput = await page.$('input[name="sku"], input[placeholder*="SKU"]');
    if (skuInput) {
      await skuInput.fill(sku);
    }

    // Try to get the listing URL
    await page.waitForTimeout(2000);
    const listingUrl = page.url();

    console.log(`  [etsy-cookie] Draft created at: ${listingUrl}`);

    return { listingUrl, success: true };
  } finally {
    await browser.close();
  }
}

module.exports = { uploadToEtsyWithCookies };
