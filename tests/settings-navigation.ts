import type { Page } from '@playwright/test';

/** Exercise the visible native control at the current viewport. */
export async function selectSettingsSection(page: Page, section: string, appearance = false) {
  await page.locator('.settings-navigation').waitFor({state:'visible'});
  const picker = page.getByRole('combobox', { name: 'Settings section', exact: true });
  if (await picker.isVisible()) await picker.selectOption(section);
  else await page.locator(`.settings-section-rail a[href="#${appearance ? 'appearance' : 'settings'}/${section}"]`).click();
}
