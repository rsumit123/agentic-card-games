import { chromium, devices } from '@playwright/test';
const OUT = process.env.SHOT;
const BASE = 'http://127.0.0.1:5173';
const scenarios = ['seats4','seats3-waiting','urgent','sidepot','showdown','uncontested','lost'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
page.on('console', m => { if (m.type()==='error') console.log('  [console error]', m.text().slice(0,160)); });

await page.goto(BASE, { waitUntil: 'networkidle' });
for (const s of scenarios) {
  await page.goto(`${BASE}/tables/7?scenario=${s}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${s}.png` });
  const box = await page.evaluate(() => {
    const felt = document.querySelector('.felt');
    if (!felt) return { error: document.body.innerText.slice(0,300) };
    const f = felt.getBoundingClientRect();
    const badges = [...document.querySelectorAll('.seat-badge')].map(b => {
      const r = b.getBoundingClientRect();
      return { seat: b.dataset.seat, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const comm = document.querySelector('.community')?.getBoundingClientRect();
    const pot = document.querySelector('.pot')?.getBoundingClientRect();
    const bar = document.querySelector('.action-bar')?.getBoundingClientRect();
    const rect = (r) => r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } : null;
    return { viewport: { w: innerWidth, h: innerHeight },
      felt: rect(f), badges, community: rect(comm), pot: rect(pot), actionBar: rect(bar),
      pageScrollH: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth > innerWidth };
  });
  console.log(`\n=== ${s} ===`);
  console.log(JSON.stringify(box, null, 1));
}

// the home screen and the settings sheet
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/home.png` });
const how = page.getByRole('button', { name: /How it works/ });
if (await how.count()) { await how.click(); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/how.png` }); }

await page.goto(`${BASE}/tables/7?scenario=showdown`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/result-overlay.png` });

// raise control open, 4 seats
await page.goto(`${BASE}/tables/7?scenario=seats4`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const raise = page.getByRole('button', { name: /^Raise$/ });
if (await raise.count()) { await raise.click(); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/raise-open.png` }); console.log('\ncaptured raise-open'); }
else console.log('\nno raise button found');
await browser.close();
