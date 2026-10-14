// Shared helpers for Settings > Users (UsersCard, src/25-auth-admin.jsx:338-472). Not a feature:
// its `scenarios` is empty so run.mjs can load it like any other file.
export const scenarios = [];

export const MAIN = 'nav[aria-label="Main"]';
export const nav = (page, name) => page.locator(`${MAIN} button[aria-label="${name}"]`);

export async function openUsersCard(page) {
  await nav(page, "Settings").click();
  // Card title "Users (N)" renders as "Users (0)" BEFORE admin_user_list returns (useState([]),
  // :339-345), so waiting for any count let callers read an empty list. Wait for a non-zero title
  // whose N equals the rendered rows (the signed-in admin is always listed). Returns N.
  await page.getByText(/^Users \([1-9]\d*\)$/).first().waitFor({ timeout: 15000 });
  const h = await page.waitForFunction(() => {
    const t = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && /^Users \(\d+\)$/.test(e.textContent.trim()));
    const n = t ? +/\d+/.exec(t.textContent)[0] : -1;
    return n > 0 && document.querySelectorAll("div[data-user-id]").length === n ? n : null;
  }, null, { timeout: 15000, polling: 250 });
  return h.jsonValue();
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
