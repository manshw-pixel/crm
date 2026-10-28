/* ------------------------------- Playbook ------------------------------- */
function PlaybookCard({ st, dispatch }) {
  const pb = playbookOf(st.settings);
  const setPb = list => dispatch({ type: "SET_PLAYBOOK", playbook: list });
  const edit = (id, patch) => setPb(pb.map(p => p.id === id ? { ...p, ...patch } : p));
  return (
    <Card title="Renewal playbook">
      {pb.map(p => (
        <div key={p.id} className="mb-2 flex flex-wrap items-center gap-2 text-sm sm:flex-nowrap">
          <Input value={p.title} placeholder="Step…" onChange={e => edit(p.id, { title: e.target.value })} className="flex-1 min-w-[160px]" />
          <Input type="number" min="0" max="365" value={p.offsetDays} title="Days before renewal"
            onChange={e => edit(p.id, { offsetDays: Math.min(365, Math.max(0, Math.round(+e.target.value || 0))) })} className="!w-20 shrink-0" />
          <span className="whitespace-nowrap text-xs text-slate-500">d before</span>
          <Select value={p.priority} onChange={e => edit(p.id, { priority: e.target.value })} options={["High", "Medium", "Low"]} />
          <button title="Remove step" aria-label="Remove step" className="text-rose-400 hover:text-rose-600" onClick={() => setPb(pb.filter(x => x.id !== p.id))}>✕</button>
        </div>
      ))}
      <Btn onClick={() => setPb([...pb, { id: uid(), title: "", offsetDays: 30, priority: "Medium" }])}>+ Add step</Btn>
      <p className="mt-3 text-xs text-slate-500">When an account comes within 90 days of renewal, one task per step is created automatically for its CSM (due = renewal date − days, marked ▶). Edits apply to accounts seeded from then on; already-created tasks are unchanged. Shared by the whole team.</p>
    </Card>
  );
}

/* One-time backfill: seed ♥ playbooks for accounts that are already at risk.
 * The auto-seeder only fires on band crossings, so accounts that were Red before the
 * feature shipped never get a playbook. Re-seeds already-seeded accounts by design. */
function HealthBackfillCard({ st, dispatch, scored }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const cands = backfillCandidates(scored);
  const fresh = cands.filter(a => a.healthPlaybookBand === undefined).length;
  const seeded = cands.length - fresh;
  const run = () => {
    const today = iso(Date.now());
    const hpb = healthPlaybookOf(st.settings);
    const existingIds = new Set(st.tasks.map(t => t.id));
    let tasks = 0, accounts = 0;
    cands.forEach(a => {
      // Task shape mirrors the auto-seeder's construction at the SEED_HEALTH_PLAYBOOK
      // dispatch in the health-band-crossing effect below — id shape is load-bearing
      // for both dedup guards, keep them in sync.
      const items = (hpb[a.risk] || []).filter(s => s.title.trim()).map(s => ({
        id: `hpb-${a.id}-${a.risk}-${today}-${s.id}`, accountId: a.id, healthPlaybook: true,
        healthBand: a.risk, healthFor: today, title: "♥ " + s.title,
        due: isoPlus(today, s.dueDays), priority: s.priority, status: "Open", owner: a.csm || "" }))
        .filter(it => !existingIds.has(it.id));
      // Dedupe against ANY same-day event landing on this band, not just backfill-tagged
      // ones — if the auto-seeder already logged a real decline into this band today,
      // don't fabricate a second one. A never-seeded account has no such event, so a
      // legitimate first seed is never suppressed.
      const alreadyLogged = (a.healthEvents || []).some(ev => ev.date === today && ev.to === a.risk);
      const event = alreadyLogged ? null : { date: today, from: "Green", to: a.risk, source: "backfill" };
      if (items.length === 0 && !event) return;
      tasks += items.length;
      accounts += 1;
      // Deliberate re-arm: an account that recovered Red→Yellow keeps healthPlaybookBand
      // "Red" (the auto-seeder only clears it on recovery to Green). Overwriting it here
      // with the current band re-arms a future Red auto-seed. Intended, not an oversight.
      dispatch({ type: "SEED_HEALTH_PLAYBOOK", id: a.id, healthBand: a.risk,
        healthPlaybookBand: a.risk, items, event });
    });
    setDone({ accounts, tasks });
    setConfirming(false);
  };
  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">Backfill</div>
      <p className="mb-2 text-sm text-slate-600">
        {cands.length === 0
          ? "No at-risk accounts — nothing to seed."
          : `${cands.length} at-risk accounts — ${fresh} never seeded, ${seeded} already have a playbook (will get a fresh set).`}
      </p>
      {confirming ? (
        <div className="flex items-center gap-2">
          <Btn onClick={run}>{`Confirm — seed ${cands.length} accounts?`}</Btn>
          <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
        </div>
      ) : (
        <Btn disabled={cands.length === 0} onClick={() => { setDone(null); setConfirming(true); }}>Seed playbooks now</Btn>
      )}
      {done && <p className="mt-2 text-sm font-semibold text-emerald-600">
        {done.accounts === 0 ? "Already up to date — nothing to seed." : `Seeded ${done.accounts} accounts (${done.tasks} tasks).`}
      </p>}
    </div>
  );
}

