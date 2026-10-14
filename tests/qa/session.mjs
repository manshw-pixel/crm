import { parseOrgName, assertQaOrg } from "./guard.mjs";
import { GuardError } from "./core.mjs";

export async function signIn(browser, env, role, { viewport } = {}) {
  const creds = env.users[role];
  if (!creds) throw new Error(`no ${role} user configured in .env.qa`);
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  const close = () => context.close();
  try {
    await page.goto(env.baseUrl);
    await page.fill('input[type="email"]', creds.email);
    await page.fill('input[type="password"]', creds.pass);
    await page.getByRole("button", { name: /sign in/i }).click();
    const name = await waitForOrgName(page);
    assertQaOrg(name, env.orgName);
    return { page, context, close, role, env };
  } catch (e) { await close(); throw e; }
}

// Polls the sidebar for up to 15s; a name still "…" at the end is a guard failure, not a pass.
// Scoped to [data-current-org] (src/26-app.jsx) so no other "· " text on the page can match.
async function waitForOrgName(page) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const text = await page.locator("[data-current-org]").first().textContent({ timeout: 2000 }).catch(() => "");
    const name = parseOrgName(text || "");
    if (name) return name;
    await page.waitForTimeout(500);
  }
  return null;
}

export async function signOut(page) {
  await page.getByRole("button", { name: /^sign out$/i }).first().click();
}

export { GuardError };
