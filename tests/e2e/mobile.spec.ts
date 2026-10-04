import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, signIn } from './helpers.js';

test('status page and admin on a phone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 3, name: 'Storefront', exact: true })).toBeVisible();
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await signIn(page);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});
