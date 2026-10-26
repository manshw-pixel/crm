// Row ids and the entity table list, shared by the reducer, persistOps and the app.
export const uid = () => Math.random().toString(36).slice(2, 10);
export const ENTITY_TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities"];
// Implementation projects live in their own tables, read after the five above. Deliberately NOT in
// ENTITY_TABLES: backup, replace_all and snapshots iterate that list and must stay untouched.
export const IMPL_TABLES = ["projects", "project_tasks"];
