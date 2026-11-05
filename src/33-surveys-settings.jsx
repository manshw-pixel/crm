/* --------------------------- Settings → Surveys (admin) --------------------------- */
// Surveys PR 2 Task 3. Templates live in settings.surveyTemplates; the built-in NPS check-in
// shows from the NPS_CHECKIN constant until an admin saves a stored copy of it.
const SURVEY_Q_TYPES = ["nps", "rating", "single", "multi", "text"];
const SURVEY_Q_LABELS = { nps: "NPS (0–10)", rating: "Rating", single: "Single choice", multi: "Multiple choice", text: "Text" };
const surveyNow = () => new Date().toISOString();
const clampInt = (raw, lo, hi) => {
  const n = Number(String(raw).trim());
  if (String(raw).trim() === "" || !Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

function surveyTemplateList(stored) {
  const list = Array.isArray(stored) ? stored : [];
  return list.some(t => t.id === NPS_CHECKIN.id) ? list : [NPS_CHECKIN, ...list];
}

function SurveysSettingsCard({ st, dispatch, user, orgName }) {
  const toast = useToast();
  const stored = st.settings.surveyTemplates || [];
  const cfg = { ...SURVEY_DEFAULTS, ...(st.settings.surveys || {}) };
  const list = surveyTemplateList(stored);
  const [editing, setEditing] = useState(null); // a template object
  const [starters, setStarters] = useState(false);
  const saveList = next => dispatch({ type: "SET_SURVEY_TEMPLATES", templates: next });
  // Writes one template into the stored list; the built-in NPS check-in is stored on first change.
  const upsert = t => {
    const base = surveyTemplateList(stored);
    saveList(base.some(x => x.id === t.id) ? base.map(x => x.id === t.id ? t : x) : [...base, t]);
  };
  const liveNps = list.filter(t => !t.archived && isNpsTemplate(t));
  const setCfg = (key, value) => {
    if (value === cfg[key]) return;
    dispatch({ type: "SET_SURVEY_SETTINGS", patch: { [key]: value } });
    toast({ text: "Survey settings saved.", tone: "success" });
  };
  const blurInt = (key, lo, hi) => e => {
    const v = clampInt(e.target.value, lo, hi);
    if (v == null) { e.target.value = cfg[key]; return; }
    e.target.value = v; setCfg(key, v);
  };
  const copy = t => {
    const now = surveyNow();
    const c = copyTemplate(t, uid, now);
    c.name = "Copy of " + String(t.name || "").slice(0, 72);
    saveList([...surveyTemplateList(stored), c]);
  };
  const setArchived = (t, archived) => upsert({ ...t, archived, updatedAt: surveyNow() });
  return (
    <Card title={<span className="flex items-center gap-2">Surveys <span className="st-tag" style={{ marginLeft: 0 }}>Admin</span></span>}>
      <div data-surveys-settings>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <label className="block text-xs font-semibold text-slate-600">Wait between surveys (days)
            <Input key={"td" + cfg.throttleDays} type="number" min="0" max="365" step="1" defaultValue={cfg.throttleDays}
              data-survey-throttle aria-describedby="survey-throttle-help" onBlur={blurInt("throttleDays", 0, 365)} />
            <span id="survey-throttle-help" className="mt-1 block font-normal text-slate-500">Non-NPS surveys only. 0 = off.</span>
          </label>
          <label className="block text-xs font-semibold text-slate-600">Daily email limit
            <Input key={"dc" + cfg.dailyCap} type="number" min="1" max="500" step="1" defaultValue={cfg.dailyCap}
              data-survey-dailycap onBlur={blurInt("dailyCap", 1, 500)} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">From name
            <Input key={"fn" + cfg.fromName} maxLength={60} defaultValue={cfg.fromName} placeholder={orgName || ""}
              data-survey-fromname onBlur={e => { const v = e.target.value.trim().slice(0, 60); e.target.value = v; setCfg("fromName", v); }} />
          </label>
        </div>
        <ul className="mb-3 divide-y divide-slate-200">
          {list.map(t => {
            const nps = isNpsTemplate(t);
            const onlyNps = t.id === NPS_CHECKIN.id && !t.archived && liveNps.length === 1;
            return (
              <li key={t.id} data-template-row={t.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${t.archived ? "opacity-60" : ""}`}>
                <span className="min-w-0 break-words font-semibold text-slate-800">{t.name}</span>
                <span className="text-xs text-slate-500">{(t.questions || []).length} questions</span>
                {nps && <span data-template-nps data-sev="green" className="ad-pill ad-pill-sm">NPS</span>}
                {t.archived && <span data-template-archived className="ad-pill ad-pill-sm">Archived</span>}
                <span className="ml-auto flex gap-2">
                  <Btn data-template-edit aria-label={"Edit " + t.name} onClick={() => setEditing(t)}>Edit</Btn>
                  <Btn data-template-copy aria-label={"Copy " + t.name} onClick={() => copy(t)}>Copy</Btn>
                  {!onlyNps && <Btn data-template-archive aria-label={(t.archived ? "Restore " : "Archive ") + t.name}
                    onClick={() => setArchived(t, !t.archived)}>{t.archived ? "Restore" : "Archive"}</Btn>}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Btn kind="primary" data-template-new onClick={() => setEditing({ id: uid(), name: "", intro: "", archived: false, questions: [newQuestion("rating", uid)], createdAt: surveyNow(), updatedAt: surveyNow(), __new: true })}>New template</Btn>
          <Btn data-starter-open onClick={() => setStarters(true)}>Add starter templates</Btn>
        </div>
      </div>
      {editing && <TemplateEditorDialog template={editing} user={user} orgName={orgName}
        onClose={() => setEditing(null)}
        onSave={t => { upsert(t); setEditing(null); toast({ text: "Template saved.", tone: "success" }); }} />}
      {starters && <StarterTemplatesDialog present={new Set(list.map(t => t.id))} onClose={() => setStarters(false)}
        onAdd={picked => {
          const now = surveyNow();
          const clones = picked.map(s => ({ ...JSON.parse(JSON.stringify(s)), createdAt: now, updatedAt: now }));
          saveList([...surveyTemplateList(stored), ...clones]);
          setStarters(false);
          toast({ text: `Added ${clones.length} starter template${clones.length === 1 ? "" : "s"}.`, tone: "success" });
        }} />}
    </Card>
  );
}

function StarterTemplatesDialog({ present, onAdd, onClose }) {
  const [ticked, setTicked] = useState(() => new Set());
  const toggle = id => setTicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const picked = STARTER_TEMPLATES.filter(s => ticked.has(s.id) && !present.has(s.id));
  return (
    <Modal label="Add starter templates" onClose={onClose} data-starter-dialog>
      <h3 className="mb-3 text-sm font-bold text-slate-800">Add starter templates</h3>
      <ul className="mb-4 space-y-2">
        {STARTER_TEMPLATES.map(s => {
          const added = present.has(s.id);
          return (
            <li key={s.id} data-starter={s.id}>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" disabled={added} checked={added || ticked.has(s.id)} onChange={() => toggle(s.id)} />
                <span>{s.name}</span><span className="text-xs text-slate-500">{s.questions.length} questions</span>
                {added && <span className="text-xs font-semibold text-slate-500">Added</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Btn kind="primary" data-starter-add disabled={!picked.length} onClick={() => onAdd(picked)}>Add {picked.length || ""}</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

function SurveyQuestionPreview({ q, n, ctx }) {
  const text = fillPlaceholders(q.text || "", ctx);
  return (
    <div className="mb-3">
      <div className="text-sm font-semibold text-slate-800">{n}. {text || <span className="text-slate-400">(no text)</span>}{q.required && <span className="text-rose-600"> *</span>}</div>
      {q.type === "nps" && <div className="mt-1 flex flex-wrap gap-1">{Array.from({ length: 11 }, (_, i) => <span key={i} className="nm-inset px-1.5 text-xs text-slate-600">{i}</span>)}</div>}
      {q.type === "rating" && <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        {q.lowLabel && <span>{q.lowLabel}</span>}
        {Array.from({ length: Number(q.scale) || 5 }, (_, i) => <span key={i} className="nm-inset px-1.5 text-slate-600">{i + 1}</span>)}
        {q.highLabel && <span>{q.highLabel}</span>}</div>}
      {(q.type === "single" || q.type === "multi") && <ul className="mt-1 text-xs text-slate-600">
        {(q.options || []).map((o, i) => <li key={i}>{q.type === "single" ? "○" : "☐"} {o}</li>)}</ul>}
      {q.type === "text" && <div className={`nm-inset mt-1 ${q.long ? "h-12" : "h-6"}`} />}
    </div>
  );
}

function TemplateEditorDialog({ template, onSave, onClose, user, orgName }) {
  const initial = useMemo(() => JSON.parse(JSON.stringify({ ...template, __new: undefined })), [template]);
  const [t, setT] = useState(initial);
  const [err, setErr] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [adding, setAdding] = useState(false);
  const dirty = JSON.stringify(t) !== JSON.stringify(initial);
  const ctx = { firstName: "Priya", accountName: "Acme Corp", csmName: (user && user.name) || "", orgName: orgName || "Your company" };
  const qs = t.questions || [];
  const hasNps = qs.some(q => q.type === "nps");
  const setQ = (i, patch) => setT(x => ({ ...x, questions: x.questions.map((q, j) => j === i ? { ...q, ...patch } : q) }));
  const changeType = (i, type) => setT(x => ({ ...x, questions: x.questions.map((q, j) => {
    if (j !== i) return q;
    if (q.type === type) return q;
    // A new type is a new question: past answers key on the id, so it must not be reused.
    const fresh = newQuestion(type, uid);
    return { ...fresh, text: q.text || fresh.text, required: q.required };
  }) }));
  const add = type => { setT(x => ({ ...x, questions: [...x.questions, newQuestion(type, uid)] })); setAdding(false); };
  const close = () => dirty ? setConfirmDiscard(true) : onClose();
  const save = () => {
    const n = normaliseTemplate(t);
    const v = validateTemplate(n);
    if (!v.ok) { setErr(v.error); return; }
    setErr("");
    const { __new, ...clean } = n;
    onSave({ ...clean, createdAt: clean.createdAt || surveyNow(), updatedAt: surveyNow() });
  };
  return (
    <Modal label="Edit survey template" onClose={close} data-template-editor
      className="nm w-full max-w-4xl p-0 max-h-[80vh] overflow-y-auto">
      <div className="p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800">{template.__new ? "New template" : "Edit template"}</h3>
        <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <label className="mb-2 block text-xs font-semibold text-slate-600">Name
              <Input data-template-name maxLength={80} value={t.name} onChange={e => setT(x => ({ ...x, name: e.target.value }))} /></label>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Intro
              <textarea data-template-intro maxLength={300} rows={2} value={t.intro || ""} onChange={e => setT(x => ({ ...x, intro: e.target.value }))}
                className="nm-inset w-full px-3 py-1.5 text-sm text-slate-800 outline-none" /></label>
            <p className="mb-3 text-xs text-slate-500">You can use {"{firstName}"}, {"{accountName}"}, {"{csmName}"} and {"{orgName}"}.</p>
            {qs.map((q, i) => (
              <div key={q.id} data-q-row={q.id} className="nm-inset mb-2 p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">{i + 1}</span>
                  <Select aria-label={`Question ${i + 1} type`} data-q-type value={q.type} options={SURVEY_Q_TYPES} labels={SURVEY_Q_LABELS} onChange={e => changeType(i, e.target.value)} />
                  <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" data-q-required checked={!!q.required} onChange={e => setQ(i, { required: e.target.checked })} />Required</label>
                  <span className="ml-auto flex gap-1">
                    <button type="button" aria-label={`Move question ${i + 1} up`} disabled={i === 0} className="px-1 text-xs text-slate-500 disabled:opacity-30" onClick={() => setT(x => moveQuestion(x, i, i - 1))}>▲</button>
                    <button type="button" aria-label={`Move question ${i + 1} down`} disabled={i === qs.length - 1} className="px-1 text-xs text-slate-500 disabled:opacity-30" onClick={() => setT(x => moveQuestion(x, i, i + 1))}>▼</button>
                    <button type="button" aria-label={`Remove question ${i + 1}`} data-q-remove className="px-1 text-xs font-semibold text-rose-600" onClick={() => setT(x => ({ ...x, questions: x.questions.filter((_, j) => j !== i) }))}>Remove</button>
                  </span>
                </div>
                <Input aria-label={`Question ${i + 1} text`} data-q-text maxLength={300} value={q.text} onChange={e => setQ(i, { text: e.target.value })} />
                {q.type === "rating" && <div className="mt-2 flex flex-wrap gap-2">
                  <Select aria-label={`Question ${i + 1} scale`} data-q-scale value={String(q.scale || 5)} options={["5", "7", "10"]} labels={{ 5: "1–5", 7: "1–7", 10: "1–10" }}
                    onChange={e => setQ(i, { scale: Number(e.target.value) })} />
                  <Input aria-label={`Question ${i + 1} low label`} placeholder="Low label" maxLength={40} className="w-32" value={q.lowLabel || ""} onChange={e => setQ(i, { lowLabel: e.target.value })} />
                  <Input aria-label={`Question ${i + 1} high label`} placeholder="High label" maxLength={40} className="w-32" value={q.highLabel || ""} onChange={e => setQ(i, { highLabel: e.target.value })} />
                </div>}
                {(q.type === "single" || q.type === "multi") && <div className="mt-2">
                  {(q.options || []).map((o, k) => (
                    <div key={k} className="mb-1 flex items-center gap-2">
                      <Input aria-label={`Question ${i + 1} option ${k + 1}`} data-q-option maxLength={80} value={o}
                        onChange={e => setQ(i, { options: q.options.map((x, m) => m === k ? e.target.value : x) })} />
                      <button type="button" aria-label={`Remove option ${k + 1}`} className="px-1 text-xs text-rose-600" onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k) })}>✕</button>
                    </div>
                  ))}
                  <button type="button" data-q-add-option className="text-xs font-semibold text-indigo-600" onClick={() => setQ(i, { options: [...(q.options || []), ""] })}>+ Add option</button>
                </div>}
                {q.type === "text" && <label className="mt-2 flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" data-q-long checked={!!q.long} onChange={e => setQ(i, { long: e.target.checked })} />Long answer</label>}
              </div>
            ))}
            <div className="mb-2">
              <Btn data-add-question aria-expanded={adding} onClick={() => setAdding(a => !a)}>+ Add question</Btn>
              {adding && <div className="mt-2 flex flex-wrap gap-2" data-add-question-menu>
                {SURVEY_Q_TYPES.map(type => <Btn key={type} data-add-type={type} disabled={type === "nps" && hasNps} onClick={() => add(type)}>{SURVEY_Q_LABELS[type]}</Btn>)}
              </div>}
            </div>
          </div>
          <div className="min-w-0" data-template-preview aria-label="Preview">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">Preview</div>
            <div className="nm-inset p-3">
              <p className="mb-2 text-sm text-slate-700">{greeting(ctx)}</p>
              {t.intro && <p className="mb-3 text-sm text-slate-600">{fillPlaceholders(t.intro, ctx)}</p>}
              {qs.map((q, i) => <SurveyQuestionPreview key={q.id} q={q} n={i + 1} ctx={ctx} />)}
            </div>
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-slate-200 p-3" style={{ background: "var(--f-card)" }}>
        {err && <span role="alert" data-template-error className="mr-auto text-xs font-semibold text-rose-700">{err}</span>}
        <span className="ml-auto flex gap-2">
          <Btn onClick={close}>Cancel</Btn>
          <Btn kind="primary" data-template-save onClick={save}>Save</Btn>
        </span>
      </div>
      {confirmDiscard && <ConfirmDialog title="Discard changes?" body="Your edits to this template will be lost." confirmLabel="Discard"
        onConfirm={() => onClose()} onClose={() => setConfirmDiscard(false)} />}
    </Modal>
  );
}