/* --------------------------- Health playbook --------------------------- */
function HealthPlaybookCard({ st, dispatch, scored }) {
  const hpb = healthPlaybookOf(st.settings);
  const setBand = (band, list) => dispatch({ type: "SET_HEALTH_PLAYBOOK", healthPlaybook: { ...hpb, [band]: list } });
  const editStep = (band, id, patch) => setBand(band, hpb[band].map(s => s.id === id ? { ...s, ...patch } : s));
  const Section = ({ band, tone }) => (
    <div className="mb-3">
      <div className={`mb-1 text-xs font-bold uppercase tracking-widest ${tone}`}>{band}</div>
      {hpb[band].map(s => (
        <div key={s.id} className="mb-2 flex flex-wrap items-center gap-2 text-sm sm:flex-nowrap">
          <Input value={s.title} placeholder="Step…" onChange={e => editStep(band, s.id, { title: e.target.value })} className="flex-1 min-w-[160px]" />
          <Input type="number" min="0" max="180" value={s.dueDays} title="Days after crossing"
            onChange={e => editStep(band, s.id, { dueDays: Math.min(180, Math.max(0, Math.round(+e.target.value || 0))) })} className="!w-20 shrink-0" />
          <span className="whitespace-nowrap text-xs text-slate-500">d after</span>
          <Select value={s.priority} onChange={e => editStep(band, s.id, { priority: e.target.value })} options={["High", "Medium", "Low"]} />
          <button title="Remove step" aria-label="Remove step" className="text-rose-400 hover:text-rose-600" onClick={() => setBand(band, hpb[band].filter(x => x.id !== s.id))}>✕</button>
        </div>
      ))}
      <Btn onClick={() => setBand(band, [...hpb[band], { id: uid(), title: "", dueDays: 3, priority: "Medium" }])}>+ Add step</Btn>
    </div>
  );
  return (
    <Card title="Health playbook">
      <Section band="Yellow" tone="text-amber-600" />
      <Section band="Red" tone="text-rose-600" />
      <p className="mt-1 text-xs text-slate-500">When an account crosses into Yellow or Red, one task per step is created automatically for its CSM (due = crossing date + days, marked ♥). Tasks seed once per decline into a band; recovery to Green re-arms them. Shared by the whole team.</p>
      <HealthBackfillCard st={st} dispatch={dispatch} scored={scored} />
    </Card>
  );
}

/* Day-window inputs for one activity type. Edits live in local string drafts and are
   committed only on blur/Enter, and only when the window is valid (whole days >= 0 and
   zeroDays > fullDays) -- a half-typed or cleared field must never reach the store, since
   every dispatch rescored accounts and let the auto-seeder persist crossings and tasks. */
