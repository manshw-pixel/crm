import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const CRM = fileURLToPath(new URL("../../crm.html", import.meta.url));

// In-memory Supabase mock: enough surface for load + write-through + realtime stubs,
// plus the auth/profile gate that Root() requires before it will render App().
const MOCK = `const CONFIGURED = true;
const sb = (() => {
  const api = t => ({
    select: () => {
      const p = Promise.resolve({ data: window.__seedRows?.[t] || [], error: null });
      p.eq = () => Promise.resolve({ data: window.__seedRows?.[t] || [], error: null, single: () => Promise.resolve({ data: (window.__seedRows?.[t] || [])[0] || null, error: null }) });
      return p;
    },
    upsert: async () => ({ error: null }),
    insert: async () => ({ error: null }),
    delete: () => ({ eq: async () => ({ error: null }), neq: async () => ({ error: null }) }),
  });
  // profiles is read two ways: fetchAll() awaits select() directly (wants {data:[...]}),
  // Root() chains select(...).eq(...).single() (wants {data: singleRow}). Support both.
  const profilesApi = () => ({
    select: () => {
      const rows = window.__seedRows?.profiles || [window.__seedProfile || { id: "u1", name: "Test User", role: "admin" }];
      const p = Promise.resolve({ data: rows, error: null });
      p.eq = (_col, val) => ({
        single: async () => ({ data: rows.find(r => r.id === val) || rows[0] || null, error: null }),
      });
      return p;
    },
  });
  const fromImpl = t => (t === "profiles" ? profilesApi() : api(t));
  return {
    from: fromImpl,
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1", email: "t@t.io" } } } }),
      getUser: async () => ({ data: { user: { id: "u1", email: "t@t.io" } } }),
      signOut() {},
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  };
})();`;

export function buildMockedHtml(seedJs) {
  let html = readFileSync(CRM, "utf8");
  // Replace the CONFIGURED + Supabase constructor lines with the mock (CONFIGURED forced true).
  html = html.replace(/const CONFIGURED = [^\n]*\nconst sb = [^\n]*\n/, MOCK + "\n");
  // Inject the seed just before the app bootstraps. crm.html's <body> tag carries a
  // class attribute (<body class="...">), so match the opening tag generically rather
  // than the literal string "<body>".
  html = html.replace(/<body[^>]*>/, m => `${m}<script>${seedJs}</script>`);
  const dir = mkdtempSync(join(tmpdir(), "crm-health-"));
  const file = join(dir, "crm.html");
  writeFileSync(file, html);
  return "file://" + file.replace(/\\/g, "/");
}

export function seedAccount(o = {}) {
  return {
    id: o.id || "t1", name: o.name || "Test Co", tier: "Mid", arr: 100000, currency: "USD",
    industry: "Tech", csm: o.csm || "Priya", startDate: "2025-01-01", renewalDate: "2027-01-01",
    contractStatus: "Active", inputs: o.inputs || { usage: 80, sentiment: 80, tickets: 0, nps: 40 },
    history: o.history || [], inputsUpdatedAt: "2026-07-01",
    ...(o.healthBand !== undefined ? { healthBand: o.healthBand } : {}),
    ...o,
  };
}

export async function launch(seedJs) {
  const url = buildMockedHtml(seedJs);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector("#root", { timeout: 15000 });
  return { page, browser };
}
