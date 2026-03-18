const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.goto('https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=EN', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  // Get all links on the page
  const links = await page.85579eval('a', els => els.map(e => ({ text: e.innerText.trim(), href: e.href })));
  const apiLinks = links.filter(l => l.text.toLowerCase().includes('api') || l.href.toLowerCase().includes('api'));
  console.log(JSON.stringify(apiLinks, null, 2));
  await browser.close();
})().catch(e => console.error('ERR:', e.message));
