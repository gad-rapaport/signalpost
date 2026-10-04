import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, signIn } from './helpers.js';

async function addMonitor(page: Page, name: string, url: string) {
  await page.goto('/admin/monitors/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('URL', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Add monitor' }).click();
}

async function deleteMonitor(page: Page) {
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByRole('link', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Delete monitor' }).click();
  await expect(page.getByRole('status')).toHaveText('Monitor deleted.');
}

test('public status page lists services without exposing URLs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const name of ['Storefront', 'Orders API', 'Sign-in service']) {
    await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
  }
  await expect(page.getByText('demo-api')).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Orders API, daily uptime for the last 30 days' }).getByRole('listitem'),
  ).toHaveCount(30);
  await expectNoAxeViolations(page);
});

test('sign in, see live monitors and every admin page passes axe', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('row', { name: /Orders API/ })).toContainText(/Operational|Degraded/);
  await expectNoAxeViolations(page);
  for (const [link, heading] of [
    ['Incidents', 'Incidents'],
    ['Settings', 'Settings'],
    ['Audit log', 'Audit log'],
  ]) {
    await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoAxeViolations(page);
  }
  await expect(page.getByRole('cell', { name: 'session.login' }).first()).toBeVisible();
});

test('the outbound policy blocks internal targets when saving', async ({ page }) => {
  await signIn(page);
  for (const [url, message] of [
    ['http://169.254.169.254/latest/meta-data/', 'is not on the outbound allowlist'],
    ['http://localhost:3105/admin', 'is not on the outbound allowlist'],
    ['file:///etc/passwd', 'Only http and https URLs'],
    ['http://demo-api:22/', 'Port 22 is not allowed'],
  ]) {
    await addMonitor(page, 'Probe', url!);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(message!);
    await expect(page.getByLabel('URL', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  }
  await expectNoAxeViolations(page);
});

test('an allowed host that redirects to the metadata address is reported, not followed', async ({ page }) => {
  await signIn(page);
  await addMonitor(page, 'Redirect probe', 'http://demo-api:8080/moved');
  await expect(page.getByRole('status')).toContainText('Monitor added.');
  await page.getByRole('button', { name: 'Check now' }).click();
  const latest = page.getByRole('region', { name: 'Recent checks' }).getByRole('row').nth(1);
  await expect(latest).toContainText('redirect');
  await expect(latest).toContainText('Redirect not followed (to http://169.254.169.254/latest/meta-data/)');
  await expect(latest).toContainText('302');
  await deleteMonitor(page);
});

test('check now, pause and resume a monitor', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Sign-in service', exact: true }).click();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status')).toContainText('Check finished');
  await expect(page.getByRole('region', { name: 'Recent checks' }).getByRole('row').nth(1)).toContainText(
    'OK',
  );
  await expect(page.getByRole('figure')).toContainText('median');
  await page.goto('/admin');
  const row = page.getByRole('row', { name: /Sign-in service/ });
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('row', { name: /Sign-in service/ })).toContainText('Paused');
  await page
    .getByRole('row', { name: /Sign-in service/ })
    .getByRole('button', { name: 'Resume' })
    .click();
  await expect(page.getByRole('row', { name: /Sign-in service/ })).toContainText('No data yet');
});

test('a manual incident shows on the status page until resolved', async ({ page }) => {
  const title = `Card payments delayed ${Date.now()}`;
  await signIn(page);
  await page.goto('/admin/incidents/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Affected service').selectOption({ label: 'Orders API' });
  await page.getByLabel('Impact').selectOption('degraded');
  await page.getByLabel('Message').fill('Some payments take a few minutes to confirm.');
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByRole('status')).toHaveText('Incident posted.');
  const incidentUrl = page.url();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Active incidents' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: title })).toContainText('Investigating');

  await page.goto(incidentUrl);
  await page.getByLabel('Status').selectOption('resolved');
  await page.getByLabel('Message').fill('All payments confirmed.');
  await page.getByRole('button', { name: 'Post update' }).click();
  await page.goto('/');
  await expect(page.getByRole('article').filter({ hasText: title })).toContainText('Resolved');
});

test('sessions and CSRF', async ({ page, request }) => {
  // No session: admin pages redirect, posts are refused.
  const res = await request.post('/admin/monitors/1/pause', { form: { _csrf: 'x' }, maxRedirects: 0 });
  expect(res.status()).toBe(403);
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('headers, health and disabled integrations', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("script-src 'none'");
  expect(h['x-frame-options']).toBe('SAMEORIGIN');
  expect(h['cache-control']).toBe('no-store');
  expect((await request.get('/healthz')).status()).toBe(200);
  expect(await (await request.get('/readyz')).json()).toEqual({ status: 'ready' });
  // Metrics are off unless METRICS_TOKEN is configured.
  expect([401, 404]).toContain((await request.get('/metrics')).status());
  const json = await (await request.get('/api/status.json')).json();
  expect(json.components.length).toBeGreaterThanOrEqual(3);
});
