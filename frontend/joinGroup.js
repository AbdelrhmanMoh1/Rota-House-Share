document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  // BUG 5 FIX: Apply saved dark mode
  if (localStorage.getItem('rota_theme') === 'dark') document.body.classList.add('dark-mode');

  const digits     = document.querySelectorAll('.code-digit');
  const joinBtn    = document.getElementById('joinBtn');
  const resultCard = document.getElementById('resultCard');
  const emptyState = document.getElementById('emptyState');

  if (!joinBtn) return;

  digits.forEach((slot, index) => {
    slot.addEventListener('keyup', (e) => {
      if (slot.value && index < digits.length - 1) digits[index + 1].focus();
      if (e.key === 'Backspace' && index > 0) digits[index - 1].focus();
      const code = Array.from(digits).map(d => d.value).join('');
      joinBtn.disabled = code.length !== 6;
    });
  });

  const form = document.getElementById('joinForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inviteCode = Array.from(digits).map(d => d.value).join('').toUpperCase();
    joinBtn.disabled = true;
    joinBtn.textContent = 'Searching...';

    try {
      const data = await apiFetch('/households/join', {
        method: 'POST',
        body: JSON.stringify({ invite_code: inviteCode })
      });

      localStorage.setItem('rota_household_id', data.household.id);
      localStorage.setItem('rota_current_group', data.household.name);

      const nameEl = document.getElementById('houseNameResult');
      const descEl = document.getElementById('houseDescResult');
      if (nameEl) nameEl.textContent = data.household.name;
      if (descEl) descEl.textContent = data.household.address || 'Welcome to your new home!';

      if (emptyState) emptyState.classList.add('hidden');
      if (resultCard) {
        resultCard.classList.remove('hidden');
        resultCard.style.animation = 'popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      }

      // FIX (Bug #5): Cross-page welcome flash so the user sees their
      // confirmation once the dashboard loads, not just on this page.
      sessionStorage.setItem('rota_flash', JSON.stringify({
        type: 'success',
        msg: `Welcome to ${data.household.name}!`
      }));
      setTimeout(() => window.location.href = 'Groupdashboard.html', 1500);

    } catch (err) {
      toast(err.message || 'Invalid invite code. Please try again.', 'error');
      joinBtn.disabled = false;
      joinBtn.innerHTML = 'Find House <i data-lucide="search"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  });
});
