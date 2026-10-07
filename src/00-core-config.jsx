/*
 * ============================================================================
 * HEALTH SCORE LOGIC
 * ----------------------------------------------------------------------------
 * score = w.usage*usage + w.sentiment*sentiment + w.tickets*ticketScore
 *       + w.recency*recencyScore + w.nps*npsNorm + w.value*valueScore   (weights sum to 1)
 *
 *   usage, sentiment : stored per-account, 0..100
 *   ticketScore      : 100 - min(openTickets*10, 100)
 *   recencyScore     : 100 if last activity <=7 days ago, linear to 0 at 60d
 *   npsNorm          : (nps + 100) / 2   (NPS -100..100 -> 0..100)
 *   valueScore       : sub-weighted Yes/No answers (inputs.value); recency: per-type blend when settings.recencyMix.enabled
 *
 * Risk: score >=70 Green | 40..69 Yellow | <40 Red
 *
 * TO EXTEND: add a key to DEFAULT_WEIGHTS + a component fn in scoreComponents()
 * — the weight sliders, formula display, and normalization pick it up
 * automatically.
 * ============================================================================
 */
const { useState, useEffect, useReducer, useMemo, useRef, useCallback, useContext } = React;

/* ==================== TEAM CONFIG — EDIT THESE TWO LINES ====================
 * 1. Create a free project at https://supabase.com
 * 2. Run supabase-setup.sql in its SQL Editor
 * 3. Paste Project Settings -> API -> "Project URL" and "anon public" key here.
 * The anon key is safe to publish; access is enforced by database rules. */
// build.mjs replaces this exact literal with the short commit SHA. Kept as a plain literal
// rather than a placeholder token so the source stays runnable un-built.
const APP_VERSION = "dev";
const SUPABASE_URL = "https://avrtiyfoxlvxwqdkrznd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2cnRpeWZveGx2eHdxZGtyem5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNTA1NjUsImV4cCI6MjA5ODcyNjU2NX0.D0rhXOgtn4Prfx_2opJHLhmsuCCEI3jTICw7DjfYX2Y";
/* =========================================================================== */
const CONFIGURED = SUPABASE_URL.startsWith("https://") && SUPABASE_ANON_KEY.length > 30;
// __sbFactory is the test seam: the E2E harness installs an in-memory Supabase mock here
// before the app boots. It is never set in production, so the real client is what ships.
// (This replaced a regex-over-source-text swap in harness.mjs, which could not survive
// JSX compilation -- see docs/superpowers/specs/2026-08-17-build-step-design.md.)
// Read at module scope, BEFORE the client is constructed: detectSessionInUrl consumes
// the `#access_token=...&type=recovery` fragment and wipes it from the address bar, so by
// the time React renders there is nothing left to tell a recovery link apart from an
// ordinary sign-in. Miss this and a reset link just silently logs you in with no way to
// set a new password -- which is exactly what happened before this existed.
const IS_RECOVERY = typeof location !== "undefined" && /[#&]type=recovery/.test(location.hash || "");
// Where a reset/invite mail should send people back to. Passed explicitly on every call:
// with no redirectTo, GoTrue falls back to the project's Site URL, which shipped as the
// default http://localhost:3000 and sent every reset link to a dead address.
const authRedirect = () => location.href.split("#")[0].split("?")[0];
const sb = window.__sbFactory ? window.__sbFactory()
  : CONFIGURED ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// supabase-js 2.45 keeps the stored session when the server answers sign-out with 403
// session_not_found (the session already ended server-side): signOut() resolves { error },
// SIGNED_OUT never fires, and the button looks dead. So on any failure clear the stored
// session ourselves and reload -- the user asked to leave, and leaving must not depend on
// the server agreeing the session still exists.
const signOut = async () => {
  let error = null;
  try { ({ error } = (await sb.auth.signOut()) || {}); } catch (e) { error = e; }
  if (!error) return;
  try { localStorage.removeItem(sb.auth.storageKey); } catch {}
  try { sessionStorage.removeItem("onevio.inClient"); } catch {}
  location.reload();
};

// The signed-in user's org, set by Root() once the profile loads. Only uploadFiles needs it
// on the client: every other org decision is made by RLS and the org-stamping RPCs.
let CURRENT_ORG = null;