function RecencyWindowInputs({ type, cfg, onCommit }) {
  const [draft, setDraft] = useState({ fullDays: String(cfg.fullDays), zeroDays: String(cfg.zeroDays) });
  const [bad, setBad] = useState(false);
  useEffect(() => { setDraft({ fullDays: String(cfg.fullDays), zeroDays: String(cfg.zeroDays) }); }, [cfg.fullDays, cfg.zeroDays]);
  const commit = field => {
    const text = draft[field].trim();
    if (text === String(cfg[field])) return;
    const n = Number(text);
    const next = { ...cfg, [field]: n };
    if (text === "" || !Number.isInteger(n) || n < 0 || !(next.zeroDays > next.fullDays)) {
      setBad(true); setDraft(d => ({ ...d, [field]: String(cfg[field]) })); return;
    }
    setBad(false); onCommit({ [field]: n });
  };
  // !w-20 + shrink-0: Input is w-full by default, and 3-digit windows (365, 730) need the room
  const box = (field, label) => <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
    {label}<Input type="number" min="0" {...{ ["data-" + (field === "fullDays" ? "full" : "zero") + "-days"]: type }} value={draft[field]}
      onChange={e => { setBad(false); setDraft(d => ({ ...d, [field]: e.target.value })); }}
      onBlur={() => commit(field)} onKeyDown={e => { if (e.key === "Enter") commit(field); }} className="!w-20 shrink-0 !px-2" />d</span>;
  return <>{box("fullDays", "full ≤")}{box("zeroDays", "zero ≥")}
    {bad && <span data-window-error={type} className="text-rose-600">zero must be after full</span>}</>;
}

