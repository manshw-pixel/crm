import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// The BUILT artifact, not the source. The gate exists to verify what actually ships, so
// it loads exactly the bytes CI publishes. Run `node build.mjs` first -- CI does, and
// run.mjs does too. See docs/superpowers/specs/2026-08-17-build-step-design.md
const CRM = fileURLToPath(new URL("../../dist/crm.html", import.meta.url));

// CI runners have no Edge, so use Playwright's bundled Chromium there and the browser
// the team actually uses locally. `??` not `||`: an explicitly empty CRM_TEST_CHANNEL
// must select bundled Chromium, not fall back to msedge.
const CHANNEL = process.env.CRM_TEST_CHANNEL ?? "msedge";

// In-memory Supabase mock: enough surface for load + write-through + realtime stubs,
// plus the auth/profile gate that Root() requires before it will render App().
// Installed as window.__sbFactory, which crm.html consults before building a real
// client. CONFIGURED needs no override -- it already evaluates true from the committed
// constants.
const MOCK = `window.__sbFactory = () => {
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
  // profiles is read three ways: fetchAll() awaits select() directly (wants {data:[...]}),
  // Root() chains select(...).eq(...).single() (wants {data: singleRow}), and the Settings
  // UsersCard chains select(...).order(...) (wants {data:[...]}). Support all three.
  const profilesApi = () => ({
    select: () => {
      const rows = window.__seedRows?.profiles || [window.__seedProfile || { id: "u1", name: "Test User", role: "admin" }];
      const p = Promise.resolve({ data: rows, error: null });
      p.eq = (_col, val) => ({
        single: async () => ({ data: rows.find(r => r.id === val) || rows[0] || null, error: null }),
      });
      p.order = () => Promise.resolve({ data: rows, error: null });
      return p;
    },
  });
  const fromImpl = t => (t === "profiles" ? profilesApi() : api(t));
  return {
    from: fromImpl,
    rpc: (fn, args) => {
      (window.__rpcCalls = window.__rpcCalls || []).push({ fn, args });
      if (fn === "log_error" && window.__logErrorFails) {
        return Promise.reject(new Error("mock log_error rejection"));
      }
      return Promise.resolve({ error: null });
    },
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
};`;

