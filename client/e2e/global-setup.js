import { request } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:5273";
const username = process.env.E2E_USERNAME || "e2e_user";
const password = process.env.E2E_PASSWORD || "e2e-Passw0rd!";
const authFile = "e2e/.auth/user.json";

// Register (or, on a re-run against a persistent stack, log in) a disposable
// account through the API and persist its session cookie so every spec starts
// authenticated. Against the ephemeral stack the DB is fresh each run, so this
// is always a clean registration.
export default async function globalSetup() {
  await mkdir("e2e/.auth", { recursive: true });

  const ctx = await request.newContext({ baseURL });
  await waitForReady(ctx);

  const reg = await ctx.post("/api/auth/register", {
    data: { username, password, email: `${username}@example.test` },
    failOnStatusCode: false,
  });

  // 2xx → registered (session cookie set). 409 → already exists → log in.
  // Anything else → still try logging in before giving up.
  if (!reg.ok()) {
    const login = await ctx.post("/api/auth/login", {
      data: { username, password },
      failOnStatusCode: false,
    });
    if (!login.ok()) {
      throw new Error(`e2e auth failed (register=${reg.status()}, login=${login.status()})`);
    }
  }

  await ctx.storageState({ path: authFile });
  await ctx.dispose();
}

// The stack may still be booting when Playwright starts — poll the cheapest
// public endpoint until the API answers.
async function waitForReady(ctx, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await ctx.get("/api/auth/providers", { failOnStatusCode: false });
      if (r.ok()) return;
    } catch {
      // connection refused — not up yet
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("e2e: API did not become ready in time");
}
