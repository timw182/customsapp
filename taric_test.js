const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  const captured = {};
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('goodsresult') || (url.includes('measures') && !url.includes('.css') && !url.includes('.js') && !url.includes('deferred'))) {
      try { captured[url] = (await resp.text()).substring(0,8000); } catch(e){}
    }
  });

  await page.goto('https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=EN', 
    { waitUntil: 'load', timeout: 30000 });

  await page.waitForTimeout(2000);

  // Fill in CN code
  await page.locator('[name="Taric"]').fill('84713000');

  // Click search button
  await page.locator('[name="searchGoods"]').click().catch(async () => {
    await page.keyboard.press('Enter');
  });
  
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await page.waitForTimeout(5000);

  const bodyText = await page.innerText('body');
  const lines = bodyText.split('\n').filter(l => l.trim().length > 3).slice(0, 80);
  console.log(lines.join('\n'));
  console.log('\nCaptured URLs:', JSON.stringify(Object.keys(captured)));
  if(Object.values(captured).length > 0) {
    const firstData = Object.values(captured)[0];
    const clean = firstData.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    console.log('\nFirst captured data:', clean.substring(0,2000));
  }

  await browser.close();
})().catch(e => console.error('ERR:', e.message));
