/** @type {import('tailwindcss').Config} */
// Scans crm.html, src/**/*.jsx (the app code) and src/lib/**/*.js. Every dynamic className in the app splices WHOLE class strings
// from ternaries or lookup tables (there is no `bg-${x}` fragment construction), so the
// static scanner sees every class the app can ever render. If that ever stops being
// true, the class will silently vanish from the build -- add it to `safelist` here.
//
// Dark mode: every colour the app uses reads a CSS variable (an "R G B" triplet) defined in
// crm.html -- :root holds Tailwind's stock values (today's light look), html.dark the dark
// ones. <alpha-value> keeps opacity modifiers like bg-scrim/40 working. `gray` is included
// because bare `border`/`divide` default to gray-200.
const v = name => `rgb(var(--${name}) / <alpha-value>)`;
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const family = f => Object.fromEntries(SHADES.map(s => [s, v(`${f}-${s}`)]));
export default {
  content: ["./crm.html", "./src/**/*.jsx", "./src/lib/**/*.js"],
  theme: { extend: { colors: {
    white: v("white"), scrim: v("scrim"), page: v("page"),
    ...Object.fromEntries(["slate", "gray", "indigo", "rose", "amber", "emerald", "sky"].map(f => [f, family(f)])),
  } } },
  plugins: [],
};
