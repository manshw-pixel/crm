// Pure logic with real module boundaries. build.mjs bundles this file and assigns every
// export to globalThis before the app script runs, so src/NN-*.jsx keep using these
// names as globals. Each module must stay free of window/document/React/store access.
export * from "./dates.js";
export * from "./money.js";
export * from "./qbr.js";
export * from "./scoring.js";
export * from "./retention.js";
export * from "./analytics.js";
export * from "./csv.js";
export * from "./urls.js";
export * from "./ids.js";
export * from "./audit.js";
export * from "./reducer.js";
export * from "./write-queue.js";
export * from "./theme.js";
