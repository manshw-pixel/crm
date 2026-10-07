/* ----------------------------- tiny charts ----------------------------- */
function Sparkline({ points, w = 220, h = 48 }) {
  if (!points.length) return null;
  const vals = points.map(p => p.s);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 100);
  const xy = points.map((p, i) => [8 + (i * (w - 16)) / Math.max(points.length - 1, 1), h - 6 - ((p.s - min) / (max - min || 1)) * (h - 12)]);
  const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = points[points.length - 1].s;
  return (
    <svg width={w} height={h}>
      <path d={d} fill="none" stroke={RISK_HEX[riskOf(last)]} strokeWidth="2" />
      {xy.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={RISK_HEX[riskOf(points[i].s)]} />)}
    </svg>
  );
}
function TrendLine({ label, points, months, fmt, w = 150, h = 28 }) {
  const vals = points.map(v => v === null || v === undefined ? null : +v);
  const nums = vals.filter(v => v !== null);
  if (!nums.length) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  const xy = vals.map((v, i) => v === null ? null : [4 + (i * (w - 8)) / Math.max(vals.length - 1, 1), h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]).filter(Boolean);
  const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = nums[nums.length - 1], first = nums[0];
  return (
    <div className="flex items-center gap-2" title={months.map((m, i) => `${m}: ${fmt(vals[i])}`).join("\n")}>
      <span className="w-28 shrink-0 text-xs text-slate-500">{label}</span>
      <svg width={w} height={h}><path d={d} fill="none" stroke={last >= first ? "#10b981" : "#f43f5e"} strokeWidth="2" />
        {xy.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" style={{ fill: "rgb(var(--slate-500))" }} />)}</svg>
      <span className={`text-xs font-bold tabular-nums ${last >= first ? "text-emerald-600" : "text-rose-600"}`}>{fmt(last)}</span>
    </div>
  );
}
/* Roll monthly snapshots up to calendar quarters. Each metric is the average of the
   months present in that quarter (nulls ignored), so a part-way quarter still plots. */
function quarterlySnaps(snaps) {
  const order = [], byQ = new Map();
  (snaps || []).forEach(s => {
    const [y, m] = String(s.month || "").split("-").map(Number);
    if (!y || !m) return;
    const q = `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    if (!byQ.has(q)) { byQ.set(q, []); order.push(q); }
    byQ.get(q).push(s);
  });
  const avg = (list, key) => {
    const nums = list.map(s => s[key]).filter(v => v !== null && v !== undefined && !isNaN(+v)).map(Number);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  return order.map(q => {
    const list = byQ.get(q);
    return { quarter: q, months: list.length, totalARR: avg(list, "totalARR"), nrr: avg(list, "nrr"), grr: avg(list, "grr") };
  });
}
/* full line chart: gridlines, axis labels, hover tooltip (snapshots are monthly) */
function LineChart({ title, points, months, fmt, color = "#6366f1", w = 340, h = 160 }) {
  const [hov, setHov] = useState(null);
  const vals = points.map(v => v === null || v === undefined ? null : +v);
  const nums = vals.filter(v => v !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  const padL = 44, padR = 10, padT = 14, padB = 22;
  const X = i => padL + (i * (w - padL - padR)) / Math.max(vals.length - 1, 1);
  const Y = v => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
  const xy = vals.map((v, i) => v === null ? null : [X(i), Y(v)]);
  const d = xy.filter(Boolean).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const ticks = [min, (min + max) / 2, max];
  const lblEvery = Math.ceil(months.length / 6);
  const move = e => {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - box.left) * (w / box.width);
    let best = 0; vals.forEach((v, i) => { if (v !== null && Math.abs(X(i) - fx) < Math.abs(X(best) - fx)) best = i; });
    setHov(vals[best] === null ? null : best);
  };
  return (
    <div>
      <div className="mb-1 text-xs font-bold text-slate-500">{title}</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" onMouseMove={move} onMouseLeave={() => setHov(null)}>
        {ticks.map((t, i) => <g key={i}>
          <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} style={{ stroke: "rgb(var(--slate-200))" }} strokeWidth="1" />
          <text x={padL - 4} y={Y(t) + 3} textAnchor="end" fontSize="9" style={{ fill: "rgb(var(--slate-400))" }}>{fmt(t)}</text>
        </g>)}
        {months.map((m, i) => i % lblEvery === 0 && <text key={m} x={X(i)} y={h - 8} textAnchor="middle" fontSize="9" style={{ fill: "rgb(var(--slate-400))" }}>{m.slice(2)}</text>)}
        <path d={d} fill="none" stroke={color} strokeWidth="2" />
        {xy.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={hov === i ? 4 : 2.5} fill={color} />)}
        {hov !== null && xy[hov] && <g>
          <line x1={xy[hov][0]} x2={xy[hov][0]} y1={padT} y2={h - padB} style={{ stroke: "rgb(var(--slate-300))" }} strokeDasharray="3 3" />
          <rect x={Math.min(xy[hov][0] + 6, w - 96)} y={padT} width="90" height="28" rx="4" style={{ fill: "rgb(var(--slate-900))" }} opacity="0.85" />
          <text x={Math.min(xy[hov][0] + 6, w - 96) + 6} y={padT + 12} fontSize="9" style={{ fill: "rgb(var(--slate-200))" }}>{months[hov]}</text>
          <text x={Math.min(xy[hov][0] + 6, w - 96) + 6} y={padT + 23} fontSize="10" fontWeight="bold" fill="#fff">{fmt(vals[hov])}</text>
        </g>}
      </svg>
    </div>
  );
}
/* stacked bars of per-month counts (e.g. Green/Yellow/Red account mix) */
function StackedBars({ months, series, w = 340, h = 160 }) {
  const [hov, setHov] = useState(null);
  if (!months.length) return null;
  const totals = months.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] || 0), 0));
  const max = Math.max(...totals, 1);
  const padL = 30, padR = 10, padT = 14, padB = 22;
  const bw = Math.min(24, ((w - padL - padR) / months.length) * 0.7);
  const X = i => padL + ((i + 0.5) * (w - padL - padR)) / months.length;
  const H = v => (v / max) * (h - padT - padB);
  const lblEvery = Math.ceil(months.length / 6);
  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-xs font-bold text-slate-500">Health mix (accounts)
        {series.map(sr => <span key={sr.label} className="flex items-center gap-1 font-normal"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: sr.color }} />{sr.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" onMouseLeave={() => setHov(null)}>
        <text x={padL - 4} y={padT + 3} textAnchor="end" fontSize="9" style={{ fill: "rgb(var(--slate-400))" }}>{max}</text>
        <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} style={{ stroke: "rgb(var(--slate-200))" }} />
        {months.map((m, i) => {
          let y = h - padB;
          return (
            <g key={m} onMouseEnter={() => setHov(i)}>
              {series.map(sr => { const bh = H(sr.values[i] || 0); y -= bh;
                return <rect key={sr.label} x={X(i) - bw / 2} y={y} width={bw} height={bh} fill={sr.color} opacity={hov === null || hov === i ? 1 : 0.4} />; })}
              {i % lblEvery === 0 && <text x={X(i)} y={h - 8} textAnchor="middle" fontSize="9" style={{ fill: "rgb(var(--slate-400))" }}>{m.slice(2)}</text>}
            </g>
          );
        })}
        {hov !== null && <g>
          <rect x={Math.min(X(hov) + 6, w - 120)} y={padT} width="114" height={14 + series.length * 11} rx="4" style={{ fill: "rgb(var(--slate-900))" }} opacity="0.85" />
          <text x={Math.min(X(hov) + 6, w - 120) + 6} y={padT + 11} fontSize="9" style={{ fill: "rgb(var(--slate-200))" }}>{months[hov]} · {totals[hov]} accounts</text>
          {series.map((sr, si) => <text key={sr.label} x={Math.min(X(hov) + 6, w - 120) + 6} y={padT + 22 + si * 11} fontSize="9" fill={sr.color}>{sr.label}: {sr.values[hov] || 0}</text>)}
        </g>}
      </svg>
    </div>
  );
}
function DistBar({ counts }) {
  const total = counts.Green + counts.Yellow + counts.Red || 1;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded">
        {["Green", "Yellow", "Red"].map(k => counts[k] > 0 && (
          <div key={k} style={{ width: (100 * counts[k]) / total + "%", background: RISK_HEX[k] }} title={`${k}: ${counts[k]}`} />
        ))}
      </div>
      <div className="mt-1 flex gap-4 text-xs text-slate-700">
        {["Green", "Yellow", "Red"].map(k => <span key={k}><span className="inline-block h-2 w-2 rounded-full mr-1" style={{ background: RISK_HEX[k] }}></span>{k} {counts[k]}</span>)}
      </div>
    </div>
  );
}

