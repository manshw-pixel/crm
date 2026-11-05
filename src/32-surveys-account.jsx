/* ------------------------------ account surveys ------------------------------ */
// Surveys PR 1: the account's Surveys card (answers, pending, NPS line) and the admin-only
// Send survey dialog. Sending goes through the send_survey RPC; this file only mirrors the
// rows it returns into the store (SURVEYS_SENT + the sv-sent-<id> timeline activity).
const svMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const svDMon = isoStr => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoStr || "")); return m ? `${+m[3]} ${svMonths[+m[2] - 1]}` : ""; };
const svPlural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function svAnswerText(q, v) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  if (q.type === "nps") return `${v}/10`;
  if (q.type === "rating") return `${v}/${q.scale || 5}`;
  if (q.type === "text") return `“${v}”`;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

function AccountSurveysCard({ account, contacts, surveys, user, dispatch, orgName, settings }) {
  const [open, setOpen] = useState(false);
  const admin = !!user && user.role === "admin";
  const mine = (surveys || []).filter(s => s.accountId === account.id);
  const done = mine.filter(s => s.submittedAt).sort((x, y) => String(y.submittedAt).localeCompare(String(x.submittedAt)));
  const today = iso(Date.now());
  const pending = mine.filter(s => !s.submittedAt).sort((x, y) => String(y.sentAt).localeCompare(String(x.sentAt)));
  // NPS: this account's submitted nps answers, grouped by the calendar year they were submitted.
  const byYear = {};
  for (const s of done) {
    const q = ((s.template && s.template.questions) || []).find(x => x.type === "nps");
    const v = q && s.answers ? s.answers[q.id] : null;
    if (Number.isInteger(v)) (byYear[String(s.submittedAt).slice(0, 4)] = byYear[String(s.submittedAt).slice(0, 4)] || []).push(v);
  }
  const years = Object.keys(byYear).sort();
  const latest = years.length ? years[years.length - 1] : null;
  const cur = latest ? npsSummary(byYear[latest]) : null;
  const prevY = latest ? String(+latest - 1) : null;
  const prev = prevY && byYear[prevY] ? npsSummary(byYear[prevY]) : null;
  const flagged = contacts.some(c => c.surveyRecipient);
  const focusContacts = () => {
    const el = document.querySelector('section[data-ad-card][aria-label="Contacts"]');
    if (!el) return;
    el.setAttribute("tabindex", "-1");
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.focus({ preventScroll: true });
  };
  const right = admin
    ? <button type="button" data-send-survey className="ad-toggle ad-toggle-chip ml-auto" onClick={() => setOpen(true)}>Send survey</button>
    : <span data-surveys-readonly className="ad-pill ad-pill-sm ml-auto" data-sev="grey">Read only · sent by admins</span>;
  return (
    <div data-surveys-card>
      <AdCard title="Surveys" right={right}>
        {cur && <div data-surveys-nps className="ad-row !gap-2 flex-wrap">
          <span className="ad-t-sm font-semibold">NPS {cur.nps} from {svPlural(cur.n, "answer")}</span>
          <span className="ad-xs">{latest}</span>
          <span className="ad-xs w-full">{prevY}: {prev ? `NPS ${prev.nps} from ${svPlural(prev.n, "answer")}` : "—"}</span>
        </div>}
        {!flagged && mine.length === 0 && <div className="ad-empty">No contacts flagged for surveys{" "}
          <button type="button" data-surveys-goto-contacts className="st-link" onClick={focusContacts}>Go to Contacts</button></div>}
        {flagged && mine.length === 0 && <div className="ad-empty">No surveys sent yet</div>}
        {done.map(s => {
          const qs = (s.template && s.template.questions) || [];
          return (
            <div key={s.id} data-survey-row="submitted" className="ad-row !items-start !gap-2.5">
              <div className="min-w-0 flex-auto">
                <div className="ad-t-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{(s.template && s.template.name) || s.templateId}</div>
                <div className="ad-xs" style={{ overflowWrap: "anywhere" }}>{[s.contactName, s.contactRole].filter(Boolean).join(" · ")} · {svDMon(s.submittedAt)}</div>
                {qs.map(q => { const t = svAnswerText(q, s.answers && s.answers[q.id]); return t &&
                  <div key={q.id} data-survey-answer={q.type} className="ad-body" style={{ overflowWrap: "anywhere" }}>{t}</div>; })}
              </div>
            </div>);
        })}
        {pending.map(s => (
          <div key={s.id} data-survey-row={isOpenSurvey(s, today) ? "pending" : "expired"} className="ad-row !gap-2.5">
            <div className="min-w-0 flex-auto">
              <div className="ad-t-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{(s.template && s.template.name) || s.templateId}</div>
              <div className="ad-xs" style={{ overflowWrap: "anywhere" }}>{[s.contactName, s.contactRole].filter(Boolean).join(" · ")}</div>
            </div>
            {isOpenSurvey(s, today)
              ? <span className="ad-pill ad-pill-sm" data-sev="amber">Sent {svDMon(s.sentAt)} · awaiting answer</span>
              : <span className="ad-pill ad-pill-sm" data-sev="grey">Sent {svDMon(s.sentAt)} · expired, no answer</span>}
          </div>))}
      </AdCard>
      {open && <SendSurveyDialog account={account} contacts={contacts} surveys={mine} settings={settings} orgName={orgName} user={user}
        dispatch={dispatch} onClose={() => setOpen(false)} />}
    </div>
  );
}

