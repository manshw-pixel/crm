// Finance extension for the health harness's in-memory Supabase mock.
//
// financeExt is NOT run in Node: harness.mjs serialises it with toString() and injects it
// into the page, so it must be self-contained (no imports, no outer-scope references).
// It wraps whichever base mock is already installed on window.__sbFactory and never edits
// it, so every existing test keeps the exact mock it had.
//
// Adds:
//   window.__mockDb       in-memory tables: profiles, billing_entities, billing_settings,
//                         purchase_orders, po_schedule, invoices
//   from(table)           generic builder: select/eq/order/limit/single/maybeSingle/
//                         insert/update/upsert/delete (+ .select() after a write)
//   rpc(...)              admin_user_list, approve_po, reject_po, cancel_po, create_invoice,
//                         send_invoice, set_invoice_status, attach_invoice_pdf -- same checks
//                         and messages as finance.sql; recorded on window.__rpcCalls
//   storage               buckets "invoices" and "purchase-orders" (window.__mockStorage):
//                         upload, download, createSignedUrl, remove, list, getPublicUrl
//
// It models the app's contract with Supabase, NOT Supabase: no RLS, and only the check
// constraints the UI can trip. Fault injection: window.__sendInvoiceError, and
// window.__selectErrors = { <table>: "message" } makes that table's selects fail.
export function financeExt() {
  const baseFactory = window.__sbFactory;
  window.__sbFactory = () => {
    const sb = baseFactory();
    const clone = x => JSON.parse(JSON.stringify(x));
    const seed = window.__seedRows || {};
    const ORG = "org-a";
    const db = (window.__mockDb = {
      profiles: clone(seed.profiles || [{ id: "u1", name: "Test User", role: "admin", org_id: ORG, platform_admin: false, disabled: false, finance: false, email: "t@t.io" }]),
      billing_entities: clone(seed.billing_entities || []),
      billing_settings: clone(seed.billing_settings || []),
      purchase_orders: clone(seed.purchase_orders || []),
      po_schedule: clone(seed.po_schedule || []),
      invoices: clone(seed.invoices || []),
    });
    let n = 0;
    const uid = p => p + "-" + ++n;
    const DEFAULTS = {
      billing_entities: () => ({ id: uid("ent"), org_id: ORG, address: "", state: "", tax_id: "", tax_id_label: "", bank_details: "", logo_path: null, next_number: 1, default_tax_pct: 0, lut_number: null, created_at: new Date(Date.now() + n).toISOString() }),
      billing_settings: () => ({ org_id: ORG, sender_email: "support@onevio.in", sender_name: "OneVio Billing" }),
      purchase_orders: () => ({ id: uid("po"), org_id: ORG, status: "submitted", submitted_by: "u1", reviewed_by: null, reviewed_at: null, reject_reason: null, created_at: new Date().toISOString() }),
    };
    const PK = { billing_settings: "org_id" };
    const CHECKS = {
      billing_entities: r => {
        if (!r.name) return "null value in column \"name\" violates not-null constraint";
        if (["IN", "US", "PH"].indexOf(r.country) < 0) return "violates check constraint \"billing_entities_country_check\"";
        if (["INR", "USD", "PHP"].indexOf(r.currency) < 0) return "violates check constraint \"billing_entities_currency_check\"";
        if (!r.invoice_prefix) return "null value in column \"invoice_prefix\" violates not-null constraint";
        return null;
      },
    };
    const builder = t => {
      const f = { filters: [], order: null, limit: null, op: "select", payload: null, conflict: null, wantRows: false, one: null };
      const run = () => {
        const rows = db[t];
        const match = r => f.filters.every(x => x[2] === "in" ? x[1].map(String).includes(String(r[x[0]])) : String(r[x[0]]) === String(x[1]));
        const fin = (data, error) => {
          if (error) return { data: null, error: { message: error } };
          if (f.one) {
            const arr = Array.isArray(data) ? data : data == null ? [] : [data];
            if (arr.length === 1) return { data: clone(arr[0]), error: null };
            if (f.one === "maybe" && arr.length === 0) return { data: null, error: null };
            return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
          }
          return { data: data == null ? null : clone(data), error: null };
        };
        if (f.op === "select") {
          if (window.__selectErrors && window.__selectErrors[t]) return fin(null, window.__selectErrors[t]);
          let out = rows.filter(match);
          if (f.order) { const k = f.order[0], asc = f.order[1]; out = out.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); }
          if (f.limit != null) out = out.slice(0, f.limit);
          return fin(out);
        }
        if (f.op === "insert" || f.op === "upsert") {
          const key = f.conflict || PK[t] || "id";
          const done = [];
          for (const r of Array.isArray(f.payload) ? f.payload : [f.payload]) {
            const existing = f.op === "upsert" ? rows.find(x => x[key] !== undefined && x[key] === r[key]) : null;
            const row = existing ? Object.assign(existing, r) : Object.assign(DEFAULTS[t] ? DEFAULTS[t]() : { id: uid(t) }, r);
            const bad = CHECKS[t] && CHECKS[t](row);
            if (bad) return fin(null, bad);
            if (!existing) rows.push(row);
            done.push(row);
          }
          return fin(f.wantRows ? done : null);
        }
        if (f.op === "update") {
          const hit = rows.filter(match);
          hit.forEach(r => Object.assign(r, f.payload));
          const bad = CHECKS[t] && hit.map(CHECKS[t]).find(Boolean);
          if (bad) return fin(null, bad);
          return fin(f.wantRows ? hit : null);
        }
        if (f.op === "delete") { db[t] = rows.filter(r => !match(r)); return fin(null); }
        return fin(null, "unsupported op");
      };
      const b = {
        select() { if (f.op !== "select") f.wantRows = true; return b; },
        insert(p) { f.op = "insert"; f.payload = p; return b; },
        update(p) { f.op = "update"; f.payload = p; return b; },
        upsert(p, o) { f.op = "upsert"; f.payload = p; f.conflict = o && o.onConflict; return b; },
        delete() { f.op = "delete"; return b; },
        eq(c, v) { f.filters.push([c, v]); return b; },
        in(c, vs) { f.filters.push([c, vs, "in"]); return b; },
        order(c, o) { f.order = [c, !(o && o.ascending === false)]; return b; },
        limit(k) { f.limit = k; return b; },
        single() { f.one = "single"; return b; },
        maybeSingle() { f.one = "maybe"; return b; },
        then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
      };
      return b;
    };
    // profiles keeps the base mock's read shapes (bare await, .eq().single(), .order()) but
    // reads and writes __mockDb. Rows carry email for admin_user_list; a real select never
    // returns it.
    const profilesBuilder = () => {
      const b = builder("profiles");
      b.select = () => {
        const p = Promise.resolve({ data: clone(db.profiles), error: null });
        p.eq = (c, v) => builder("profiles").eq(c, v).single();
        p.order = () => Promise.resolve({ data: clone(db.profiles), error: null });
        return p;
      };
      return b;
    };
    const baseFrom = sb.from;
    sb.from = t => (t === "profiles" ? profilesBuilder() : db[t] ? builder(t) : baseFrom(t));

    const me = () => db.profiles.find(p => p.id === "u1");
    const isFinance = () => { const m = me(); return !!m && !m.disabled && (m.role === "admin" || m.finance === true); };
    const fail = message => ({ data: null, error: { message } });
    const ok = data => ({ data: data === undefined ? null : clone(data), error: null });
    const now = () => new Date().toISOString();
    const RPC = {
      admin_user_list: () => ok(db.profiles.map(p => ({ id: p.id, name: p.name, role: p.role, disabled: !!p.disabled, email: p.email || "", finance: !!p.finance }))),
      approve_po: a => {
        if (!isFinance()) return fail("finance access required");
        const po = db.purchase_orders.find(x => x.id === a.p_id);
        if (!po) return fail("purchase order not found");
        if (po.status !== "submitted") return fail("only a submitted PO can be approved");
        const rows = globalThis.buildSchedule(po);
        const am = a.p_amounts;
        if (am) {
          if (am.length !== rows.length) return fail("expected " + rows.length + " amounts");
          if (am.some(x => x == null || x <= 0)) return fail("every amount must be above 0");
          const sum = Math.round(am.reduce((s, x) => s + Number(x), 0) * 100), tot = Math.round(Number(po.po_value) * 100);
          if (sum !== tot && !a.p_confirm_mismatch) return fail("amounts do not add up to the PO value");
        }
        rows.forEach(r => db.po_schedule.push({ id: uid("sch"), org_id: po.org_id || ORG, po_id: po.id, seq: r.seq, period_start: r.period_start, period_end: r.period_end, amount: am ? Number(am[r.seq - 1]) : r.amount, invoice_id: null }));
        Object.assign(po, { status: "approved", reviewed_by: "u1", reviewed_at: now(), reject_reason: null });
        return ok(po);
      },
      reject_po: a => {
        if (!isFinance()) return fail("finance access required");
        if (!String(a.p_reason || "").trim()) return fail("reject reason required");
        const po = db.purchase_orders.find(x => x.id === a.p_id && x.status === "submitted");
        if (!po) return fail("only a submitted PO can be rejected");
        Object.assign(po, { status: "rejected", reviewed_by: "u1", reviewed_at: now(), reject_reason: String(a.p_reason).trim() });
        return ok(po);
      },
      cancel_po: a => {
        if (!isFinance()) return fail("finance access required");
        const po = db.purchase_orders.find(x => x.id === a.p_id && (x.status === "submitted" || x.status === "approved"));
        if (!po) return fail("PO not found or not cancellable");
        Object.assign(po, { status: "cancelled", reviewed_by: "u1", reviewed_at: now() });
        const before = db.po_schedule.length;
        db.po_schedule = db.po_schedule.filter(s => !(s.po_id === po.id && !s.invoice_id));
        return ok(before - db.po_schedule.length);
      },
      create_invoice: a => {
        if (!isFinance()) return fail("finance access required");
        const p = a.p || {};
        const si = db.po_schedule.find(s => s.id === p.schedule_id);
        if (!si) return fail("schedule item not found");
        if (si.invoice_id) return fail("this period is already invoiced");
        const po = db.purchase_orders.find(x => x.id === si.po_id);
        if (!po || po.status !== "approved") return fail("PO is not approved");
        const e = db.billing_entities.find(x => x.id === p.entity_id);
        if (!e) return fail("billing entity not found");
        if (!String(p.sent_to || "").trim()) return fail("billing email required");
        if (!(Number(p.total) > 0)) return fail("total must be above 0");
        if (e.currency !== po.currency) return fail("entity currency " + e.currency + " does not match PO currency " + po.currency);
        const num = e.next_number; e.next_number = num + 1;
        const inv = {
          id: uid("inv"), org_id: e.org_id, po_id: po.id, schedule_id: si.id, account_id: po.account_id, account_name: po.account_name, entity_id: e.id,
          number: e.invoice_prefix + String(num).padStart(4, "0"), issue_date: p.issue_date, due_date: p.due_date, currency: e.currency,
          line_items: p.line_items || [], subtotal: Number(p.subtotal || 0), tax_lines: p.tax_lines || [], tax_note: p.tax_note || null, tax_exempt: !!p.tax_exempt,
          total: Number(p.total), status: "pending", paid_date: null, payment_ref: null, waive_reason: null, status_by: null, status_at: null, pdf_path: null,
          sent_to: String(p.sent_to).trim(), sent_cc: String(p.sent_cc || "").trim() || null, sent_at: null, sent_by: null, created_by: "u1", created_at: now(),
        };
        db.invoices.push(inv);
        si.invoice_id = inv.id;
        return ok(inv);
      },
      send_invoice: a => {
        if (!isFinance()) return fail("finance access required");
        const inv = db.invoices.find(x => x.id === a.p_id);
        if (!inv) return fail("invoice not found");
        if (inv.status === "waived") return fail("invoice is waived");
        if (!String(inv.sent_to || "").trim()) return fail("no recipient");
        if (!a.p_pdf_base64) return fail("pdf required");
        if (window.__sendInvoiceError) return fail(window.__sendInvoiceError);
        Object.assign(inv, { sent_at: now(), sent_by: "u1" });
        return ok(inv);
      },
      set_invoice_status: a => {
        if (!isFinance()) return fail("finance access required");
        if (["pending", "paid", "waived"].indexOf(a.p_status) < 0) return fail("bad status");
        if (a.p_status === "paid" && !a.p_paid_date) return fail("paid date required");
        if (a.p_status === "waived" && !String(a.p_reason || "").trim()) return fail("waive reason required");
        const inv = db.invoices.find(x => x.id === a.p_id);
        if (!inv) return fail("invoice not found");
        Object.assign(inv, {
          status: a.p_status,
          paid_date: a.p_status === "paid" ? a.p_paid_date : null,
          payment_ref: a.p_status === "paid" ? String(a.p_ref || "").trim() || null : null,
          waive_reason: a.p_status === "waived" ? String(a.p_reason).trim() : null,
          status_by: "u1", status_at: now(),
        });
        return ok(inv);
      },
      attach_invoice_pdf: a => {
        if (!isFinance()) return fail("finance access required");
        if (String(a.p_path).split("/")[0] !== ORG) return fail("bad path");
        const inv = db.invoices.find(x => x.id === a.p_id);
        if (!inv) return fail("invoice not found");
        inv.pdf_path = a.p_path;
        return ok(null);
      },
    };
    const baseRpc = sb.rpc;
    sb.rpc = (fn, args) => {
      if (!RPC[fn]) return baseRpc(fn, args);
      (window.__rpcCalls = window.__rpcCalls || []).push({ fn, args });
      return Promise.resolve(RPC[fn](args || {}));
    };

    const store = (window.__mockStorage = { "invoices": new Map(), "purchase-orders": new Map() });
    const baseStorageFrom = sb.storage.from;
    sb.storage = Object.assign({}, sb.storage, {
      from: bucket => {
        const m = store[bucket];
        if (!m) return baseStorageFrom(bucket);
        return {
          upload: async (path, body, opts) => {
            if (bucket === "invoices" && window.__uploadFailOnce) { window.__uploadFailOnce = false; return { data: null, error: { message: "network blip" } }; }
            if (m.has(path) && !(opts && opts.upsert)) return { data: null, error: { message: "The resource already exists" } };
            m.set(path, { body, contentType: (opts && opts.contentType) || (body && body.type) || "application/octet-stream" });
            return { data: { path }, error: null };
          },
          download: async path => {
            const o = m.get(path);
            if (!o) return { data: null, error: { message: "Object not found" } };
            return { data: o.body instanceof Blob ? o.body : new Blob([o.body], { type: o.contentType }), error: null };
          },
          createSignedUrl: async (path, secs) => {
            if (!m.has(path)) return { data: null, error: { message: "Object not found" } };
            return { data: { signedUrl: "https://mock.storage/" + bucket + "/" + path + "?token=t&exp=" + secs }, error: null };
          },
          remove: async paths => { (paths || []).forEach(p => m.delete(p)); return { data: [], error: null }; },
          list: async () => ({ data: [...m.keys()].map(name => ({ name })), error: null }),
          getPublicUrl: path => ({ data: { publicUrl: "https://mock.storage/" + bucket + "/" + path } }),
        };
      },
    });
    return sb;
  };
}
