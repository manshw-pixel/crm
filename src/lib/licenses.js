// Total vs deployed licenses (spec 2026-10-08). `licenses` is Total; `deployedLicenses` is
// optional, and missing/blank means "not recorded" -- which is not the same as 0 deployed.
const toNum = v => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function licenseFigures(a) {
  const total = Math.max(0, toNum(a?.licenses) ?? 0);
  const d = toNum(a?.deployedLicenses);
  const deployed = d == null ? null : Math.max(0, d);
  const pct = total > 0 && deployed != null ? Math.round((deployed / total) * 100) : null;
  return { total, deployed, pct };
}

// Totals and % use only accounts with BOTH figures, so missing data never reads as low deployment.
export function licenseSummary(accounts) {
  let total = 0, deployed = 0, counted = 0, missingDeployed = 0;
  const withBoth = [];
  for (const a of accounts || []) {
    const f = licenseFigures(a);
    if (f.total <= 0) continue;
    counted++;
    if (f.deployed == null) { missingDeployed++; continue; }
    total += f.total; deployed += f.deployed;
    withBoth.push({ id: a.id, name: a.name, total: f.total, deployed: f.deployed, pct: f.pct, ratio: f.deployed / f.total });
  }
  const lowest = withBoth
    .sort((x, y) => x.ratio - y.ratio || String(x.name).localeCompare(String(y.name)))
    .slice(0, 5)
    .map(({ ratio, ...rest }) => rest);
  return { total, deployed, pct: total > 0 ? Math.round((deployed / total) * 100) : null, counted, missingDeployed, lowest };
}
