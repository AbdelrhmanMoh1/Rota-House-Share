document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  // BUG 5 FIX: Apply saved dark mode
  if (localStorage.getItem('rota_theme') === 'dark') document.body.classList.add('dark-mode');

  const groupForm      = document.getElementById('groupForm');
  const nameInput      = document.getElementById('houseNameInput');
  const previewName    = document.getElementById('previewName');
  const descInput      = document.getElementById('descInput');
  const previewDesc    = document.getElementById('previewDesc');
  const charCounter    = document.getElementById('currentChars');
  const emailInput     = document.getElementById('emailInput');
  const addBtn         = document.getElementById('addBtn');
  const tagContainer   = document.getElementById('tagContainer');
  const previewMembers = document.getElementById('previewMembers');

  if (!groupForm) return;

  let invitedEmails = [];

  if (nameInput) nameInput.addEventListener('input', e => {
    if (previewName) previewName.textContent = e.target.value || 'Your House Name';
  });

  if (descInput) descInput.addEventListener('input', e => {
    const val = e.target.value;
    if (previewDesc)  previewDesc.textContent  = val || 'No description provided yet.';
    if (charCounter)  charCounter.textContent   = val.length;
    if (charCounter)  charCounter.style.color   = val.length >= 110 ? '#ef4444' : '#64748b';
  });

  const addEmail = () => {
    if (!emailInput) return;
    const email = emailInput.value.trim();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (email && valid && !invitedEmails.includes(email)) {
      invitedEmails.push(email);
      updateUI();
      emailInput.value = '';
    } else if (email && !valid) {
      toast('Please enter a valid email address', 'error');
    }
  };

  const updateUI = () => {
    if (tagContainer) {
      tagContainer.innerHTML = invitedEmails.map((m, i) => `
        <span class="tag">${m}
          <i data-lucide="x" style="cursor:pointer;width:14px;margin-left:5px;" onclick="removeEmail(${i})"></i>
        </span>`).join('');
    }
    if (previewMembers) {
      previewMembers.innerHTML = invitedEmails.length === 0
        ? '<div class="empty-state">No roommates added yet</div>'
        : invitedEmails.map(m => `
            <div class="member-item">
              <div class="avatar-sm" style="background:#818cf8;color:white;">${m.charAt(0).toUpperCase()}</div>
              <span style="font-size:0.9rem;margin-left:10px;">${m}</span>
            </div>`).join('');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  window.removeEmail = (index) => { invitedEmails.splice(index, 1); updateUI(); };

  groupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const houseName = nameInput ? nameInput.value.trim() : '';
    const houseDesc = descInput ? descInput.value.trim() : '';
    if (!houseName) { toast('Please provide a name for your house', 'error'); return; }

    const submitBtn = groupForm.querySelector('.submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Creating...';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    try {
      const data = await apiFetch('/households', {
        method: 'POST',
        body: JSON.stringify({ name: houseName, address: houseDesc || '' })
      });

      localStorage.setItem('rota_household_id', data.id);
      localStorage.setItem('rota_current_group', data.name);

      // FIX (Bug #5): Cross-page success flash shown on the dashboard
      // once it loads, instead of a blocking alert(). Invite code still
      // surfaced so admins can share it with housemates.
      sessionStorage.setItem('rota_flash', JSON.stringify({
        type: 'success',
        msg: `House created! Invite code: ${data.invite_code}`
      }));
      window.location.href = 'Groupdashboard.html';

    } catch (err) {
      toast('Could not create house: ' + err.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Confirm & Launch Group <i data-lucide="sparkles"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
  });

  if (addBtn)    addBtn.addEventListener('click', addEmail);
  if (emailInput) emailInput.addEventListener('keypress', e => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } });
});

const style = document.createElement('style');
style.innerHTML = `.spin{animation:rota-spin 1s linear infinite}@keyframes rota-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
document.head.appendChild(style);
