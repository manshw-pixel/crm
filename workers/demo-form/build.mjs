// Bundles the Worker into ONE file, so it can be pasted into the Cloudflare
// dashboard editor (which cannot install npm packages). Output: workers/demo-form/dist/worker.js
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const here = p => fileURLToPath(new URL(p, import.meta.url));
await esbuild.build({
  entryPoints: [here("./src/index.js")],
  outfile: here("./dist/worker.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  mainFields: ["module", "main"],
  legalComments: "inline",
});
console.log("workers/demo-form/dist/worker.js written - paste it into the Cloudflare Worker editor");
