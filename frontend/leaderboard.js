// -----------------------------------------------------------------------------
// Leaderboard page
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Apply dark mode before first paint
    if (localStorage.getItem('rota_theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    // FIX (Bug #2): Require membership. If the user left their household,
    // clicking "Leaderboard" in any navbar (or landing here directly) will
    // now bounce them to home.html with a toast instead of re-admitting
    // them via the old stale-id flow. No guard here was the original sin.
    const hh = await requireMembership();
    if (!hh) return;

    // FIX (Bug #2): The previous code intercepted the Account link to set
    // localStorage.rota_profile_redirect = 'loadingscreen', then profile.js
    // would auto-redirect to the loading screen, which called /households/mine,
    // which (because leave didn't really leave) re-admitted the user to the
    // household. That whole interceptor is DELETED. The Account link is just
    // a plain href — profile.html handles its own auth. This single change
    // breaks the exact navigation loop described in the bug report.

    const fetchRankings = async (filter = 'weekly') => {
        try {
            const list = await apiFetch(`/households/leaderboard?filter=${filter}`);
            updateUI(list);
        } catch (err) {
            console.error('Leaderboard error:', err);
            const rankingList = document.getElementById('rankingList');
            if (rankingList) {
                rankingList.innerHTML = `<p style="color:#94a3b8;text-align:center;padding:20px;">Connect to server to see rankings.</p>`;
            }
        }
    };

    const updateUI = (list) => {
        if (!Array.isArray(list)) return;

        // Podium (Top 3)
        for (let i = 1; i <= 3; i++) {
            const house = list[i - 1] || { name: 'Empty', completed_chores: 0 };
            const nameEl  = document.getElementById(`name-${i}`);
            const scoreEl = document.getElementById(`score-${i}`);
            if (nameEl)  nameEl.textContent  = house.name;
            if (scoreEl) scoreEl.textContent = `${house.completed_chores} chores`;
        }

        // Full list
        const rankingList = document.getElementById('rankingList');
        if (!rankingList) return;
        rankingList.innerHTML = list.map((item, index) => `
            <div class="rank-item">
                <span class="rank-number">#${index + 1}</span>
                <div class="rank-info">
                    <span class="rank-name">${item.name}</span>
                    <span class="rank-stats">Active Household</span>
                </div>
                <span class="rank-score">${item.completed_chores}</span>
            </div>
        `).join('');
    };

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const activeTab = document.querySelector('.tab.active');
            if (activeTab) activeTab.classList.remove('active');
            e.target.classList.add('active');
            fetchRankings(e.target.dataset.filter);
        });
    });

    fetchRankings();
});
