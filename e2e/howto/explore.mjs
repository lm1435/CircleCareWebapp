// Exploration helper (not part of a take): node e2e/howto/explore.mjs <lang> <outDir>
// Screenshots of every screen the use-on-a-computer video shows, for label checks and banner checks.
import { open } from './browser.mjs';
const [lang = 'en', out = '/tmp'] = process.argv.slice(2);
const { browser, page, st, blocked } = await open({ lang, baseURL: 'http://localhost:5298' });
const shot = async (n) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${lang}-${n}.png` });
  console.log('shot', n, page.url());
};
await page.goto('/');
await shot('01-login');
await page.locator('input[type=email]').fill(st.owner.email);
await page.locator('input[type=password]').fill(st.password);
await page.locator('form button[type=submit]').click();
await page.waitForURL(/circles\//, { timeout: 20000 }).catch(() => {});
await shot('03-after-login');
await page.getByRole('button', { name: st.recipient }).first().click();
await shot('04-switcher-open');
console.log((await page.getByRole('menu').innerText().catch(() => 'no menu')).replace(/\n/g, ' | '));
for (const p of ['calendar', 'meds', 'tasks', 'notes', 'members']) { await page.goto(`/circles/${st.circleId}/${p}`); await shot(`05-${p}`); }
await page.locator('aside, nav').first().evaluate((el) => {
  const sc = [el, ...el.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible');
  if (sc) sc.scrollTop = sc.scrollHeight;
});
await shot('06-sidebar-scrolled');
console.log('blocked', [...new Set(blocked)]);
await browser.close();
