# App source

The app is one browser script split into ordered files. `build.mjs` joins
`src/*.jsx` in filename order, with nothing in between, into the
`<script type="text/babel">` block of `crm.html`, then compiles it. There are
no imports or exports: every top-level name is a global, exactly as when this
was a single file.

- Add code to the file for its area.
- A new area gets a new file named `NN-name.jsx`. The two-digit prefix is its
  load order; pick a number between its neighbours, or renumber.
- Top-level `const`s must be defined in an earlier file than any top-level code
  that runs immediately and uses them. Functions can be used from anywhere.
- Never put code back in `crm.html`'s script block. The build refuses.
- Supabase URL and anon key: the TEAM CONFIG block in `00-core-config.jsx`.
