// -----------------------------------------------------------------------------
// Rota shared client helpers
// Loaded on every page BEFORE any page-specific script.
// -----------------------------------------------------------------------------

const API_URL = window.location.origin + '/api';

// -- Session / cache accessors ------------------------------------------------

function getToken()       { return localStorage.getItem('rota_token'); }
function getUser()        { const u = localStorage.getItem('rota_user'); return u ? JSON.parse(u) : null; }
function getHouseholdId() { return localStorage.getItem('rota_household_id'); }

function saveSession(token, user) {
  localStorage.setItem('rota_token', token);
  localStorage.setItem('rota_user', JSON.stringify(user));
}

// FIX (Bug #1, #2): Targeted cache clear for household-scoped state.
// When a user leaves a household we must remove the id, the cached name,
// and every per-household task cache (rota_tasks_<id>). Before this fix
// the tasks cache lingered and leaked across memberships.
function clearHouseholdCache() {
  localStorage.removeItem('rota_household_id');
  localStorage.removeItem('rota_current_group');
  Object.keys(localStorage)
    .filter(k => k.startsWith('rota_tasks_'))
    .forEach(k => localStorage.removeItem(k));
}

function clearSession() {
  localStorage.clear();
  window.location.href = 'Register.html';
}

// -- Fetch wrapper ------------------------------------------------------------

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // FIX (Bug #1, #2): cache:'no-store' so auth + membership responses are
  // always fresh. Combined with the backend Cache-Control header, this
  // prevents a stale 200 keeping a user "in" a household they just left.
  const res = await fetch(API_URL + path, { ...options, headers, cache: 'no-store' });
  if (res.status === 401) { clearSession(); return; }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error((data && (data.error || data.message)) || 'Request failed');
  return data;
}

// -- Membership helpers -------------------------------------------------------

// FIX (Bug #1, #2): The SINGLE source of truth for "am I in a household?".
// Every protected page and the loading screen must call this rather than
// trusting localStorage. If the server says no household, localStorage is
// wiped so stale ids can never sneak back through.
async function resolveMembership() {
  try {
    const hhs = await apiFetch('/households/mine');
    if (Array.isArray(hhs) && hhs.length > 0) {
      localStorage.setItem('rota_household_id', hhs[0].id);
      localStorage.setItem('rota_current_group', hhs[0].name);
      return hhs[0];
    }
    clearHouseholdCache();
    return null;
  } catch (err) {
    // Network / server error: DO NOT wipe state, DO NOT pretend we're in a
    // household. Re-throw so the caller can decide between "stay where you
    // are" and "bounce to home".
    throw err;
  }
}

// FIX (Bug #1, #2): Route guard for any page that requires a household
// (dashboard, leaderboard of "my house", etc.). Call at the top of each
// protected page script:
//
//   const hh = await requireMembership();
//   if (!hh) return;                       // redirect already queued
//   const householdId = hh.id;
//
// Unlike the old pattern of "if (!getHouseholdId()) window.location = 'Register.html'",
// this always checks the server and routes to home.html with a toast when
// the user is not in a household. It never sends an unauthenticated but
// token-holding user back to Register.html — that's a logout action, not
// a "no household" action.
async function requireMembership() {
  if (!getToken()) { window.location.href = 'Register.html'; return null; }
  let hh = null;
  try {
    hh = await resolveMembership();
  } catch (err) {
    // Server unreachable — stay on the current page rather than logging out.
    console.warn('Membership check failed, keeping current view:', err.message);
    // If we already have a cached id, let the page try to render with it;
    // if the API really is down the subsequent fetches will surface the error.
    const cachedId = getHouseholdId();
    return cachedId ? { id: cachedId, name: localStorage.getItem('rota_current_group') || '' } : null;
  }
  if (!hh) {
    sessionStorage.setItem('rota_flash', JSON.stringify({
      type: 'info',
      msg: "You're not in a household yet. Create or join one to continue."
    }));
    window.location.href = 'home.html';
    return null;
  }
  return hh;
}

// For pages that require a token but NOT a household (profile, home).
async function requireAuth() {
  if (!getToken()) { window.location.href = 'Register.html'; return false; }
  return true;
}

// -- Misc helpers -------------------------------------------------------------

// FIX (Bug #7): Real-time relative date. Renders "2 days ago", "3 months ago",
// "1 year ago", etc. Falls back to the string 'recently' only if the ISO
// date is missing entirely (e.g. legacy user row).
function relativeSince(iso) {
  if (!iso) return 'recently';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const seconds = Math.max(1, Math.floor((Date.now() - then) / 1000));
  const units = [
    ['year',   60 * 60 * 24 * 365],
    ['month',  60 * 60 * 24 * 30],
    ['week',   60 * 60 * 24 * 7],
    ['day',    60 * 60 * 24],
    ['hour',   60 * 60],
    ['minute', 60]
  ];
  for (const [name, sec] of units) {
    const n = Math.floor(seconds / sec);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}
