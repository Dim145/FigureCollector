import { test, expect } from "@playwright/test";

// The user mandates that manual entry always works alongside any external
// metadata source — this is the smoke test for that path.
test("manual figure entry creates a catalogue figure", async ({ page }) => {
  await page.goto("/figures/new");

  const name = `E2E Figure ${Date.now()}`;
  // "Nom" is the only required field. Its label carries a " *" required marker,
  // so match the start rather than an exact "Nom".
  await page.getByLabel(/^Nom/).fill(name);
  await page.getByRole("button", { name: "Créer la fiche" }).click();

  // Success leaves the create form (redirect to the new figure's detail page)
  // and surfaces the name we typed.
  await expect(page).not.toHaveURL(/\/figures\/new$/, { timeout: 10_000 });
  await expect(page.getByText(name)).toBeVisible();
});
