import { daysUntil } from "./dates.js";
export const QBR_FREQS = ["None", "Quarterly", "Semi-annual", "Annual"];
export const QBR_FREQ_MONTHS = { Quarterly: 3, "Semi-annual": 6, Annual: 12 };
/* null = QBRs not applicable (churned, or no frequency and no date set) */
export function qbrStatus(a) {
  if (a.churn) return null;
  const hasFreq = a.qbrFrequency && a.qbrFrequency !== "None";
  if (!hasFreq && !a.nextQbrDate) return null;
  if (!a.nextQbrDate) return { kind: "unscheduled" };
  const d = daysUntil(a.nextQbrDate);
  return d < 0 ? { kind: "overdue", d: -d } : d <= 30 ? { kind: "due", d } : { kind: "scheduled", d };
}
