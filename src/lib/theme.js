// Light / Dark / Auto. Pure: the browser glue (src/01-theme.jsx) and the no-flash script in
// crm.html's <head> read storage and the device setting and pass them in.
export const THEME_KEY = "onevio.theme";
export const THEME_CHOICES = ["light", "dark", "auto"];
export const normalizeChoice = raw => THEME_CHOICES.includes(raw) ? raw : "auto";
export const resolveTheme = (choice, systemPrefersDark) => {
  const c = normalizeChoice(choice);
  return c === "auto" ? (systemPrefersDark ? "dark" : "light") : c;
};
// the sidebar button's cycle; Settings is admin-only, so this must reach all three
export const nextChoice = choice => ({ light: "dark", dark: "auto", auto: "light" })[normalizeChoice(choice)];
