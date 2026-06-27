import { test, expect } from "@playwright/test";

// Smoke: each primary authenticated route mounts without throwing. We assert
// the `main` landmark is present (the route rendered, not a blank error
// boundary), that we weren't bounced to /login, and that no uncaught exception
// fired. Locale-agnostic — no text/label assertions.
const routes = [
  "/catalogue",
  "/collection",
  "/collection/souhaits", // wishlist
  "/collection/preorders",
  "/insights", // analytics
];

for (const path of routes) {
  test(`renders ${path} without crashing`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    expect(page.url(), "should not redirect to login").not.toContain("/login");
    expect(page.url()).toContain(path);
    expect(errors, `uncaught page errors on ${path}`).toEqual([]);
  });
}
