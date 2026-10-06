/** @type {import('tailwindcss').Config} */
// Scans crm.html and src/**/*.jsx (the app code). Every dynamic className in the app splices WHOLE class strings
// from ternaries or lookup tables (there is no `bg-${x}` fragment construction), so the
// static scanner sees every class the app can ever render. If that ever stops being
// true, the class will silently vanish from the build -- add it to `safelist` here.
export default {
  content: ["./crm.html", "./src/**/*.jsx"],
  theme: { extend: {} },
  plugins: [],
};
