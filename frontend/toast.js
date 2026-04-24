// -----------------------------------------------------------------------------
// Reusable toast notification system
//
// USAGE (same page):
//   toast('Profile saved', 'success');
//   toast('Could not connect', 'error');
//   toast('You left the household');          // defaults to 'info'
//
// USAGE (cross-page flash — set before navigating, auto-shown on arrival):
//   sessionStorage.setItem('rota_flash', JSON.stringify({ type:'success', msg:'Saved' }));
//   window.location.href = 'home.html';
//
// Types: 'info' (default) | 'success' | 'error' | 'warning'
// -----------------------------------------------------------------------------

(function () {
  function getStack() {
    let s = document.querySelector('.toast-stack');
    if (!s) {
      s = document.createElement('div');
      s.className = 'toast-stack';
      s.setAttribute('role', 'status');
      s.setAttribute('aria-live', 'polite');
      document.body.appendChild(s);
    }
    return s;
  }

  window.toast = function (msg, type = 'info', ms = 3500) {
    if (!msg) return;
    const allowed = ['info', 'success', 'error', 'warning'];
    if (!allowed.includes(type)) type = 'info';

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    getStack().appendChild(el);

    setTimeout(() => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, ms);
  };

  // Drain any flash message left by the previous page.
  // Runs on every page that includes this script, so navigation messages
  // ("You have left the household", "You're not in a household yet", etc.)
  // appear exactly where they should.
  document.addEventListener('DOMContentLoaded', () => {
    const raw = sessionStorage.getItem('rota_flash');
    if (!raw) return;
    sessionStorage.removeItem('rota_flash');
    try {
      const { msg, type } = JSON.parse(raw);
      window.toast(msg, type);
    } catch (_) { /* malformed flash; ignore */ }
  });
})();
