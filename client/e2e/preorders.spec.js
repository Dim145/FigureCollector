import { test, expect } from "@playwright/test";

// Structural smoke of the preorder UI: the page loads and the add-preorder
// dialog opens with its figure-search step. (The full create → set balance →
// mark "solde payé" flow is multi-step and left for a follow-up spec.)
test("the preorders page opens the add dialog", async ({ page }) => {
  await page.goto("/collection/preorders");

  // The CTA appears both in the page header and the empty-state panel — either
  // opens the same dialog, so target the first.
  const addBtn = page.getByRole("button", { name: /ajouter une pr[ée]-?commande/i }).first();
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  await expect(page.getByPlaceholder(/rechercher une figurine/i)).toBeVisible();
});
