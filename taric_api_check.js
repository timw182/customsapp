const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=EN', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  // Click the New TARIC APIs link
  const link = await page.locator('text=Click here for details').first();
  const href = await link.getAttribute('href').catch(() => null);
  console.log('API docs link:', href);
  if (href) {
    await page.goto(href.startsWith('http') ? href : 'https://ec.europa.eu' + href, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);
    const text = await page.innerText('body');
    console.log(text.substring(0, 4000));
  }
  await browser.close();
})().catch(e => console.error('ERR:', e.message));
