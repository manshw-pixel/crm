// Shared helpers for Settings > Users (UsersCard, src/25-auth-admin.jsx:338-472). Not a feature:
// its `scenarios` is empty so run.mjs can load it like any other file.
export const scenarios = [];

export const MAIN = 'nav[aria-label="Main"]';
export const nav = (page, name) => page.locator(`${MAIN} button[aria-label="${name}"]`);

export async function openUsersCard(page) {
  await nav(page, "Settings").click();
  // Card title "Users (N)"; the list loads from admin_user_list after mount.
  await page.getByText(/^Users \(\d+\)$/).first().waitFor({ timeout: 15000 });
}

// The user's row: div[data-user-id] whose email line equals `email` (:443-453).
export const userRow = (page, email) =>
  page.locator("div[data-user-id]").filter({ has: page.getByText(email, { exact: true }) });

// Raw sign-in in a fresh context, WITHOUT the org guard (a disabled user's RLS returns no org).
export async function rawSignIn(browser, env, email, pass) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(env.baseUrl);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', pass);
    await page.getByRole("button", { name: /sign in/i }).click();
    return { context, page, close: () => context.close() };
  } catch (e) { await context.close().catch(() => {}); throw e; }
}
