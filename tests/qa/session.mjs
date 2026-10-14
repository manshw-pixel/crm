import { orgNameFromRows, assertQaOrg } from "./guard.mjs";
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

// Polls up to 15s for the user's org name. The sidebar badge is platform-admin only, so we ask the
// app's own Supabase client (`sb`, src/00-core-config.jsx) instead: RLS orgs_select returns exactly
// the signed-in user's own org for non-platform users. Still null at the end is a guard failure.
async function waitForOrgName(page) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try {
      const rows = await page.evaluate(async () => {
        const { data, error } = await sb.from("orgs").select("name");
        return error ? null : data;
      });
      const name = orgNameFromRows(rows);
      if (name) return name;
    } catch { /* sb not ready yet: keep polling */ }
    await page.waitForTimeout(500);
  }
  return null;
}

// The sidebar button reads "Sign out", or "⎋" with title "Sign out (name)" when collapsed.
export async function signOut(page) {
  await page.locator('button[title^="Sign out"], button:has-text("Sign out")').first().click();
}

export { GuardError };
