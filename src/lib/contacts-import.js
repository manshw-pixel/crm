// Contacts import planner: pure. Turns sheet rows into a reviewable plan (new / update / same / error)
// plus the exact adds and patches to apply. No window/document/store access.
export const CONTACT_COLUMNS = ["Account", "Name", "Role", "Email", "Champion", "Sentiment", "Send surveys"];
export const CONTACT_DROPDOWNS = {
  Champion: ["Yes", "No"],
  Sentiment: ["Positive", "Neutral", "Negative"],
  "Send surveys": ["Yes", "No"],
};

export function contactTemplateRows(account) {
  const rows = [CONTACT_COLUMNS.slice()];
  if (!account) return rows;
  for (let i = 0; i < 200; i++) rows.push([account.name || "", "", "", "", "", "", ""]);
  return rows;
}

const HEADER_KEYS = {
  account: "account", name: "name", role: "role", email: "email",
  champion: "champion", sentiment: "sentiment", "send surveys": "send",
};
const PATCH_LABELS = { name: "Name", role: "Role", email: "Email", isChampion: "Champion", sentiment: "Sentiment", surveyRecipient: "Send surveys" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normHeader = (h) => String(h == null ? "" : h).toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const cell = (v) => (v == null ? "" : String(v).trim());
const yesNo = (v) => {
  const s = v.toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return "Yes";
  if (["no", "n", "false", "0"].includes(s)) return "No";
  return null;
};

export function planContactImport({ rows, accounts, contacts, lockAccountId = null, newId }) {
  const empty = { new: 0, update: 0, same: 0, error: 0 };
  const header = (rows && rows[0]) || [];
  const col = {};
  header.forEach((h, i) => {
    const k = HEADER_KEYS[normHeader(h)];
    if (k && col[k] === undefined) col[k] = i;
  });
  if (col.account === undefined || col.name === undefined) {
    return { rows: [], counts: { ...empty }, adds: [], patches: [], err: 'The header row needs "Account" and "Name" columns — download the template.' };
  }

  const byNo = new Map();
  const byName = new Map();
  for (const a of accounts) {
    if (a.accountNo != null && String(a.accountNo).trim() !== "") byNo.set(String(a.accountNo).trim(), a);
    const k = String(a.name || "").trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(a);
  }
  const lockAcct = lockAccountId ? accounts.find((a) => a.id === lockAccountId) : null;

  // Pass 1: read cells and resolve accounts.
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r] || [];
    const g = (k) => (col[k] === undefined ? "" : cell(raw[col[k]]));
    const cells = { account: g("account"), name: g("name"), role: g("role"), email: g("email"), champion: g("champion"), sentiment: g("sentiment"), send: g("send") };
    // The template prefills Account on every row, so an Account-only row is an unused row.
    if (Object.entries(cells).every(([k, v]) => k === "account" || v === "")) continue;
    const it = { n: r + 1, cells, acct: null, err: "" };
    const x = cells.account;
    if (!x && lockAcct) it.acct = lockAcct;
    else {
      const cands = byNo.has(x) ? [byNo.get(x)] : byName.get(x.toLowerCase()) || [];
      if (!cands.length) it.err = `Unknown account "${x}"`;
      else if (lockAcct) {
        if (cands.some((a) => a.id === lockAcct.id)) it.acct = lockAcct;
        else it.err = `This import is for ${lockAcct.name} only`;
      } else if (cands.length > 1) it.err = `ambiguous account name "${x}" — use the account #`;
      else it.acct = cands[0];
    }
    items.push(it);
  }

  // Pass 2: duplicate emails inside the file, per account.
  const seen = new Map();
  for (const it of items) {
    if (!it.acct || !EMAIL_RE.test(it.cells.email)) continue;
    it.dupKey = `${it.acct.id}|${it.cells.email.toLowerCase()}`;
    seen.set(it.dupKey, (seen.get(it.dupKey) || 0) + 1);
  }

  const out = [];
  const adds = [];
  const patches = [];
  const counts = { ...empty };
  for (const it of items) {
    const c = it.cells;
    const finish = (status, msg) => { counts[status]++; out.push({ n: it.n, status, cells: c, msg }); };
    if (it.err) { finish("error", it.err); continue; }
    const a = it.acct;
    let champ = null, send = null, sent = "";
    if (c.email && !EMAIL_RE.test(c.email)) { finish("error", "Email is not valid"); continue; }
    if (c.champion) {
      champ = yesNo(c.champion);
      if (!champ) { finish("error", "Champion must be Yes or No"); continue; }
      c.champion = champ;
    }
    if (c.sentiment) {
      sent = ["Positive", "Neutral", "Negative"].find((s) => s.toLowerCase() === c.sentiment.toLowerCase()) || "";
      if (!sent) { finish("error", "Sentiment must be Positive, Neutral or Negative"); continue; }
      c.sentiment = sent;
    }
    if (c.send) {
      send = yesNo(c.send);
      if (!send) { finish("error", "Send surveys must be Yes or No"); continue; }
      c.send = send;
    }
    if (it.dupKey && seen.get(it.dupKey) > 1) { finish("error", `Email appears twice in this file for ${a.name}`); continue; }

    const mine = contacts.filter((x) => x.accountId === a.id);
    let match = null;
    if (c.email) match = mine.find((x) => (x.email || "").trim().toLowerCase() === c.email.toLowerCase()) || null;
    else if (c.name) {
      const hits = mine.filter((x) => (x.name || "").trim().toLowerCase() === c.name.toLowerCase());
      if (hits.length > 1) { finish("error", `${hits.length} contacts named "${c.name}" on ${a.name} — add an email`); continue; }
      match = hits[0] || null;
    }

    if (!match) {
      if (!c.name) { finish("error", "Name is missing"); continue; }
      adds.push({
        id: newId(), accountId: a.id, name: c.name, role: c.role, email: c.email,
        isChampion: champ === "Yes", sentiment: sent || "Neutral", surveyRecipient: send === "Yes",
      });
      finish("new", "New contact");
      continue;
    }

    const patch = {};
    if (c.name && c.name !== match.name) patch.name = c.name;
    if (c.role && c.role !== match.role) patch.role = c.role;
    if (c.email && c.email.toLowerCase() !== (match.email || "").toLowerCase()) patch.email = c.email;
    if (champ && (champ === "Yes") !== !!match.isChampion) patch.isChampion = champ === "Yes";
    if (sent && sent !== match.sentiment) patch.sentiment = sent;
    if (send && (send === "Yes") !== !!match.surveyRecipient) patch.surveyRecipient = send === "Yes";
    if (!Object.keys(patch).length) { finish("same", "No change"); continue; }
    patches.push({ id: match.id, patch });
    const optedOut = send === "Yes" && match.surveyOptOut;
    finish("update", optedOut ? "Opted out — flag kept, will not be emailed" : `Update: ${Object.keys(patch).map((k) => PATCH_LABELS[k] || k).join(", ")}`);
  }
  return { rows: out, counts, adds, patches };
}
