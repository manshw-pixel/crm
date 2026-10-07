// Row ids and the entity table list, shared by the reducer, persistOps and the app.
export const uid = () => Math.random().toString(36).slice(2, 10);
export const ENTITY_TABLES = ["accounts", "contacts", "activities", "tasks", "opportunities"];
