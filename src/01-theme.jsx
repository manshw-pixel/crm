/* ------------------------------ theme (browser glue) ------------------------------
   The no-flash script in crm.html's <head> applies the stored theme before first paint.
   This keeps it live: applies changes, follows the device in Auto, and follows other tabs.
   Decisions live in src/lib/theme.js (normalizeChoice, resolveTheme, nextChoice). */
const readThemeChoice = () => { try { return normalizeChoice(localStorage.getItem(THEME_KEY)); } catch { return "auto"; } };
const writeThemeChoice = c => { try { localStorage.setItem(THEME_KEY, c); } catch {} };
const systemPrefersDark = () => !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
function applyTheme(choice) {
  const t = resolveTheme(choice, systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
  root.style.colorScheme = t;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = t === "dark" ? "#0b1120" : "#f6f8fb";
  return t;
}
function useTheme() {
  const [choice, setChoice] = React.useState(readThemeChoice);
  const [effective, setEffective] = React.useState(() => resolveTheme(choice, systemPrefersDark()));
  React.useEffect(() => {
    setEffective(applyTheme(choice));
    if (choice !== "auto" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setEffective(applyTheme("auto"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);
  React.useEffect(() => {
    const onStorage = e => { if (e.key === THEME_KEY) setChoice(normalizeChoice(e.newValue)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const choose = c => { const n = normalizeChoice(c); writeThemeChoice(n); setChoice(n); };
  return { choice, effective, choose };
}