/* ------------------------------- Settings ------------------------------- */
// Country decides the entity's currency and default tax unless the admin has typed their own.
const BILLING_COUNTRY_DEFAULTS = { IN: ["INR", 18], US: ["USD", 0], PH: ["PHP", 12] };
const BILLING_SENDER_DEFAULT = { sender_email: "support@onevio.in", sender_name: "OneVio Billing" };
const BLANK_ENTITY = { name: "", country: "IN", address: "", state: "", tax_id: "", tax_id_label: "", currency: "INR", bank_details: "", invoice_prefix: "", default_tax_pct: "18", lut_number: "" };
function BillingSettingsCard({ user }) {
  const [entities, setEntities] = useState([]);
  const [sender, setSender] = useState(null);       // the billing_settings row, or null when the org has none yet
  const [senderEmail, setSenderEmail] = useState(BILLING_SENDER_DEFAULT.sender_email);
  const [f, setF] = useState(BLANK_ENTITY);
  const [editingId, setEditingId] = useState(null);
  const [touched, setTouched] = useState({});       // currency / default_tax_pct edited by hand
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [en, se] = await Promise.all([
      sb.from("billing_entities").select("*").order("created_at", { ascending: true }),
      sb.from("billing_settings").select("*").maybeSingle(),
    ]);
    if (en.error) return setErr(en.error.message);
    if (se.error) return setErr(se.error.message);
    setEntities(en.data || []);
    setSender(se.data || null);
    setSenderEmail(se.data ? se.data.sender_email : BILLING_SENDER_DEFAULT.sender_email);
  };
  useEffect(() => { load(); }, []);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const setCountry = country => setF(p => {
    const [cur, tax] = BILLING_COUNTRY_DEFAULTS[country];
    return { ...p, country, currency: touched.currency ? p.currency : cur, default_tax_pct: touched.default_tax_pct ? p.default_tax_pct : String(tax) };
  });
  const edit = e => {
    setErr(""); setMsg(""); setEditingId(e.id); setTouched({ currency: true, default_tax_pct: true });
    setF({ ...BLANK_ENTITY, ...Object.fromEntries(Object.keys(BLANK_ENTITY).map(k => [k, e[k] == null ? "" : String(e[k])])) });
  };
  const reset = () => { setEditingId(null); setTouched({}); setF(BLANK_ENTITY); };
  const saveEntity = async ev => {
    ev.preventDefault(); setErr(""); setMsg("");
    const taxStr = String(f.default_tax_pct).trim();
    if (taxStr === "" || !Number.isFinite(Number(taxStr))) return setErr("Default tax % must be a number (0 is allowed).");
    setBusy(true);
    const row = {
      name: f.name.trim(), country: f.country, address: f.address.trim(), state: f.country === "IN" ? f.state.trim() : "",
      tax_id: f.tax_id.trim(), tax_id_label: f.tax_id_label.trim(), currency: f.currency, bank_details: f.bank_details.trim(),
      invoice_prefix: f.invoice_prefix.trim(), default_tax_pct: Number(taxStr),
      lut_number: f.country === "IN" && f.lut_number.trim() ? f.lut_number.trim() : null,
    };
    const { error } = editingId
      ? await sb.from("billing_entities").update(row).eq("id", editingId)
      : await sb.from("billing_entities").insert(row);
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg(editingId ? `Updated ${row.name}.` : `Added ${row.name}.`);
    reset(); load();
  };
  // billing_settings can have no row for an org created after the migration, so this upserts.
  const saveSender = async () => {
    setErr(""); setMsg("");
    const email = senderEmail.trim();
    if (!email || !email.includes("@")) return setErr("Enter a valid sender email address.");
    const { error } = await sb.from("billing_settings").upsert(
      { org_id: user.org_id, sender_email: email, sender_name: sender ? sender.sender_name : BILLING_SENDER_DEFAULT.sender_name },
      { onConflict: "org_id" });
    if (error) setErr(error.message); else { setMsg("Sender saved."); load(); }
  };
  const isIN = f.country === "IN";
  return (
    <Card title="Billing">
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Billing entities</div>
      {!entities.length && <p className="mt-1 text-xs text-slate-500">No billing entity yet. Add the company that issues invoices, one per country.</p>}
      {entities.map(e => (
        <div key={e.id} data-billing-entity-row className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
          <span className="flex-1">{e.name}
            <span className="ml-2 text-xs text-slate-500">{e.country} · {e.currency} · {e.invoice_prefix} · next #{e.next_number}</span></span>
          <button className="text-xs text-indigo-600 hover:underline" onClick={() => edit(e)}>edit</button>
        </div>
      ))}
      <form data-billing-entity-form onSubmit={saveEntity} className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="text-xs font-semibold text-slate-600 sm:col-span-2">{editingId ? "Edit entity" : "Add entity"}</div>
        <Input name="name" placeholder="Legal name" value={f.name} onChange={e => set("name", e.target.value)} />
        <Select name="country" value={f.country} onChange={e => setCountry(e.target.value)} options={["IN", "US", "PH"]} />
        <Input name="address" placeholder="Address" value={f.address} onChange={e => set("address", e.target.value)} className="sm:col-span-2" />
        {isIN && <Input name="state" placeholder="State" value={f.state} onChange={e => set("state", e.target.value)} />}
        <Input name="tax_id" placeholder="Tax ID" value={f.tax_id} onChange={e => set("tax_id", e.target.value)} />
        <Input name="tax_id_label" placeholder="Tax ID label (e.g. GSTIN)" value={f.tax_id_label} onChange={e => set("tax_id_label", e.target.value)} />
        <Select name="currency" value={f.currency} onChange={e => { setTouched(t => ({ ...t, currency: true })); set("currency", e.target.value); }} options={["INR", "USD", "PHP"]} />
        <Input name="invoice_prefix" placeholder="Invoice prefix (e.g. IN-)" value={f.invoice_prefix} onChange={e => set("invoice_prefix", e.target.value)} />
        <Input name="default_tax_pct" type="number" step="0.01" min="0" max="100" placeholder="Default tax %" value={f.default_tax_pct}
          onChange={e => { setTouched(t => ({ ...t, default_tax_pct: true })); set("default_tax_pct", e.target.value); }} />
        {isIN && <Input name="lut_number" placeholder="LUT number (zero-rated exports)" value={f.lut_number} onChange={e => set("lut_number", e.target.value)} />}
        <textarea name="bank_details" placeholder="Bank details shown on the invoice" rows={3} value={f.bank_details} onChange={e => set("bank_details", e.target.value)}
          className="nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 sm:col-span-2" />
        <div className="flex gap-2 sm:col-span-2">
          <Btn kind="primary" type="submit" disabled={busy}>{busy ? "Saving…" : editingId ? "Save entity" : "Add entity"}</Btn>
          {editingId && <Btn onClick={reset}>Cancel</Btn>}
        </div>
      </form>
      <div data-billing-sender className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs font-semibold text-slate-600">Invoice sender</span>
        <Input type="email" aria-label="Invoice sender email" value={senderEmail} onChange={e => setSenderEmail(e.target.value)} className="w-64" />
        <Btn onClick={saveSender}>Save</Btn>
      </div>
      {err && <div className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">{err}</div>}
      {msg && <div className="mt-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{msg}</div>}
      <p className="mt-2 text-xs text-slate-500">The sender address must be verified in Brevo or invoices will not deliver. Invoice numbers are the prefix plus a counter that only ever moves forward.</p>
    </Card>
  );
}
// Admin-defined account fields (spec 2026-10-13). Built-ins are listed read-only so admins see the
// whole picture; custom fields can be added, renamed, retyped, reordered and archived (never deleted).
const BUILTIN_ACCOUNT_FIELDS = ["Name", "Tier", "ARR", "Billing currency", "Industry", "CSM owner", "Start date", "Transition date",
  "Renewal date", "Contract status", "QBR cadence", "Modules", "Total licenses", "Deployed licenses", "Dedicated support", "Billing completed", "Parent account"];
function CustomFieldsCard({ st, dispatch }) {
  const all = (st.settings && st.settings.customFields) || [];
  const active = activeCustomFields(all), archived = archivedCustomFields(all);
  const [label, setLabel] = useState(""), [type, setType] = useState("text"), [showArch, setShowArch] = useState(false);
  const save = list => dispatch({ type: "SET_CUSTOM_FIELDS", fields: list.map(normalizeFieldDef) });
  const patch = (id, p) => save(all.map(d => d.id === id ? { ...d, ...p } : d));
  const move = (id, dir) => {
    const ids = active.map(d => d.id), i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save([...ids.map(x => all.find(d => d.id === x)), ...archived]);
  };
  return (
    <Card title="Account fields">
      <p className="mb-2 text-xs text-slate-500">Built-in fields are fixed. Custom fields appear on every account's Edit form and page, and in CSV export.</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {BUILTIN_ACCOUNT_FIELDS.map(n => <span key={n} data-cf-builtin className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">🔒 {n}</span>)}
      </div>
      {active.map((d, i) => (
        <div key={d.id} data-cf-row={d.id} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <Input key={d.id + "|" + d.label} defaultValue={d.label} aria-label="Field label" className="w-40"
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== d.label) patch(d.id, { label: v }); else e.target.value = d.label; }} />
          <Select value={d.type} aria-label="Field type" onChange={e => patch(d.id, { type: e.target.value })}
            options={CUSTOM_FIELD_TYPES} labels={CUSTOM_FIELD_TYPE_LABELS} />
          {d.type === "select" && <Input key={d.id + "|" + (d.options || []).join(",")} data-cf-options={d.id} defaultValue={(d.options || []).join(", ")} placeholder="Options, comma-separated" className="w-56"
            onBlur={e => patch(d.id, { options: e.target.value.split(",") })} />}
          <button title="Move up" aria-label="Move up" disabled={i === 0} className="text-xs text-slate-500 disabled:opacity-30" onClick={() => move(d.id, -1)}>▲</button>
          <button title="Move down" aria-label="Move down" disabled={i === active.length - 1} className="text-xs text-slate-500 disabled:opacity-30" onClick={() => move(d.id, 1)}>▼</button>
          <button data-cf-archive={d.id} className="ml-auto text-xs font-semibold text-rose-600" onClick={() => patch(d.id, { archived: true })}>Delete</button>
        </div>))}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <Input data-cf-new-label value={label} onChange={e => setLabel(e.target.value)} placeholder="New field label" className="w-40" />
        <Select data-cf-new-type value={type} aria-label="New field type" onChange={e => setType(e.target.value)} options={CUSTOM_FIELD_TYPES} labels={CUSTOM_FIELD_TYPE_LABELS} />
        <Btn data-cf-add kind="primary" disabled={!label.trim()} onClick={() => { save([...all, { id: newFieldId(), label, type }]); setLabel(""); setType("text"); }}>+ Add field</Btn>
      </div>
      {archived.length > 0 && <div className="mt-3 text-xs">
        <button className="font-semibold text-slate-500 hover:text-slate-800" onClick={() => setShowArch(s => !s)}>Archived ({archived.length})</button>
        {showArch && archived.map(d => <div key={d.id} className="mt-1 flex items-center gap-2 text-slate-600">
          <span>{d.label}</span><span className="text-slate-400">{CUSTOM_FIELD_TYPE_LABELS[d.type]}</span>
          <button data-cf-restore={d.id} className="font-semibold text-indigo-600" onClick={() => patch(d.id, { archived: false })}>Restore</button></div>)}
      </div>}
    </Card>
  );
}