// Stateful variant of MOCK. The default mock throws every write away, which is exactly
// why the persist path (does RESTORE_SNAPSHOT actually write the undo back?) had no
// automated coverage. This one keeps a real store, applies upserts and deletes to it,
// and exposes __dump() so a test can reload the app from what was actually persisted.
// It models the app's contract with Supabase, NOT Supabase itself -- RLS, schema types
// and network failures still need a real backend.
const STATEFUL_MOCK = `window.__sbFactory = () => {
  window.__db = {};
  for (const [t, rows] of Object.entries(window.__seedRows || {})) {
    window.__db[t] = new Map((rows || []).map(r => [r.id, JSON.parse(JSON.stringify(r))]));
  }
  const tbl = t => (window.__db[t] = window.__db[t] || new Map());
  window.__dump = () => {
    const out = {};
    for (const [t, m] of Object.entries(window.__db)) out[t] = [...m.values()];
    return out;
  };
  const rowsOf = t => [...tbl(t).values()];
  // Mirrors merge_row/append_dedup (supabase-setup.sql) against the in-memory row store, so
  // a reload sees exactly what the real function would have persisted. Rows are stored as
  // { id, data, updated_at }; the merge always targets the data column.
  window.__applyMerge = args => {
    const { tbl: t, row_id, patch, appends } = args;
    const existing = tbl(t).get(row_id);
    const data = { ...((existing && existing.data) || {}), ...(patch || {}) };
    for (const [k, incoming] of Object.entries(appends || {})) {
      const base = Array.isArray(data[k]) ? data[k] : [];
      const acc = base.slice();
      for (const item of incoming) {
        const dup = k === "arrEvents" && item && item.id !== undefined
          ? acc.some(e => e && e.id === item.id)
          : acc.some(e => JSON.stringify(e) === JSON.stringify(item));
        if (!dup) acc.push(item);
      }
      data[k] = acc;
    }
    tbl(t).set(row_id, { id: row_id, data, updated_at: new Date().toISOString() });
  };
  const api = t => ({
    select: () => {
      // fetchAll() always selects accounts, so counting there gives one tick per full
      // refetch (the rollback path this mock exists to exercise) without double-counting
      // the other four entity tables it also reads.
      if (t === "accounts") window.__refetches = (window.__refetches || 0) + 1;
      const p = Promise.resolve({ data: rowsOf(t), error: null });
      p.eq = () => Promise.resolve({ data: rowsOf(t), error: null, single: () => Promise.resolve({ data: rowsOf(t)[0] || null, error: null }) });
      return p;
    },
    upsert: async row => { tbl(t).set(row.id, JSON.parse(JSON.stringify(row))); return { error: null }; },
    insert: async rows => { (Array.isArray(rows) ? rows : [rows]).forEach(r => tbl(t).set(r.id, JSON.parse(JSON.stringify(r)))); return { error: null }; },
    delete: () => ({
      eq: async (col, val) => {
        if (col === "id") tbl(t).delete(val);
        // the app cascades with .eq("data->>accountId", id) -- match that JSON path
        else if (col === "data->>accountId") for (const [k, r] of tbl(t)) { if (r.data && r.data.accountId === val) tbl(t).delete(k); }
        return { error: null };
      },
      neq: async () => { tbl(t).clear(); return { error: null }; },
    }),
  });
  const profilesApi = () => ({
    select: () => {
      const rows = window.__seedRows?.profiles || [{ id: "u1", name: "Test User", role: "admin" }];
      const p = Promise.resolve({ data: rows, error: null });
      p.eq = (_col, val) => ({ single: async () => ({ data: rows.find(r => r.id === val) || rows[0] || null, error: null }) });
      p.order = () => Promise.resolve({ data: rows, error: null });
      return p;
    },
  });
  return {
    from: t => (t === "profiles" ? profilesApi() : api(t)),
    // Fault injection for the write-queue tests: window.__rpcFailures rejects the next N
    // calls, window.__rpcDelay adds latency (used to prove same-row writes are serial).
    // Each call is stamped with started/ended so a test can assert non-overlap.
    rpc: (fn, args) => {
      const call = { fn, args, started: Date.now(), ended: null };
      (window.__rpcCalls = window.__rpcCalls || []).push(call);
      if (fn === "log_error" && window.__logErrorFails) {
        return Promise.reject(new Error("mock log_error rejection"));
      }
      const delay = window.__rpcDelay || 0;
      return new Promise(resolve => {
        setTimeout(() => {
          call.ended = Date.now();
          if (window.__rpcFailures > 0) {
            window.__rpcFailures--;
            resolve({ error: { message: "mock rpc failure" } });
            return;
          }
          // Apply the merge locally so a reload sees it, mirroring merge_row's semantics.
          window.__applyMerge && window.__applyMerge(args);
          resolve({ error: null });
        }, delay);
      });
    },
    channel: () => {
      let handler = null;
      const ch = {
        on(_event, _filter, cb) { handler = cb; return ch; },
        subscribe() { return ch; },
      };
      window.__fireRealtime = () => { handler && handler(); };
      return ch;
    },
    removeChannel: () => {},
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1", email: "t@t.io" } } } }),
      getUser: async () => ({ data: { user: { id: "u1", email: "t@t.io" } } }),
      signOut() {},
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  };
};`;

function buildHtml(seedJs, mock) {
  let html = readFileSync(CRM, "utf8");
  // Mock and seed ride in on the same injected script. It sits right after <body>, and
  // the app bootstraps at the end of <body>, so __sbFactory is installed before crm.html
  // decides whether to build a real Supabase client.
  html = html.replace(/<body[^>]*>/, m => `${m}<script>${mock}\n${seedJs}</script>`);
  const dir = mkdtempSync(join(tmpdir(), "crm-health-"));
  const file = join(dir, "crm.html");
  writeFileSync(file, html);
  return "file://" + file.replace(/\\/g, "/");
}

// Launch with a store that survives writes; `reload(page)` re-opens the app seeded from
// whatever was actually persisted, which is the closest an offline harness can get to
// "reload the browser and confirm it stuck".
export async function launchPersistent(seedJs) {
  const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
  const page = await browser.newPage();
  await page.goto(buildHtml(seedJs, STATEFUL_MOCK));
  await page.waitForSelector("#root", { timeout: 15000 });
  const reload = async () => {
    const dumped = await page.evaluate(() => window.__dump());
    await page.goto(buildHtml(`window.__seedRows = ${JSON.stringify(dumped)};`, STATEFUL_MOCK));
    await page.waitForSelector("#root", { timeout: 15000 });
  };
  return { page, browser, reload };
}

export function buildMockedHtml(seedJs) {
  let html = readFileSync(CRM, "utf8");
  // Inject mock + seed just before the app bootstraps. The <body> tag carries a class
  // attribute (<body class="...">), so match the opening tag generically rather than the
  // literal string "<body>".
  html = html.replace(/<body[^>]*>/, m => `${m}<script>${MOCK}\n${seedJs}</script>`);
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

// Rendered-tree text only (excludes the inert babel <script> source, which page.textContent("body")
// would otherwise include, risking false positives on JSX literals that never actually rendered).
export const rootText = page => page.textContent("#root");

export async function launch(seedJs) {
  const url = buildMockedHtml(seedJs);
  const browser = await chromium.launch({ channel: CHANNEL || undefined, headless: true });
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForSelector("#root", { timeout: 15000 });
  return { page, browser };
}
