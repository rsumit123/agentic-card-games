import { test, expect } from '@playwright/test';

test('create, add AI, start, act', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create table' }).click();
  await page.getByRole('button', { name: 'Add player' }).click();
  await page.getByRole('menuitem', { name: 'Easy' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByLabel('Table')).toBeVisible();
  await page.getByRole('button', { name: 'Fold' }).click();
  await expect(page.getByText('Waiting for the table')).toBeVisible();
});
