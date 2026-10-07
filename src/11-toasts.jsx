/* ------------------------------ toasts ------------------------------ */
const ToastCtx = React.createContext(() => {});
const useToast = () => useContext(ToastCtx);
const TOAST_TONE = {
  info: "border-slate-300 text-slate-800",
  success: "border-emerald-300 text-emerald-800",
  error: "border-rose-300 text-rose-700",
};
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});
  const dismiss = useCallback(id => {
    clearTimeout(timers.current[id]); delete timers.current[id];
    setToasts(ts => ts.filter(t => t.id !== id));
  }, []);
  const pushToast = useCallback(({ text, tone = "info", undo }) => {
    const id = uid();
    // errors never auto-dismiss: a failed write may not have reached the team
    setToasts(ts => [...ts, { id, text, tone, undo }].slice(-3));
    if (tone !== "error") timers.current[id] = setTimeout(() => dismiss(id), undo ? 10000 : 5000);
    return id;
  }, [dismiss]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  useEffect(() => { window.__toast = pushToast; }, [pushToast]);
  return (
    <ToastCtx.Provider value={pushToast}>
      {children}
      {/* phones: full width with 12px margins, lifted clear of the iPhone home bar; sm+: the
          320px bottom-right stack */}
      <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-80" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} data-toast data-tone={t.tone} role={t.tone === "error" ? "alert" : "status"}
               className={`nm flex items-start gap-2 border-l-4 p-3 text-sm ${TOAST_TONE[t.tone]}`}>
            <span className="flex-1 whitespace-pre-line">{t.text}</span>
            {t.undo && <button data-toast-undo className="font-bold text-indigo-600 hover:underline"
              onClick={() => { t.undo(); dismiss(t.id); }}>Undo</button>}
            <button aria-label="Dismiss notification" className="text-slate-400 hover:text-slate-700"
              onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

