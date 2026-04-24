// =============================================================================
// Group Dashboard — chores, members (with kick), shopping, purchases
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  if (localStorage.getItem('rota_theme') === 'dark') document.body.classList.add('dark-mode');

  const hh = await requireMembership();
  if (!hh) return;

  const householdId = hh.id;
  const user = getUser();
  if (!user) { clearSession(); return; }

  let tasks     = [];
  let members   = [];
  let purchases = [];
  let myRole    = 'member';
  let currentChoreTab = 'pending';

  // =========================================================================
  // HOUSEHOLD + MEMBERS
  // =========================================================================
  try {
    const household = await apiFetch('/households/' + householdId);
    document.getElementById('groupNameDisplay').textContent = household.name;
    document.getElementById('groupDescDisplay').textContent = household.address || 'Welcome back!';
    document.getElementById('groupIdDisplay').textContent   = household.invite_code ? '#' + household.invite_code : '';
    members = household.members || [];
    const me = members.find(m => String(m.id) === String(user.id));
    myRole = me ? me.role : 'member';
    renderMembers();
  } catch (err) {
    console.error('Household load failed:', err.message);
    toast('Could not load household', 'error');
  }

  function renderMembers() {
    const list = document.getElementById('memberList');
    if (!list) return;
    if (members.length === 0) {
      list.innerHTML = '<p style="color:#94a3b8;font-size:0.85rem;">No members.</p>';
      return;
    }
    list.innerHTML = members.map(m => {
      const parts    = (m.name || '').trim().split(/\s+/);
      const initials = (parts.length >= 2
        ? parts[0][0] + parts[parts.length - 1][0]
        : (m.name || '??').substring(0, 2)).toUpperCase();

      const roleBadge = m.role === 'admin'
        ? '<span class="role-chip admin">ADMIN</span>'
        : '';

      // FIX (Bug #2): Kick button rendered only for admins viewing OTHER members.
      // Admins cannot kick themselves — the self-row has no button.
      const isSelf   = String(m.id) === String(user.id);
      const canKick  = myRole === 'admin' && !isSelf;
      const kickBtn  = canKick
        ? `<button class="kick-btn" title="Remove ${m.name}" onclick="openKickModal('${m.id}','${escapeAttr(m.name)}')"><i data-lucide="user-x"></i></button>`
        : '';

      return `<div class="member" style="display:flex;align-items:center;gap:10px;padding:8px 0;">
        <div class="m-avatar">${initials}</div>
        <span style="flex:1;">${m.name}${isSelf ? ' (you)' : ''}</span>
        ${roleBadge}
        ${kickBtn}
      </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // =========================================================================
  // CHORES (Bug #1)
  // =========================================================================
  try {
    tasks = await apiFetch('/households/' + householdId + '/tasks');
    renderChores();
  } catch (err) {
    console.error('Tasks load failed:', err.message);
    tasks = JSON.parse(localStorage.getItem('rota_tasks_' + householdId)) || [];
    renderChores();
  }

  function renderChores() {
    const list = document.getElementById('choreList');
    if (!list) return;
    const filtered = tasks.filter(t =>
      currentChoreTab === 'pending' ? t.status !== 'completed' : t.status === 'completed'
    );
    if (filtered.length === 0) {
      list.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">No tasks here yet.</p>';
      return;
    }
    list.innerHTML = filtered.map(t => `
      <div class="chore-item ${t.status === 'completed' ? 'done' : ''}" data-id="${t.id}">
        <div class="chore-check ${t.status === 'completed' ? 'checked' : ''}" onclick="toggleChore('${t.id}')">
          ${t.status === 'completed' ? '<i data-lucide="check" style="width:14px"></i>' : ''}
        </div>
        <div class="chore-info">
          <span class="chore-title">${escapeHtml(t.title)}</span>
          <span class="chore-meta">Assigned to ${escapeHtml(t.assigned_to_name || 'Unassigned')}</span>
        </div>
      </div>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  window.switchChoreTab = (tab) => {
    currentChoreTab = tab === 'todo' ? 'pending' : 'completed';
    document.querySelectorAll('.c-tab').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderChores();
  };

  // FIX (Bug #1): No more optimistic flip.
  // Previously we flipped UI state, called the API, then re-fetched.
  // If the API call silently failed (dead UUID, expired token, local_
  // prefix task) the refetch reverted the UI, which looked to users
  // like "nothing happened". Now:
  //   1. Disable the checkbox so the user can't double-click.
  //   2. Call the new /toggle endpoint which flips in either direction.
  //   3. Show a toast with the result (success OR error — no silence).
  //   4. Re-fetch fresh state so rotation advances are reflected.
  // If the task was created offline (local_ prefix), skip the network
  // call and just flip the local task — the server doesn't know it yet.
  window.toggleChore = async (id) => {
    const idx = tasks.findIndex(t => String(t.id) === String(id));
    if (idx === -1) return;
    const task = tasks[idx];

    // Offline/local task — handle purely in localStorage
    if (String(id).startsWith('local_')) {
      task.status = task.status === 'completed' ? 'pending' : 'completed';
      localStorage.setItem('rota_tasks_' + householdId, JSON.stringify(tasks));
      renderChores();
      return;
    }

    try {
      const { status } = await apiFetch(`/tasks/${id}/toggle`, { method: 'PATCH' });
      toast(status === 'completed' ? 'Marked done' : 'Marked pending', 'success', 1500);
      // Refetch to pick up rotation advance / next assignment
      tasks = await apiFetch('/households/' + householdId + '/tasks');
      localStorage.setItem('rota_tasks_' + householdId, JSON.stringify(tasks));
      renderChores();
    } catch (err) {
      toast(err.message || 'Could not update task', 'error');
    }
  };

  // =========================================================================
  // ADD CHORE MODAL
  // =========================================================================
  window.openModal = () => {
    const select = document.getElementById('choreAssignee');
    if (select) {
      select.innerHTML = '<option value="">Assign to...</option>' +
        members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    }
    document.getElementById('choreModal').style.display = 'flex';
  };
  window.closeModal = () => { document.getElementById('choreModal').style.display = 'none'; };

  window.confirmAddChore = async () => {
    const titleEl    = document.getElementById('newChoreTitle');
    const assigneeEl = document.getElementById('choreAssignee');
    const title    = titleEl.value.trim();
    const assignee = assigneeEl.value;
    if (!title) { toast('Enter a task title', 'error'); return; }

    try {
      await apiFetch('/households/' + householdId + '/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, assigned_to: assignee || null })
      });
      titleEl.value = '';
      closeModal();
      tasks = await apiFetch('/households/' + householdId + '/tasks');
      localStorage.setItem('rota_tasks_' + householdId, JSON.stringify(tasks));
      renderChores();
      toast('Task added', 'success');
    } catch (err) {
      toast(err.message || 'Could not add task', 'error');
    }
  };

  // =========================================================================
  // LEAVE HOUSEHOLD
  // =========================================================================
  window.handleLeaveGroup = async () => {
    if (!confirm('Are you sure you want to leave this house group?')) return;
    try {
      await apiFetch(`/households/${householdId}/members/me`, { method: 'DELETE' });
    } catch (err) {
      toast('Could not leave: ' + (err.message || 'unknown error'), 'error');
      return;
    }
    clearHouseholdCache();
    sessionStorage.setItem('rota_flash', JSON.stringify({
      type: 'success', msg: 'You have left the household.'
    }));
    window.location.href = 'home.html';
  };

  // =========================================================================
  // KICK MEMBER (Bug #2)
  // =========================================================================
  let kickTargetId   = null;
  let kickTargetName = '';

  window.openKickModal = (userId, userName) => {
    if (myRole !== 'admin') return;
    kickTargetId   = userId;
    kickTargetName = userName;
    document.getElementById('kickModalTarget').textContent =
      `You are about to remove ${userName} from the household. Please provide a reason.`;
    document.getElementById('kickReason').value = '';
    document.getElementById('kickModal').style.display = 'flex';
    setTimeout(() => document.getElementById('kickReason').focus(), 50);
  };
  window.closeKickModal = () => {
    document.getElementById('kickModal').style.display = 'none';
    kickTargetId = null;
  };
  window.confirmKick = async () => {
    const reason = document.getElementById('kickReason').value.trim();
    if (!reason) { toast('Please enter a reason', 'error'); return; }
    if (!kickTargetId) return;
    try {
      const resp = await apiFetch(`/households/${householdId}/members/${kickTargetId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
      });
      closeKickModal();
      toast(resp.message || 'Member removed', 'success');
      // Refresh member list
      const household = await apiFetch('/households/' + householdId);
      members = household.members || [];
      renderMembers();
    } catch (err) {
      toast(err.message || 'Could not remove member', 'error');
    }
  };

  // =========================================================================
  // PURCHASES (Bug #4)
  // =========================================================================
  async function loadPurchases() {
    try {
      const { purchases: list } = await apiFetch('/households/' + householdId + '/purchases');
      purchases = list || [];
      renderPurchases();
    } catch (err) {
      console.warn('Purchases load failed:', err.message);
    }
  }

  function renderPurchases() {
    const wrap = document.getElementById('purchaseList');
    if (!wrap) return;
    if (purchases.length === 0) {
      wrap.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;font-size:0.9rem;">No shared purchases yet. Start one to split costs with your housemates.</p>';
      return;
    }
    wrap.innerHTML = purchases.map(p => {
      const pct = Math.min(100, (parseFloat(p.current_amount) / parseFloat(p.target_amount)) * 100);
      const statusChip = {
        open: '<span class="status-chip open">Open</span>',
        funded: '<span class="status-chip funded">Funded</span>',
        cancelled: '<span class="status-chip cancelled">Cancelled</span>'
      }[p.status] || '';
      const creatorIsMe = String(p.created_by) === String(user.id);
      const canCancel = p.status === 'open' && (creatorIsMe || myRole === 'admin');
      const canContribute = p.status === 'open';
      return `
        <div class="purchase-item">
          <div class="purchase-head">
            <div>
              <span class="purchase-name">${escapeHtml(p.item_name)}</span>
              ${statusChip}
            </div>
            <span class="purchase-meta">by ${escapeHtml(p.creator_name || 'Unknown')}</span>
          </div>
          ${p.description ? `<p class="purchase-desc">${escapeHtml(p.description)}</p>` : ''}
          <div class="purchase-progress">
            <div class="purchase-progress-bar" style="width:${pct.toFixed(1)}%;"></div>
          </div>
          <div class="purchase-numbers">
            £${parseFloat(p.current_amount).toFixed(2)}
            <span style="color:#94a3b8;"> / £${parseFloat(p.target_amount).toFixed(2)}</span>
            <span style="margin-left:8px;color:#94a3b8;">(${pct.toFixed(0)}%)</span>
          </div>
          <div class="purchase-actions">
            ${canContribute ? `<button class="btn-ghost-primary" onclick="openContributeModal('${p.id}','${escapeAttr(p.item_name)}',${(parseFloat(p.target_amount)-parseFloat(p.current_amount)).toFixed(2)})">Contribute</button>` : ''}
            ${canCancel ? `<button class="btn-ghost-danger" onclick="cancelPurchase('${p.id}')">Cancel</button>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  window.openPurchaseModal = () => {
    document.getElementById('purchaseItemName').value = '';
    document.getElementById('purchaseDesc').value     = '';
    document.getElementById('purchaseTarget').value   = '';
    document.getElementById('purchaseModal').style.display = 'flex';
  };
  window.closePurchaseModal = () => { document.getElementById('purchaseModal').style.display = 'none'; };

  window.confirmCreatePurchase = async () => {
    const item_name     = document.getElementById('purchaseItemName').value.trim();
    const description   = document.getElementById('purchaseDesc').value.trim();
    const target_amount = parseFloat(document.getElementById('purchaseTarget').value);
    if (!item_name) { toast('Item name required', 'error'); return; }
    if (!Number.isFinite(target_amount) || target_amount <= 0) {
      toast('Target amount must be positive', 'error'); return;
    }
    try {
      await apiFetch('/households/' + householdId + '/purchases', {
        method: 'POST',
        body: JSON.stringify({ item_name, description, target_amount })
      });
      closePurchaseModal();
      toast('Purchase created', 'success');
      await loadPurchases();
    } catch (err) {
      toast(err.message || 'Could not create purchase', 'error');
    }
  };

  let contribTarget = null;
  window.openContributeModal = (purchaseId, itemName, remaining) => {
    contribTarget = purchaseId;
    document.getElementById('contributeTitle').textContent = `Contribute to ${itemName}`;
    document.getElementById('contributeInfo').textContent  = `£${remaining} remaining.`;
    document.getElementById('contributeAmount').value = '';
    document.getElementById('contributeAmount').max   = remaining;
    document.getElementById('contributeModal').style.display = 'flex';
    setTimeout(() => document.getElementById('contributeAmount').focus(), 50);
  };
  window.closeContributeModal = () => {
    document.getElementById('contributeModal').style.display = 'none';
    contribTarget = null;
  };
  window.confirmContribute = async () => {
    if (!contribTarget) return;
    const amount = parseFloat(document.getElementById('contributeAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) { toast('Enter a positive amount', 'error'); return; }
    try {
      const resp = await apiFetch(
        `/households/${householdId}/purchases/${contribTarget}/contribute`,
        { method: 'POST', body: JSON.stringify({ amount }) }
      );
      closeContributeModal();
      toast(resp.purchase.status === 'funded' ? 'Target reached — fully funded!' : 'Contribution saved', 'success');
      await loadPurchases();
    } catch (err) {
      toast(err.message || 'Could not contribute', 'error');
    }
  };
  window.cancelPurchase = async (purchaseId) => {
    if (!confirm('Cancel this purchase? Contributions are not automatically refunded.')) return;
    try {
      await apiFetch(`/households/${householdId}/purchases/${purchaseId}/cancel`, { method: 'POST' });
      toast('Purchase cancelled', 'success');
      await loadPurchases();
    } catch (err) {
      toast(err.message || 'Could not cancel', 'error');
    }
  };
  loadPurchases();

  // =========================================================================
  // SHOPPING LIST (local only, unchanged)
  // =========================================================================
  let shopping       = JSON.parse(localStorage.getItem('rota_shopping')) || [];
  let currentShopTab = 'tobuy';

  const renderShopping = () => {
    const list = document.getElementById('shoppingList');
    if (!list) return;
    const filtered = shopping.filter(i => i.status === currentShopTab);
    list.innerHTML = filtered.map(item => `
      <div class="shop-item ${item.status === 'purchased' ? 'purchased' : ''}">
        <div class="shop-item-left">
          <div class="shop-check ${item.status === 'purchased' ? 'checked' : ''}" onclick="toggleShopItem(${item.id})">
            ${item.status === 'purchased' ? '<i data-lucide="check" style="width:14px"></i>' : ''}
          </div>
          <label>${escapeHtml(item.name)}</label>
        </div>
        <button class="delete-btn" onclick="deleteShopItem(${item.id})">
          <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
        </button>
      </div>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    localStorage.setItem('rota_shopping', JSON.stringify(shopping));
  };
  window.switchShopTab = (tab) => {
    currentShopTab = tab;
    document.querySelectorAll('.s-tab').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderShopping();
  };
  window.toggleShopItem = (id) => {
    const item = shopping.find(i => i.id === id);
    if (item) { item.status = item.status === 'tobuy' ? 'purchased' : 'tobuy'; renderShopping(); }
  };
  window.deleteShopItem = (id) => {
    shopping = shopping.filter(i => i.id !== id);
    renderShopping();
  };
  window.addShoppingItem = () => {
    const input = document.getElementById('shopInput');
    if (!input || !input.value.trim()) return;
    shopping.push({ id: Date.now(), name: input.value.trim(), status: 'tobuy' });
    input.value = '';
    renderShopping();
  };
  renderShopping();
});

// --- helpers ---
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return String(s || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
