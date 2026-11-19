import { test, expect } from '@playwright/test';

test('captura inicial da tela de login', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bem-vindo à sua loja' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('01-login.png'), fullPage: true });
});
