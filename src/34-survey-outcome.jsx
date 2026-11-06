/* ------------------------- survey follow-up outcome ------------------------- */
const SURVEY_OUTCOMES = ["Called", "Fixed", "No action needed"];
const isOpenSurveyTask = t => t.source === "survey" && t.status !== "Done";
// submit_survey titles the task "Follow up: <contact> — <question>: <answer>", and the task holds
// no contact or question of its own. An edited title that no longer fits shows as it stands.
function surveyTaskContext(task, accountName) {
  const m = /^Follow up: (.*?) — (.*)$/s.exec(task.title || "");
  if (!m) return [task.title, accountName].filter(Boolean).join(" · ");
  const cut = m[2].lastIndexOf(": ");
  return [m[1], accountName, cut > 0 ? m[2].slice(0, cut) : m[2]].filter(Boolean).join(" · ");
}
function SurveyOutcomeDialog({ task, user, dispatch, onClose, accountName }) {
  const [result, setResult] = useState("");
  const [note, setNote] = useState("");
  const last = task.surveyOutcome; // a reopened task keeps this until it is completed again
  const save = () => {
    if (!result) return;
    dispatch({ type: "COMPLETE_SURVEY_TASK", id: task.id, outcome: { result, note: note.trim(), by: user.name, at: new Date().toISOString() } });
    onClose();
  };
  return (
    <Modal label="Complete follow-up" onClose={onClose} data-survey-outcome-dialog>
      <div className="so-dlg">
        <h3 className="mb-1 text-sm font-bold text-slate-800">Complete follow-up</h3>
        <p data-outcome-context className="mb-3 text-xs text-slate-600" style={{ overflowWrap: "anywhere" }}>{surveyTaskContext(task, accountName)}</p>
        {last && <p data-survey-last-outcome className="mb-3 text-xs text-slate-600" style={{ overflowWrap: "anywhere" }}>Last outcome: {[last.result, last.note].filter(Boolean).join(" · ")}</p>}
        <fieldset className="mb-3 min-w-0">
          <legend className="mb-1 text-xs font-semibold text-slate-700">What happened?</legend>
          {SURVEY_OUTCOMES.map(o => (
            <label key={o} data-outcome-option className="so-opt text-sm text-slate-800">
              <input type="radio" name="survey-outcome" value={o} checked={result === o} onChange={() => setResult(o)} />{o}
            </label>))}
        </fieldset>
        <label className="mb-3 block text-xs text-slate-700">Note (optional)
          <textarea data-outcome-note className="so-note nm-inset mt-1 px-3 py-2 text-sm text-slate-800 outline-none" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Btn data-outcome-cancel onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" data-outcome-save disabled={!result} onClick={save}>Complete task</Btn>
        </div>
      </div>
    </Modal>
  );
}
// The one tick handler for all three task lists. An Open survey task asks for an outcome first;
// everything else, including un-ticking a done survey task, toggles as it always has. The dialog
// is returned for the page root because the account card's checkbox sits inside a <label>.
function useSurveyOutcome(st, user, dispatch) {
  const [id, setId] = useState(null);
  const tick = t => { if (isOpenSurveyTask(t)) setId(t.id); else dispatch({ type: "TOGGLE_TASK", id: t.id }); };
  const task = id ? st.tasks.find(t => t.id === id) : null;
  const acct = task ? st.accounts.find(a => a.id === task.accountId) : null;
  const dialog = task && isOpenSurveyTask(task)
    ? <SurveyOutcomeDialog task={task} user={user} dispatch={dispatch} onClose={() => setId(null)} accountName={acct ? acct.name : ""} />
    : null;
  return { tick, dialog };
}
