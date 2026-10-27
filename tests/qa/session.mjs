import { orgNameFromRows, assertQaOrg } from "./guard.mjs";
import { GuardError } from "./core.mjs";

export async function signIn(browser, env, role, { viewport, timeoutMs = 15000 } = {}) {
  const creds = env.users[role];
  if (!creds) throw new Error(`no ${role} user configured in .env.qa`);
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.addInitScript(() => { window.__qaHooks = true; }); // enables QA-only app hooks (e.g. __syncSalesText); production never sets it
  const close = () => context.close();
  try {
    await page.goto(env.baseUrl);
    await page.fill('input[type="email"]', creds.email);
    await page.fill('input[type="password"]', creds.pass);
    await page.getByRole("button", { name: /sign in/i }).click();
    const name = await waitForOrgName(page, timeoutMs, role);
    assertQaOrg(name, env.orgName);
    return { page, context, close, role, env };
  } catch (e) { await close(); throw e; }
}

// Polls up to timeoutMs (15s default) for the user's org name. The sidebar badge is platform-admin only, so we ask the
// app's own Supabase client (`sb`, src/00-core-config.jsx) instead: RLS orgs_select returns exactly
// the signed-in user's own org for non-platform users. Still null at the end is a guard failure.
async function waitForOrgName(page, timeoutMs, role) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    // Sign-in failures render in src/25-auth-admin.jsx as a rose error box; fail fast and plainly
    // (not a GuardError: nothing is wrong with the org). Never include credentials in the message.
    const err = await page.locator("form .bg-rose-50.text-rose-600").first().textContent({ timeout: 200 }).catch(() => null);
    if (err && err.trim()) throw new Error(`sign-in failed for ${role}: ${err.trim()}`);
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
