// -----------------------------------------------------------------------------
// Loading screen — runs between login and the first authenticated page.
// Decides where to send the user based on membership.
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (localStorage.getItem('rota_theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    const fill = document.getElementById('progressBar');
    const pct  = document.getElementById('percentText');
    let progress = 0;
    const timer = setInterval(() => {
        progress = Math.min(100, progress + 10);
        if (fill) fill.style.width = progress + '%';
        if (pct)  pct.textContent  = progress + '%';
        if (progress >= 100) {
            clearInterval(timer);
            setTimeout(onLoadComplete, 300);
        }
    }, 120);
});

async function onLoadComplete() {
    const token = getToken();
    if (!token) { window.location.href = 'Register.html'; return; }

    // FIX (Bug #1, #2): Use the shared resolveMembership helper, which:
    //   - Hits /households/mine with no-store
    //   - Updates localStorage ONLY from the server response (so a stale
    //     id cannot re-admit a user who has left)
    //   - Calls clearHouseholdCache() on empty results
    //
    // Routing rules:
    //   - Has membership  → Groupdashboard.html
    //   - No membership   → home.html  (the Create/Join landing page)
    //   - Server error    → home.html  (never logout — that would discard
    //     the token on a transient network blip)
    try {
        const hh = await resolveMembership();
        window.location.href = hh ? 'Groupdashboard.html' : 'home.html';
    } catch (err) {
        console.error('Membership check failed:', err.message);
        // FIX (Bug #2): Previously this branch sent the user to Register.html,
        // which effectively logged them out on any /households/mine hiccup.
        // Home page is safer — it works without a household and without a
        // live server connection.
        window.location.href = 'home.html';
    }
}
