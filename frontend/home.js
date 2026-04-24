// -----------------------------------------------------------------------------
// Home page — Create / Join landing. Shown after login when the user has
// no household, and reachable from everywhere as the "escape hatch" when
// the user is not (or is no longer) in a household.
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (localStorage.getItem('rota_theme') === 'dark') document.body.classList.add('dark-mode');

  if (!document.getElementById('welcomeUser')) return;

  const user = getUser();
  if (!user) { window.location.href = 'Register.html'; return; }

  initHome(user);

  // FIX (Bug #1, #2): If the user IS in a household, home.html shouldn't
  // be their destination — send them straight to the dashboard. This also
  // defensively re-syncs localStorage from the server. We do this AFTER
  // painting the page so the flash toast from a previous page still gets
  // a chance to show, unless we bounce away immediately (in which case
  // the toast will re-appear on the dashboard if it was stored as a flash).
  try {
    const hh = await resolveMembership();
    if (hh) {
      // User already has a household — dashboard is the right landing.
      window.location.href = 'Groupdashboard.html';
      return;
    }
  } catch (err) {
    // Server unreachable — stay on home. The Create/Join cards still work
    // as navigation targets; the relevant API failure will surface later.
    console.warn('home.html membership check failed:', err.message);
  }
});

function initHome(user) {
  const firstName = user.name ? user.name.split(' ')[0] : 'there';
  const parts     = user.name ? user.name.trim().split(' ') : ['U'];
  const initials  = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : user.name.substring(0, 2);

  const welcome = document.getElementById('welcomeUser');
  const avatar  = document.getElementById('userAvatarDisplay');
  if (welcome) welcome.textContent = `Welcome back, ${firstName}!`;
  if (avatar)  avatar.textContent  = initials.toUpperCase();

  // FIX (Bug #1, #2): Before entering Create or Join flows, wipe any
  // residual household cache. Otherwise if a user just left a household
  // and now clicks Create Group, the create flow might briefly reuse the
  // stale id and render the OLD household.
  const createCard = document.querySelector('.card.primary');
  if (createCard) {
    createCard.onclick = () => {
      clearHouseholdCache();
      window.location.href = 'createGroup.html';
    };
  }

  const joinCard = document.querySelector('.card.success');
  if (joinCard) {
    joinCard.onclick = () => {
      clearHouseholdCache();
      window.location.href = 'joinGroup.html';
    };
  }

  const menu     = document.querySelector('.user-menu');
  const dropdown = document.querySelector('.dropdown');
  if (menu && dropdown) {
    menu.addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('active'); });
    window.addEventListener('click', () => dropdown.classList.remove('active'));
  }
}

function logout() { clearSession(); }

const style = document.createElement('style');
style.innerHTML = `.spin{animation:rota-spin 1s linear infinite}@keyframes rota-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}.dropdown.active{opacity:1!important;visibility:visible!important;transform:translateY(0)!important}`;
document.head.appendChild(style);
