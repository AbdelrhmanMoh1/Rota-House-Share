# Rota — Fixed build

Two folders in this archive:

- `backend/` — Node.js + Express + PostgreSQL API
- `frontend/` — HTML / CSS / JS static site

## Running

1. **Backend**
   ```bash
   cd backend
   cp .env       
   npm install
   node scripts/migrate.js    # create tables
   node scripts/seed.js       # optional sample data
   npm start                  # (or: node src/index.js)
   ```
   Server listens on `http://localhost:3000`.

2. **Frontend**
   Either let the backend serve it (`http://localhost:3000/`) — `index.js`
   looks for the frontend folder next to it — or open any `.html` in a static
   server such as VSCode Live Server on port 5500.

## What was changed (mapped to your 7 bugs)

### 1 + 2 — Leaving a household / navigation bounces back into it
- `backend/src/controllers/householdController.js` — **new** `leaveHousehold`
  function. Transactional DELETE on `household_members`, auto-promotes the
  oldest remaining member if the last admin leaves, deletes the household
  row if nobody is left.
- `backend/src/routes/households.js` — new `DELETE /:householdId/members/me`
  route. `/mine` and `/auth/me` both get `Cache-Control: no-store`.
- `frontend/api.js` — `resolveMembership()` is the single source of truth.
  `requireMembership()` is the page guard that hits the server fresh and
  bounces to `home.html` (never `Register.html`) when membership is gone.
  `clearHouseholdCache()` wipes `rota_household_id`, `rota_current_group`,
  and every `rota_tasks_<id>` key.
- `frontend/groupDashboard.js` — `handleLeaveGroup` now calls the backend
  DELETE endpoint before clearing local state.
- `frontend/leaderboard.js` + `leaderboard.html` — the interceptor that
  forced Account clicks through the loading screen (and thereby re-admitted
  users to their old household) is **deleted**.
- `frontend/loading.js` — uses `resolveMembership`; on network error it
  goes to `home.html` instead of logging the user out.

### 3 — Dark mode icons invisible
- `frontend/profile.css` — two new tokens (`--surface-inset`, `--icon`);
  all icon parents use `color: var(--icon)` so flipping the variable
  re-colours every Lucide SVG via `currentColor`. `.earned .badge-circle`
  now uses `#ffffff` stroke on the primary background in dark mode so
  icons don't vanish. `.badge-item.locked` drops the greyscale filter in
  dark mode.

### 4 — Achievements shouldn't show when empty
- `frontend/profile.html` — hard-coded badge markup removed; now an empty
  `<div id="badgesGrid">`.
- `frontend/profile.js` — `renderAchievements(list)` renders a friendly
  empty-state (keeps the card visible so the feature is discoverable)
  when the list is empty, otherwise renders real badges.

### 5 — Notifications not working
- `frontend/toast.js` + `frontend/toast.css` — reusable toast system with
  info / success / error / warning types, auto-dismiss, and cross-page
  flash via `sessionStorage.rota_flash`.
- All `alert()` calls replaced with `toast()` across `createGroup.js`,
  `joinGroup.js`, `register.js`, `profile.js`, `groupDashboard.js`.
- Flash messages fire automatically on: leaving a household, being
  redirected out of a protected page, successful house creation or join,
  profile update, dark mode toggle.

### 6 — Edit Profile modal
- `frontend/profile.html` — in-page modal markup.
- `frontend/profile.css` — modal, backdrop, avatar-picker, and button
  styles.
- `frontend/profile.js` — `wireEditProfile(user)` prefills the form,
  validates name/email, supports emoji presets + image upload (capped at
  512 KB), PUTs `/auth/me`, then repaints the page.
- `backend/src/controllers/authController.js` — `updateProfile` now
  accepts `email` and runs a uniqueness check before updating.

### 7 — "Member since recently" should be real-time
- `backend/src/middleware/auth.js` — `SELECT` now includes `created_at`,
  so `req.user` (and therefore `GET /auth/me`) has it.
- `backend/src/controllers/authController.js` — `register` / `login` /
  `updateProfile` responses include `created_at`.
- `frontend/api.js` — `relativeSince(iso)` renders "2 days ago",
  "3 months ago", "1 year ago", etc.
- `frontend/profile.js` — `populateProfileUI` uses `relativeSince(user.created_at)`.

## File changelog by path

**Backend rewrites:**
- `src/middleware/auth.js`
- `src/controllers/authController.js`
- `src/controllers/householdController.js`
- `src/routes/auth.js`
- `src/routes/households.js`
- `src/index.js` (frontend path resolution)

**Backend untouched:** everything else (tasks, bills, notifications,
  websocket manager, migrations, seeds).

**Frontend rewrites:**
- `api.js`
- `profile.html`, `profile.js`, `profile.css`
- `groupDashboard.js`
- `leaderboard.js`, `leaderboard.html`
- `loading.js`
- `home.js`

**Frontend new:**
- `toast.js`, `toast.css`

**Frontend edited (toast include, alert → toast, flash messages):**
- `home.html`, `Register.html`, `Groupdashboard.html`, `loadingscreen.html`,
  `createGroup.html`, `joinGroup.html`, `createGroup.js`, `joinGroup.js`,
  `register.js`

**Frontend untouched:** register.css, home.css, leaderboard.css,
  createGroup.css, joinGroup.css, groupDashboard.css, loading.css.

## Smoke-test script (do these after starting the server)

1. Register a fresh user → loading screen → lands on `home.html` with
   the Create / Join cards (no household yet). Profile page shows
   "Member since just now", not "recently".
2. Create a household → dashboard loads with a green flash toast
   showing the invite code.
3. Click **Leave Group** → confirm → lands on `home.html` with a green
   "You have left the household" toast.
4. Click the household icon in the sidebar → bounces back to `home.html`
   with an info toast "You're not in a household yet…".
5. Same check from `leaderboard.html` → dashboard nav → same safe bounce.
6. Toggle **Dark Mode** on the profile page → all Lucide icons remain
   visible, including the badge circles.
7. A user with no achievements sees the "No achievements yet" empty state,
   not four fake badges.
8. Click **Edit Profile** → modal opens → change name / email / avatar
   → Save → toast "Profile updated" → close modal → UI reflects the new
   values and a refreshed "Member since" stays correct.
