import { test, expect } from '@playwright/test';

test('create, seat a house player, start, act', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create a table/ }).click();
  await page.getByRole('button', { name: 'Create table' }).click();
  await page.getByRole('button', { name: 'Play with an LLM' }).click();
  await page.getByRole('menuitem', { name: /Easy/ }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByLabel('Table', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Call / }).click();
  await expect(page.getByRole('status').filter({ hasText: /Waiting for/ })).toBeVisible();
});

test('sizing a raise offers pot-fraction shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create a table/ }).click();
  await page.getByRole('button', { name: 'Create table' }).click();
  await page.getByRole('button', { name: 'Play with an LLM' }).click();
  await page.getByRole('menuitem', { name: /Easy/ }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  // The sizes are on screen already: raising is one tap on a size, then Raise.
  await expect(page.getByRole('group', { name: 'Bet size shortcuts' })).toBeVisible();
  // Sizes that land on the same chips collapse into one shortcut, so take
  // whichever the blinds leave rather than naming a fraction.
  const shortcuts = page.getByRole('group', { name: 'Bet size shortcuts' }).getByRole('button');
  await expect(shortcuts.first()).toBeVisible();
  await shortcuts.first().click();
  await expect(shortcuts.first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Raise' }).click();
  await expect(page.getByRole('group', { name: 'Bet size shortcuts' })).toBeHidden();
});

test('a four seat table fits a portrait phone', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  await page.goto('/tables/7?scenario=seats4');
  await expect(page.getByLabel('Table', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  // Nothing may sit outside the screen, and nothing may cover the board.
  const boxes = await page.evaluate(() => {
    const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const board = rect(document.querySelector('.community'))!;
    return {
      board: { l: board.left, r: board.right, t: board.top, b: board.bottom },
      seats: [...document.querySelectorAll('.seat-opponent')].map((el) => {
        const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom };
      }),
      width: window.innerWidth,
    };
  });
  for (const seat of boxes.seats) {
    expect(seat.l).toBeGreaterThanOrEqual(0);
    expect(seat.r).toBeLessThanOrEqual(boxes.width);
    const overlaps = seat.r > boxes.board.l && seat.l < boxes.board.r && seat.b > boxes.board.t && seat.t < boxes.board.b;
    expect(overlaps).toBe(false);
  }
});
