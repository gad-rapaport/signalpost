import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

/** Regenerates docs/screenshots from the running stack: npm run screenshots */
const dir = 'docs/screenshots';

test('documentation screenshots', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await page.screenshot({ path: `${dir}/status.png`, fullPage: true });

  await signIn(page);
  await page.screenshot({ path: `${dir}/admin-monitors.png` });
  await page.getByRole('link', { name: 'Orders API', exact: true }).click();
  await page.screenshot({ path: `${dir}/monitor-detail.png`, fullPage: true });

  await page.goto('/admin/monitors/new');
  await page.getByLabel('Name').fill('Cloud metadata');
  await page.getByLabel('URL', { exact: true }).fill('http://169.254.169.254/latest/meta-data/');
  await page.getByRole('button', { name: 'Add monitor' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.screenshot({ path: `${dir}/policy-blocked.png` });

  await page.goto('/admin/settings');
  await page.screenshot({ path: `${dir}/settings.png`, fullPage: true });

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(`${baseURL}/`);
  await phone.screenshot({ path: `${dir}/mobile.png` });
  await phone.close();

  const dark = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  await dark.goto(`${baseURL}/`);
  await dark.screenshot({ path: `${dir}/status-dark.png` });
  await dark.close();
});
