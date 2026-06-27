import { test, expect } from "@playwright/test";

const username = process.env.E2E_USERNAME || "e2e_user";

test("the session from global-setup is authenticated", async ({ request }) => {
  const me = await request.get("/api/me");
  expect(me.ok(), "/api/me should answer for the stored session").toBeTruthy();
  // Be tolerant of the exact response shape — just require the username back.
  expect(JSON.stringify(await me.json())).toContain(username);
});

test("an authenticated session reaches the app, not the login screen", async ({ page }) => {
  await page.goto("/");
  // The home dashboard greets the user by name — a locale-agnostic marker that
  // we're authenticated (the login screen would not contain the username).
  await expect(page.getByText(username, { exact: false })).toBeVisible();
  expect(page.url()).not.toContain("/login");
});
