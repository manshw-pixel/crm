/* ------------------------------ UI atoms ------------------------------ */
const Copyright = () => <div className="mt-6 pb-2 text-center text-[11px] text-slate-500">© 2026 OneVio Pvt Ltd. All Rights Reserved.</div>;
const Chip = ({ risk, children }) => <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${RISK_STYLE[risk]}`}>{children}</span>;
const HealthChip = ({ score }) => <Chip risk={riskOf(score)}>{score}</Chip>;
const Card = ({ title, right, children, className = "", id }) => (
  <div id={id} className={`nm p-4 ${className}`}>
    {(title || right) && <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-widest text-slate-700">{title}</h3>{right}</div>}
    {children}
  </div>
);
// size: "hero" for the headline money/retention numbers, "sm" for the operational row,
// omitted for everything else -- only the type weight changes, never the grid.
const STAT_SIZE = { hero: "text-3xl", sm: "text-xl" };
const Stat = ({ label, value, sub, tone, onClick, size }) => (
  <Card className={onClick ? "cursor-pointer transition hover:border-indigo-300 hover:shadow-md" : ""}>
    <div role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className="outline-none" data-stat={label}>
      <div className={`${size === "sm" ? "truncate " : ""}text-[11px] font-bold uppercase tracking-widest text-slate-500`}>{label}</div>
      <div data-stat-value data-size={size || "md"} className={`mt-1 ${STAT_SIZE[size] || "text-2xl"} font-extrabold tabular-nums ${tone || "text-slate-700"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  </Card>
);
const StatSm = ({ label, value, sub, tone, children }) => (
  <div className="nm-sm flex items-center justify-between gap-3 px-3 py-2">
    <div className="min-w-0">
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      {sub && <div className="truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
    {children || <div className={`text-lg font-extrabold tabular-nums ${tone || "text-slate-700"}`}>{value}</div>}
  </div>
);
// Days to renewal as a chip: rose when overdue or inside 30 days, amber to 60, slate beyond.
const DAYS_CHIP = { overdue: "bg-rose-100 text-rose-700", urgent: "bg-rose-50 text-rose-700", soon: "bg-amber-50 text-amber-700", later: "bg-slate-100 text-slate-600" };
const DaysChip = ({ days }) => {
  const band = days < 0 ? "overdue" : days <= 30 ? "urgent" : days <= 60 ? "soon" : "later";
  return <span data-days-chip={band} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${DAYS_CHIP[band]}`}>{days < 0 ? `${-days}d overdue` : `${days}d`}</span>;
};
// Shown until the first fetch lands, so a full book never flashes as "Fresh start" / $0.
const Bone = ({ className = "" }) => <div className={`animate-pulse rounded bg-slate-200/70 ${className}`} />;
const LoadingSkeleton = ({ view }) => (
  <div data-skeleton aria-busy="true" aria-label="Loading" className="space-y-3">
    {view === "Dashboard" ? <>
      {[3, 3, 4].map((n, r) => <div key={r} className="grid grid-cols-3 gap-3" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {Array.from({ length: n }, (_, i) => <div key={i} className="nm space-y-2 p-4"><Bone className="h-3 w-24" /><Bone className="h-7 w-32" /><Bone className="h-3 w-20" /></div>)}
      </div>)}
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map(i => <div key={i} className="nm space-y-2 p-3"><Bone className="h-3 w-28" />{[0, 1, 2, 3].map(k => <Bone key={k} className="h-5 w-full" />)}</div>)}
      </div>
    </> : <div className="nm space-y-2 p-4">{Array.from({ length: 8 }, (_, k) => <Bone key={k} className="h-6 w-full" />)}</div>}
  </div>
);
// The dashboard's analysis cards, collapsed by default (remembered per user). Collapsed
// hides rather than unmounts, so nothing inside recomputes or loses state on toggle.
const AnalyticsSection = ({ user, children }) => {
  const key = "dashAnalytics_" + (user?.name || "");
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const toggle = () => setOpen(o => { try { localStorage.setItem(key, o ? "0" : "1"); } catch {} return !o; });
  return (
    <div className="space-y-3">
      <button data-analytics-toggle aria-expanded={open} onClick={toggle}
        className="flex w-full items-center gap-2 border-t border-slate-200 pt-3 text-left text-xs font-bold uppercase tracking-widest text-slate-600 hover:text-indigo-600">
        <span>{open ? "▾" : "▸"}</span> Analytics <span className="font-normal normal-case tracking-normal text-slate-500">AM book, declines, trends, cohorts, churn</span>
      </button>
      <div data-analytics className={open ? "space-y-3" : "hidden"}>{children}</div>
    </div>
  );
};
// "More ▾" overflow menu for secondary actions. Falsy items are skipped; Escape or an
// outside click closes it; items are real buttons, so Tab/Enter work.
const MoreMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    // stopPropagation: the App's window-level Escape means "back to list" -- closing the menu must not also leave the account
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]);
  const list = items.filter(Boolean);
  return (
    <div ref={ref} className="relative">
      <Btn data-more-actions aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>More ▾</Btn>
      {open && <div data-more-menu role="menu" className="nm absolute left-0 z-20 mt-1 w-56 p-1">
        {list.map(it => <button key={it.label} role="menuitem"
          className={`block w-full rounded px-3 py-1.5 text-left text-xs font-semibold hover:bg-slate-50 ${it.separate ? "mt-1 border-t border-slate-100 pt-2" : ""} ${it.danger ? "text-rose-600" : "text-slate-700"}`}
          onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>)}
      </div>}
    </div>
  );
};
// A horizontal scroller that says when columns sit past its right edge: a fade and a
// "→ N more" pill, gone once the last column is in view. Columns opt in with data-col.
const HScroll = ({ className = "", children }) => {
  const ref = useRef(null);
  const [more, setMore] = useState(0);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth - el.scrollLeft - el.clientWidth <= 1) { setMore(0); return; }
    const right = el.getBoundingClientRect().right;
    setMore(Array.from(el.querySelectorAll("[data-col]")).filter(c => c.getBoundingClientRect().right > right + 1).length);
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return (
    <div className="relative">
      <div ref={ref} data-board onScroll={measure} className={className}>{children}</div>
      {more > 0 && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex w-24 items-center justify-end bg-gradient-to-l from-[#f6f8fb] to-transparent">
        <span data-board-more={more} className="mr-1 whitespace-nowrap rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600 shadow-sm">→ {more} more</span>
      </div>}
    </div>
  );
};
// A capped, scrollable dashboard list that says when more is hidden: a bottom fade and a
// "N more" pill while rows sit below the fold, nothing at all when the list fits.
// Rows opt in with data-row, so a row holding its own buttons still counts once.
const ScrollList = ({ label, className = "max-h-48", children }) => {
  const ref = useRef(null);
  const [more, setMore] = useState(0);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 1) { setMore(0); return; }
    const bottom = el.getBoundingClientRect().bottom;
    const rows = el.querySelectorAll("[data-row]");
    setMore(Array.from(rows).filter(r => r.getBoundingClientRect().bottom > bottom + 1).length);
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    Array.from(el.children).forEach(c => ro.observe(c));
    return () => ro.disconnect();
  });
  return (
    <div className="relative" data-scroll-list={label}>
      <div ref={ref} onScroll={measure} tabIndex={0} aria-label={label} className={`${className} overflow-y-auto pr-1 outline-none`}>{children}</div>
      {more > 0 && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end justify-center bg-gradient-to-t from-white to-transparent">
        <span data-more-count={more} className="mb-0.5 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600 shadow-sm">↓ {more} more</span>
      </div>}
    </div>
  );
};
const Btn = ({ children, onClick, kind = "default", type = "button", disabled, ...rest }) => (
  <button type={type} onClick={onClick} disabled={disabled} {...rest} className={`px-3.5 py-1.5 text-xs font-bold disabled:opacity-50 ${kind === "primary" ? "grad text-white" : "nm-btn text-slate-700"}`}>{children}</button>
);
const Input = React.forwardRef((p, ref) => <input ref={ref} {...p} className={"nm-inset w-full border-0 px-3 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 " + (p.className || "")} />);
// `labels` is optional and additive: without it every option renders its own value, as
// it always has. With it, a value missing from the map still falls back to the value.
const Select = ({ options, labels, ...p }) => (
  <select {...p} className={"nm-inset border-0 px-3 py-1.5 text-sm text-slate-800 outline-none " + (p.className || "")}>
    {options.map(o => <option key={o} value={o}>{labels ? (labels[o] ?? o) : o}</option>)}
  </select>
);

