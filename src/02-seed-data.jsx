/* ------------------------------- seed data ------------------------------- */
function seedData() {
  const mk = (id, name, tier, arr, industry, csm, startOff, renewOff, status, inputs, hist) => ({
    id, name, tier, arr, industry, csm, contractStatus: status,
    startDate: addDays(startOff), renewalDate: addDays(renewOff), inputs,
    history: hist.map(([off, s]) => ({ d: addDays(off), s })),
  });
  const accounts = [
    mk("a1", "Northwind Analytics", "Enterprise", 240000, "Data & BI", "Priya", -700, 45, "Active", { usage: 82, sentiment: 75, tickets: 2, nps: 40 }, [[-90,74],[-60,76],[-30,78],[-7,79]]),
    mk("a2", "Bluepeak Logistics", "Enterprise", 180000, "Logistics", "Priya", -420, 130, "Active", { usage: 44, sentiment: 38, tickets: 7, nps: -20 }, [[-90,61],[-60,55],[-30,48],[-7,41]]),
    mk("a3", "Cobalt Health", "Mid", 96000, "Healthcare", "Marco", -380, 25, "In negotiation", { usage: 68, sentiment: 62, tickets: 3, nps: 20 }, [[-90,66],[-60,64],[-30,63],[-7,62]]),
    mk("a4", "Fernwood Retail", "Mid", 72000, "Retail", "Marco", -600, 200, "Active", { usage: 91, sentiment: 85, tickets: 1, nps: 60 }, [[-90,80],[-60,83],[-30,86],[-7,88]]),
    mk("a5", "Quartz Financial", "Enterprise", 310000, "FinTech", "Sana", -900, 80, "Active", { usage: 58, sentiment: 50, tickets: 5, nps: 0 }, [[-90,63],[-60,60],[-30,55],[-7,52]]),
    mk("a6", "Helio Studios", "SMB", 24000, "Media", "Sana", -200, 55, "Active", { usage: 35, sentiment: 30, tickets: 4, nps: -40 }, [[-90,45],[-60,40],[-30,36],[-7,33]]),
    mk("a7", "Trellis EdTech", "SMB", 30000, "Education", "Marco", -300, 160, "Active", { usage: 77, sentiment: 70, tickets: 0, nps: 30 }, [[-90,70],[-60,72],[-30,74],[-7,75]]),
    mk("a8", "Argon Manufacturing", "Mid", 120000, "Manufacturing", "Priya", -500, 100, "Auto-renew", { usage: 62, sentiment: 66, tickets: 2, nps: 10 }, [[-90,64],[-60,65],[-30,66],[-7,66]]),
  ];
  const contacts = [
    { id: uid(), accountId: "a1", name: "Dana Whitfield", role: "VP Analytics", email: "dana@northwind.io", isChampion: true, sentiment: "Positive" },
    { id: uid(), accountId: "a1", name: "Tom Erikson", role: "IT Admin", email: "tom@northwind.io", isChampion: false, sentiment: "Neutral" },
    { id: uid(), accountId: "a2", name: "Luis Baraja", role: "Ops Director", email: "luis@bluepeak.com", isChampion: false, sentiment: "Negative" },
    { id: uid(), accountId: "a3", name: "Amara Osei", role: "CIO", email: "amara@cobalthealth.org", isChampion: true, sentiment: "Neutral" },
    { id: uid(), accountId: "a4", name: "Jenny Park", role: "Head of Ecom", email: "jenny@fernwood.shop", isChampion: true, sentiment: "Positive" },
    { id: uid(), accountId: "a5", name: "Robert Klein", role: "COO", email: "rk@quartzfin.com", isChampion: false, sentiment: "Neutral" },
    { id: uid(), accountId: "a6", name: "Mia Torres", role: "Founder", email: "mia@heliostudios.tv", isChampion: false, sentiment: "Negative" },
    { id: uid(), accountId: "a7", name: "Sam Idowu", role: "Product Lead", email: "sam@trellis.ed", isChampion: true, sentiment: "Positive" },
    { id: uid(), accountId: "a8", name: "Karen Voss", role: "Plant Manager", email: "kv@argonmfg.com", isChampion: false, sentiment: "Neutral" },
  ];
  const activities = [
    { id: uid(), accountId: "a1", type: "QBR", date: addDays(-12), summary: "Q2 QBR — strong adoption, discussed analytics add-on." },
    { id: uid(), accountId: "a1", type: "email", date: addDays(-3), summary: "Sent renewal quote and add-on pricing." },
    { id: uid(), accountId: "a2", type: "ticket", date: addDays(-38), summary: "Escalation: API latency in EU region." },
    { id: uid(), accountId: "a3", type: "call", date: addDays(-9), summary: "Renewal negotiation call — pushing for multi-year discount." },
    { id: uid(), accountId: "a4", type: "note", date: addDays(-5), summary: "Champion promoted to Director — congratulated, very engaged." },
    { id: uid(), accountId: "a5", type: "call", date: addDays(-21), summary: "Usage review — seat utilization down 15% QoQ." },
    { id: uid(), accountId: "a6", type: "email", date: addDays(-44), summary: "No reply to two check-in emails." },
    { id: uid(), accountId: "a7", type: "QBR", date: addDays(-15), summary: "First QBR — happy, exploring LMS integration." },
    { id: uid(), accountId: "a8", type: "call", date: addDays(-6), summary: "Routine check-in, stable usage." },
  ];
  const tasks = [
    { id: uid(), accountId: "a1", title: "Send renewal contract", due: addDays(3), priority: "High", status: "Open", owner: "Priya" },
    { id: uid(), accountId: "a2", title: "Schedule exec escalation call", due: addDays(1), priority: "High", status: "Open", owner: "Priya" },
    { id: uid(), accountId: "a3", title: "Prepare multi-year proposal", due: addDays(5), priority: "High", status: "Open", owner: "Marco" },
    { id: uid(), accountId: "a5", title: "Run adoption workshop", due: addDays(10), priority: "Medium", status: "Open", owner: "Sana" },
    { id: uid(), accountId: "a6", title: "Try phone outreach to founder", due: addDays(2), priority: "High", status: "Open", owner: "Sana" },
    { id: uid(), accountId: "a4", title: "Intro expansion (2 new regions)", due: addDays(14), priority: "Low", status: "Open", owner: "Marco" },
    { id: uid(), accountId: "a8", title: "Confirm auto-renew terms", due: addDays(30), priority: "Low", status: "Open", owner: "Priya" },
  ];
  const opportunities = [
    { id: uid(), accountId: "a1", type: "upsell", value: 60000, stage: "Proposal", closeDate: addDays(40) },
    { id: uid(), accountId: "a4", type: "cross-sell", value: 24000, stage: "Discovery", closeDate: addDays(75) },
    { id: uid(), accountId: "a7", type: "upsell", value: 12000, stage: "Discovery", closeDate: addDays(90) },
    { id: uid(), accountId: "a5", type: "upsell", value: 45000, stage: "Stalled", closeDate: addDays(120) },
  ];
  accounts.forEach((a, i) => { a.currency = "USD"; a.inputsUpdatedAt = addDays(-10); a.accountNo = i + 1; });
  // QBR cadence demo: a1 healthy quarterly, a2 overdue, a5 due soon
  Object.assign(accounts[0], { qbrFrequency: "Quarterly", nextQbrDate: addDays(78) });
  Object.assign(accounts[1], { qbrFrequency: "Quarterly", nextQbrDate: addDays(-9) });
  Object.assign(accounts[4], { qbrFrequency: "Semi-annual", nextQbrDate: addDays(12) });
  Object.assign(accounts[1], { currency: "INR", arr: 15000000 });   // Bluepeak billed in ₹
  Object.assign(accounts[5], { currency: "PHP", arr: 1400000 });    // Helio billed in ₱
  accounts[4].inputsUpdatedAt = addDays(-55);                        // Quartz: stale-inputs demo
  return { accounts, contacts, activities, tasks, opportunities, team: [], settings: { weights: { ...DEFAULT_WEIGHTS }, recencyMix: mergeSettings({}).recencyMix, valueMix: { ...DEFAULT_VALUE_MIX }, rates: { ...DEFAULT_RATES }, integrations: { processed: {}, log: [] }, segments: [] } };
}

const emptyData = () => ({ accounts: [], contacts: [], activities: [], tasks: [], opportunities: [], team: [], settings: { weights: { ...DEFAULT_WEIGHTS }, recencyMix: mergeSettings({}).recencyMix, valueMix: { ...DEFAULT_VALUE_MIX }, rates: { ...DEFAULT_RATES }, integrations: { processed: {}, log: [] }, segments: [] } });