function Settings({ st, dispatch, user, scored, theme, feed }) {
  const toast = useToast();
  const w = st.settings.weights;
  const rates = st.settings.rates;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const fileRef = useRef();
  const [confirmData, setConfirmData] = useState(null); // "sample" | "clear"
  const setW = (k, v) => dispatch({ type: "SET_WEIGHTS", weights: { ...w, [k]: +v } });
  const rmix = st.settings.recencyMix || mergeSettings({}).recencyMix;
  const vmix = st.settings.valueMix || mergeSettings({}).valueMix;
  const [openSub, setOpenSub] = useState({ recency: false, value: false });
  const setType = (t, patch) => dispatch({ type: "SET_RECENCY_MIX", mix: { ...rmix, types: { ...rmix.types, [t]: { ...rmix.types[t], ...patch } } } });
  const impactText = r => r.down === 0 ? "No account changes band." : `Moves ${r.down} account${r.down > 1 ? "s" : ""} down a band (${r.toYellow} → Yellow, ${r.toRed} → Red).`;
  // Impact previews rescore every account, so compute them only while they are visible.
  const NO_IMPACT = { down: 0, toYellow: 0, toRed: 0 };
  const recencyOpen = openSub.recency, valueLive = w.value > 0;
  const recencyImpact = useMemo(() => !recencyOpen ? NO_IMPACT : bandImpact(st.accounts, st.activities,
    { ...st.settings, recencyMix: { ...rmix, enabled: false } }, { ...st.settings, recencyMix: { ...rmix, enabled: true } }),
    [st.accounts, st.activities, st.settings, recencyOpen]);
  const valueImpact = useMemo(() => !valueLive ? NO_IMPACT : bandImpact(st.accounts, st.activities,
    { ...st.settings, weights: { ...w, value: 0 } }, st.settings),
    [st.accounts, st.activities, st.settings, valueLive]);
  const doExport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(st, null, 2)], { type: "application/json" }));
    const el = Object.assign(document.createElement("a"), { href: url, download: "crm-data.json" });
    el.click(); URL.revokeObjectURL(url);
  };
  const bulkReplace = async state => {
    try { await replaceAllRemote(state); dispatch({ type: "REPLACE", state: { ...state, team: st.team, projects: st.projects, projectTasks: st.projectTasks } }); }
    catch (ex) { toast({ text: "Bulk update failed: " + ex.message, tone: "error" }); }
  };
  const doImport = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async () => { try { const s = JSON.parse(r.result); if (!s.accounts || !s.settings) throw 0; await bulkReplace(s); toast({ text: "Imported for the whole team.", tone: "success" }); } catch (ex) { toast({ text: ex && ex.message ? "Import failed: " + ex.message : "Invalid JSON file.", tone: "error" }); } };
    r.readAsText(f); e.target.value = "";
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <nav data-settings-index aria-label="Settings sections" className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold lg:col-span-2">
        {[["Appearance", "set-appearance"], ["Scoring", "set-scoring"], ["Currency", "set-currency"], ["Integrations", "set-integrations"], ["Renewal playbook", "set-renewal-pb"], ["Health playbook", "set-health-pb"], ["Account fields", "set-custom-fields"], ["Users", "set-users"],
          ...(user.role === "admin" ? [["Implementation", "set-implementation"], ["Billing", "set-billing"], ["Error log", "set-errors"]] : []), ["Data", "set-data"]].map(([l, id]) =>
          <a key={id} href={"#" + id} className="text-indigo-600 hover:underline" onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }}>{l}</a>)}
      </nav>
      <Card title="Appearance" id="set-appearance">
        <p className="mb-2 text-xs text-slate-500">Saved on this device. Auto follows your device's light/dark setting.</p>
        <div className="nm-inset inline-flex gap-0.5 !rounded-lg p-0.5" role="group" aria-label="Theme">
          {THEME_CHOICES.map(c => (
            <button key={c} data-theme-choice={c} aria-pressed={theme.choice === c} onClick={() => theme.choose(c)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${theme.choice === c ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
              {{ light: "Light", dark: "Dark", auto: "Auto" }[c]}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Health score weights" id="set-scoring">
        <div className="nm-inset mb-3 p-3 font-mono text-xs text-slate-700">
          score = {Object.keys(w).map(k => `${(100 * w[k] / total).toFixed(0)}%·${k}`).join(" + ")}
        </div>
        {Object.keys(w).map(k => (
          <React.Fragment key={k}>
          <div className="mb-2 flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0 sm:w-40">{WEIGHT_LABELS[k]}</span>
            <input type="range" min="0" max="100" value={w[k]} onChange={e => setW(k, e.target.value)} className="min-w-0 flex-1" />
            <span className="w-12 text-right font-mono text-xs">{(100 * w[k] / total).toFixed(0)}%</span>
          </div>
            {k === "recency" && <div className="mb-3 ml-4">
              <button data-recency-panel-toggle className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOpenSub(o => ({ ...o, recency: !o.recency }))}>
                {openSub.recency ? "▾" : "▸"} Sub-options (by activity type)</button>
              {openSub.recency && <div data-recency-panel className="mt-2 space-y-1.5 text-xs">
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" data-recency-enabled checked={!!rmix.enabled} onChange={e => dispatch({ type: "SET_RECENCY_MIX", mix: { ...rmix, enabled: e.target.checked } })} />
                  Score recency per activity type
                </label>
                <div data-impact="recency" className="text-slate-500">{rmix.enabled ? "Compared with any-activity recency: " : "Turning this on: "}{impactText(recencyImpact)}</div>
                {ACTIVITY_TYPES.map(t => <div key={t} className="flex items-center gap-2">
                  <span className="w-16">{t}</span>
                  <input type="range" min="0" max="100" data-sub-weight={t} value={rmix.types[t].weight} onChange={e => setType(t, { weight: +e.target.value })} className="flex-1" />
                  <span className="w-8 text-right tabular-nums">{rmix.types[t].weight}</span>
                  <RecencyWindowInputs type={t} cfg={rmix.types[t]} onCommit={patch => setType(t, patch)} />
                </div>)}
              </div>}
            </div>}
            {k === "value" && <div className="mb-3 ml-4">
              <div data-impact="value" className="text-xs text-slate-500">{w.value > 0 ? impactText(valueImpact) : "Weight 0% — Value does not affect scores yet."}</div>
              <button data-value-panel-toggle className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOpenSub(o => ({ ...o, value: !o.value }))}>
                {openSub.value ? "▾" : "▸"} Sub-options</button>
              {openSub.value && <div data-value-panel className="mt-2 space-y-1.5 text-xs">
                {VALUE_ITEMS.map(([vk, label]) => <div key={vk} className="flex items-center gap-2">
                  <span className="w-48">{label}</span>
                  <input type="range" min="0" max="100" data-value-weight={vk} value={vmix[vk]} onChange={e => dispatch({ type: "SET_VALUE_MIX", mix: { ...vmix, [vk]: +e.target.value } })} className="flex-1" />
                  <span className="w-8 text-right tabular-nums">{vmix[vk]}</span>
                </div>)}
              </div>}
            </div>}
          </React.Fragment>
        ))}
        <div className="mt-2 text-xs text-slate-500">Weights are normalized automatically — set relative importance; effective % is shown. Scores update everywhere instantly.</div>
      </Card>
      <Card title="Currency conversion (to USD)" id="set-currency">
        {CURRENCIES.filter(c => c !== "USD").map(c => (
          <div key={c} className="mb-2 flex items-center gap-2 text-sm">
            <span className="w-24">1 {c} ({CUR_SYM[c]}) =</span>
            <Input type="number" step="0.0001" min="0" value={rates[c]}
              onChange={e => dispatch({ type: "SET_RATES", rates: { ...rates, [c]: +e.target.value || 0 } })} className="w-28" />
            <span className="text-slate-700">USD</span>
          </div>
        ))}
        <p className="mt-2 text-xs text-slate-500">Each account is billed in its own currency; the dashboard, renewal totals, ARR sorting and the CSV's <code>arrUSD</code> column convert with these rates. Account rows and detail pages keep the native amount.</p>
      </Card>
      <div id="set-integrations" className="scroll-mt-4"><IntegrationsCard st={st} dispatch={dispatch} user={user} feed={feed} /></div>
      <div id="set-renewal-pb" className="scroll-mt-4"><PlaybookCard st={st} dispatch={dispatch} /></div>
      <div id="set-health-pb" className="scroll-mt-4"><HealthPlaybookCard st={st} dispatch={dispatch} scored={scored} /></div>
      <div id="set-custom-fields" className="scroll-mt-4"><CustomFieldsCard st={st} dispatch={dispatch} /></div>
      {user.role === "admin" && <div id="set-implementation" className="scroll-mt-4"><ImplChecklistSettingsCard st={st} dispatch={dispatch} /></div>}
      <div id="set-users" className="scroll-mt-4"><UsersCard me={user} /></div>
      {user.role === "admin" && <div id="set-billing" className="scroll-mt-4"><BillingSettingsCard user={user} /></div>}
      {user.role === "admin" && <div id="set-errors" className="scroll-mt-4"><ErrorLogCard /></div>}
      <Card title="Data" id="set-data">
        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" onClick={doExport}>Export JSON</Btn>
          <Btn onClick={() => fileRef.current.click()}>Import JSON</Btn>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={doImport} />
        </div>
        <div data-danger-zone className="mt-4 rounded-lg border border-rose-200 bg-rose-50/40 p-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-rose-600">Danger zone</div>
          <p className="mt-1 text-xs text-slate-600">Both replace the whole team's data and cannot be undone.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="nm-btn px-3.5 py-1.5 text-xs font-bold text-rose-600" onClick={() => setConfirmData("sample")}>Load sample data</button>
            <button className="nm-btn px-3.5 py-1.5 text-xs font-bold text-rose-600" onClick={() => setConfirmData("clear")}>Clear all data</button>
          </div>
        </div>
        {confirmData && <ConfirmDialog
          title={confirmData === "sample" ? "Replace all team data" : "Delete all team data"}
          body={confirmData === "sample"
            ? "This replaces the team's data with the sample dataset. Everyone sees this change, and it cannot be undone."
            : "This deletes ALL of the team's accounts and data for everyone. Export JSON first if you want a backup. It cannot be undone."}
          confirmLabel={confirmData === "sample" ? "Replace data" : "Delete everything"}
          typedWord={confirmData === "sample" ? "REPLACE" : "DELETE"}
          onConfirm={() => bulkReplace(confirmData === "sample" ? seedData() : emptyData())}
          onClose={() => setConfirmData(null)} />}
        <p className="mt-3 text-xs text-slate-700">Data is shared by the whole team in your Supabase project. Export JSON any time for a backup; Import replaces everything for everyone (admin only).</p>
      </Card>
    </div>
  );
}

