import { readFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export function adminPassword(): string {
  const fromEnv = process.env.SEED_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  const match = /^SEED_ADMIN_PASSWORD=(.*)$/m.exec(readFileSync('.env', 'utf8'));
  if (!match) throw new Error('SEED_ADMIN_PASSWORD not found in the environment or .env');
  return match[1]!.trim();
}

export async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill('admin@signalpost.test');
  await page.getByLabel('Password').fill(adminPassword());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Monitors' })).toBeVisible();
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}
