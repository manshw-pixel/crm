import { signOut } from "../session.mjs";
import { openUsersCard, userRow, rawSignIn, nav } from "./_users-card.mjs";

const F = "01-auth";
const MAIN = 'nav[aria-label="Main"]';
// Sign-in errors render as the rose box inside the form (src/25-auth-admin.jsx:50).
const SIGNIN_ERR = "form .bg-rose-50.text-rose-600";
// The disabled gate, src/26-app.jsx:574-580.
const REMOVED = "Your access has been removed.";

export const scenarios = [
  { id: `${F}/admin-sign-in`, feature: F, title: "Admin signs in and sees the Dashboard nav", role: "admin",
    run: async ({ page }) => { await nav(page, "Dashboard").waitFor({ timeout: 15000 }); } },

  { id: `${F}/wrong-password`, feature: F, title: "Wrong password shows an error and no app", role: "admin",
    // Own fresh context, no guard: the admin ctx is only used to reach the browser.
    run: async ({ context, env, runId }) => {
      const s = await rawSignIn(context.browser(), env, env.users.admin.email, `wrong-${runId}`);
      try {
        await s.page.locator(SIGNIN_ERR).first().waitFor({ timeout: 15000 });
        if (await s.page.locator(MAIN).count()) throw new Error("main nav rendered after a wrong password");
      } finally { await s.close(); }
    } },

  { id: `${F}/sign-out`, feature: F, title: "CSM signs out back to the sign-in form", role: "csm",
    run: async ({ page }) => {
      await page.locator(MAIN).waitFor({ timeout: 15000 });
      await signOut(page);
      await page.locator('input[type="email"]').waitFor({ timeout: 15000 });
    } },

  { id: `${F}/disabled-user-blocked`, feature: F, title: "Disabled Lead is blocked; re-enabled Lead signs in", role: "admin",
    run: async ({ page, context, env }) => {
      const lead = env.users.lead;
      await openUsersCard(page);
      const row = userRow(page, lead.email);
      await row.waitFor({ timeout: 15000 });
      if (await row.locator("[data-user-enable-btn]").count())
        throw new Error("QA Lead left DISABLED — re-enable in Settings > Users (found disabled before this scenario)");
      let primary;
      try {
        await row.locator("[data-user-disable-btn]").click();
        await page.locator("[data-confirm-go]").click();
        await row.locator("[data-user-disabled-badge]").waitFor({ timeout: 15000 });
        const s = await rawSignIn(context.browser(), env, lead.email, lead.pass);
        try { await s.page.getByText(REMOVED).waitFor({ timeout: 20000 }); }
        finally { await s.close(); }
      } catch (e) { primary = e; }
      // Restore, always. Failing to restore outranks any primary failure.
      try {
        const enable = row.locator("[data-user-enable-btn]");
        if (await enable.count()) await enable.click();
        await row.locator("[data-user-disable-btn]").waitFor({ timeout: 15000 });
        const s = await rawSignIn(context.browser(), env, lead.email, lead.pass);
        try { await s.page.locator(MAIN).waitFor({ timeout: 20000 }); }
        finally { await s.close(); }
      } catch (e) {
        throw new Error(`QA Lead left DISABLED — re-enable in Settings > Users (${e.message})`);
      }
      if (primary) throw primary;
    } },
];