function SendSurveyDialog({ account, contacts, surveys, settings, orgName, user, dispatch, onClose, onSent }) {
  const toast = useToast();
  const templates = activeTemplates(settings.surveyTemplates);
  const [tplId, setTplId] = useState(NPS_CHECKIN.id);
  const tpl = templates.find(t => t.id === tplId) || null;
  const today = iso(Date.now());
  const throttleDays = (settings.surveys && settings.surveys.throttleDays) ?? 90;
  const cand = tpl ? sendCandidates(contacts, surveys, tpl, today, throttleDays) : { ticked: [], other: [] };
  const [ticked, setTicked] = useState(() => new Set(cand.ticked.map(c => c.id)));
  const pickTemplate = id => {
    const t = templates.find(x => x.id === id);
    setTplId(id); setErr("");
    if (t) setTicked(new Set(sendCandidates(contacts, surveys, t, today, throttleDays).ticked.map(c => c.id)));
  };
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // a double click must never call send_survey twice
  const blocked = r => r === "No email" || r === "Opted out" || /^Survey pending/.test(r) || /^Surveyed /.test(r);
  const ordered = [...cand.ticked, ...cand.other.map(o => o.contact)];
  const first = ordered.find(c => ticked.has(c.id));
  const org = orgName || "Your company";
  const ctx = { firstName: first ? firstNameOf(first.name) : "", accountName: account.name, csmName: account.csm || "", orgName: org };
  const n = ticked.size;
  const toggle = (id, on) => setTicked(p => { const s = new Set(p); if (on) s.add(id); else s.delete(id); return s; });
  const send = async () => {
    if (!n || inFlight.current) return;
    if (!tpl) { setErr("This template was archived — pick another."); return; }
    inFlight.current = true;
    setBusy(true); setErr("");
    const ids = ordered.filter(c => ticked.has(c.id)).map(c => c.id);
    let res;
    try { res = await sb.rpc("send_survey", { p_account: account.id, p_contact_ids: ids, p_template: tpl }); }
    catch (e) { res = { error: e }; }
    setBusy(false);
    inFlight.current = false;
    if (!res || res.error) {
      const e = (res && res.error) || {};
      const missing = e.code === "PGRST202" || /Could not find the function/i.test(e.message || "");
      setErr(missing ? "Surveys aren't set up yet — an admin needs to run surveys.sql." : (e.message || "Couldn't send the survey."));
      return;
    }
    const out = res.data || {};
    const sent = out.sent || [], skipped = out.skipped || [];
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 86400000).toISOString();
    const byId = Object.fromEntries(contacts.map(c => [c.id, c]));
    const items = sent.map(r => { const c = byId[r.contact_id] || {}; return {
      id: r.survey_id, accountId: account.id, contactId: r.contact_id, contactName: c.name, contactRole: c.role,
      templateId: tpl.id, template: tpl, source: "sent", sentAt: now.toISOString(), expiresAt: expires, submittedAt: null, answers: {} }; });
    if (items.length) dispatch({ type: "SURVEYS_SENT", items });
    for (const it of items) dispatch({ type: "ADD_ACTIVITY", item: {
      id: "sv-sent-" + it.id, type: "survey", system: true, date: iso(now), accountId: account.id, contactId: it.contactId,
      surveyId: it.id, loggedBy: (user && user.name) || "", summary: `Survey sent (${tpl.name}) to ${it.contactName || (byId[it.contactId] || {}).email || ""}` } });
    onSent && onSent(out);
    onClose();
    toast({ text: `Survey sent to ${svPlural(sent.length, "contact")}${skipped.length ? ` · ${skipped.length} skipped` : ""}`, tone: skipped.length ? "info" : "success" });
  };
  const row = (c, reason) => {
    const dis = reason && blocked(reason);
    return (
      <label key={c.id} data-send-contact={c.id} className={`ad-row !gap-2 ${dis ? "opacity-60" : ""}`}>
        <input type="checkbox" disabled={dis} checked={!dis && ticked.has(c.id)} onChange={e => toggle(c.id, e.target.checked)} />
        <span className="min-w-0 flex-auto">
          <span className="ad-t-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{c.name}</span>
          <span className="ad-xs block" style={{ overflowWrap: "anywhere" }}>{[c.role, c.email].filter(Boolean).join(" · ")}</span>
        </span>
        {reason && <span data-send-reason className="ad-pill ad-pill-sm" data-sev="grey">{reason}</span>}
      </label>);
  };
  return (
    <Modal label={`Send survey to ${account.name}`} onClose={onClose} data-send-survey-dialog style={{ maxWidth: 640 }}>
      <h2 className="ad-h2">Send survey · <span className="ad-n">{account.name}</span></h2>
      <label className="ad-xs block mb-1" htmlFor="sv-template">Template</label>
      <select id="sv-template" className="nm-inset mb-3 w-full px-3 py-1.5 text-sm text-slate-800" value={tplId} onChange={e => pickTemplate(e.target.value)}>
        {!tpl && <option value={tplId}>(archived template)</option>}
        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <fieldset className="mb-3">
        <legend className="ad-xs mb-1">Contacts</legend>
        {cand.ticked.length === 0 && <div className="ad-empty">No flagged contacts can be sent to.</div>}
        {cand.ticked.map(c => row(c, null))}
        {cand.other.length > 0 && <>
          <div className="ad-xs mt-2 mb-1 font-semibold">Other contacts</div>
          {cand.other.map(o => row(o.contact, o.reason))}
        </>}
      </fieldset>
      <section data-send-preview aria-label="Email preview" className="ad-box mb-3">
        <div className="ad-xs">Subject</div>
        <div className="ad-t-sm font-semibold mb-2">{org} would like your feedback</div>
        <p className="ad-body">{greeting(ctx)},</p>
        <p className="ad-body">{ctx.csmName ? `${ctx.csmName} from ${org}` : org} would like your feedback</p>
        {tpl && <>
          <p className="ad-body">{fillPlaceholders(tpl.intro, ctx)}</p>
          <p className="ad-body font-semibold">{fillPlaceholders(tpl.questions[0].text, ctx)}</p>
          {(tpl.questions[0].type === "nps" || tpl.questions[0].type === "rating") && <div aria-hidden="true" className="flex flex-wrap gap-1 mt-1">
            {(tpl.questions[0].type === "nps" ? Array.from({ length: 11 }, (_, i) => i) : Array.from({ length: tpl.questions[0].scale || 5 }, (_, i) => i + 1))
              .map(i => <span key={i} className="ad-pill ad-pill-sm" data-sev="grey">{i}</span>)}
          </div>}
        </>}
      </section>
      {err && <p role="alert" data-send-error className="ad-body mb-2" style={{ color: "var(--p-r-tx)" }}>{err}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" data-send-confirm disabled={n === 0 || busy} onClick={send}>Send to {svPlural(n, "contact")}</Btn>
      </div>
    </Modal>
  );
}
