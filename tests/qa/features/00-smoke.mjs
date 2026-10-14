// Trivial end-to-end check of the runner itself: sign in as admin and see the main nav.
export const scenarios = [
  { id: "00-smoke/signed-in", feature: "00-smoke", title: "Admin lands on Dashboard", role: "admin",
    run: async ctx => { await ctx.page.locator('nav[aria-label="Main"]').waitFor({ timeout: 15000 }); } },
];
