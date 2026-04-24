// -----------------------------------------------------------------------------
// Profile page — account info, edit modal, avatar upload (via multer),
// relative "member since", dark mode toggle
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (localStorage.getItem('rota_theme') === 'dark') document.body.classList.add('dark-mode');

    if (!(await requireAuth())) return;

    const cachedUser = getUser();
    if (cachedUser) await populateProfileUI(cachedUser);

    let freshUser = cachedUser;
    try {
        const resp = await apiFetch('/auth/me');
        freshUser = resp.user || resp;
        saveSession(getToken(), freshUser);
        await populateProfileUI(freshUser);
    } catch (err) {
        console.warn('Profile /auth/me failed (using cached data):', err.message);
        if (!cachedUser) { window.location.href = 'Register.html'; return; }
    }

    renderAchievements((freshUser && freshUser.achievements) || []);
    if (freshUser) wireEditProfile(freshUser);
    initProfileSettings();
});

// =============================================================================
// Resolve avatar path to an absolute URL the browser can fetch.
// FIX (Bug #3 cont.): multer-stored paths come back as "/uploads/avatars/..."
// which is relative to the BACKEND origin, not necessarily the page origin
// if you serve the frontend from a different static server.
// This helper prepends the API origin when needed.
// =============================================================================
function resolveAvatarUrl(avatar) {
    if (!avatar) return null;
    if (/^data:image\//.test(avatar)) return avatar;        // legacy data URL
    if (/^https?:\/\//.test(avatar))  return avatar;        // remote URL
    if (avatar.startsWith('/uploads/')) {
        // API_URL is "http://localhost:3000/api" — strip "/api"
        const apiOrigin = (typeof API_URL === 'string')
            ? API_URL.replace(/\/api\/?$/, '')
            : window.location.origin;
        return apiOrigin + avatar;
    }
    return avatar; // emoji / short text
}

async function populateProfileUI(user) {
    const nameEl   = document.querySelector('.name-meta h1');
    const emailEl  = document.querySelector('.name-meta p');
    const avatarEl = document.getElementById('profileAvatar');

    if (nameEl)  nameEl.textContent = user.name || 'Unnamed';
    if (emailEl) emailEl.textContent = `${user.email} • Member since ${relativeSince(user.created_at)}`;
    if (avatarEl) renderAvatar(avatarEl, user.avatar_url, user.name);

    try {
        const household = await resolveMembership();
        const groupCard = document.querySelector('.group-card');
        if (!household) {
            if (groupCard) {
                groupCard.innerHTML =
                    '<h3>Current House</h3>' +
                    '<div class="house-box empty">' +
                      '<div style="text-align:center;width:100%;">' +
                        '<p style="color:var(--text-sub);margin-bottom:12px;font-size:0.9rem;">Not in a house yet</p>' +
                        '<a href="home.html" class="edit-profile-btn" style="text-decoration:none;display:inline-block;font-size:0.8rem;">+ Create or Join</a>' +
                      '</div>' +
                    '</div>';
            }
            const stats = document.querySelectorAll('.stat-val');
            if (stats[0]) stats[0].textContent = '0';
            if (stats[1]) stats[1].textContent = '-';
            if (stats[2]) stats[2].textContent = 'New';
            return;
        }

        try {
            const full = await apiFetch('/households/' + household.id);
            const me   = (full.members || []).find(m => String(m.id) === String(user.id));
            const nameH4  = document.querySelector('.house-details h4');
            const memberP = document.querySelector('.house-details p');
            const badge   = document.querySelector('.role-badge');
            if (nameH4)  nameH4.textContent  = full.name;
            if (memberP) memberP.textContent = (full.members || []).length + ' Active Members';
            if (badge)   badge.textContent   = me && me.role === 'admin' ? 'Admin' : 'Member';
        } catch (e) {
            const nameH4 = document.querySelector('.house-details h4');
            if (nameH4) nameH4.textContent = household.name || 'Your Household';
        }
    } catch (e) { /* offline */ }
}

function computeInitials(name) {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    return (parts.length >= 2
        ? parts[0][0] + parts[parts.length - 1][0]
        : name.substring(0, 2)).toUpperCase();
}

function renderAvatar(el, avatarValue, name) {
    if (!avatarValue) {
        el.textContent = computeInitials(name);
        el.style.backgroundImage = '';
        return;
    }
    const url = resolveAvatarUrl(avatarValue);
    if (url && (/^data:image\//.test(url) || /^https?:\/\//.test(url))) {
        el.textContent = '';
        el.style.backgroundImage   = `url("${url.replace(/"/g, '\\"')}")`;
        el.style.backgroundSize    = 'cover';
        el.style.backgroundPosition = 'center';
    } else {
        el.style.backgroundImage = '';
        el.textContent = avatarValue;
    }
}

function renderAchievements(list) {
    const grid = document.getElementById('badgesGrid');
    if (!grid) return;
    if (!Array.isArray(list) || list.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i data-lucide="sparkles"></i>
                <p>No achievements yet.<br>Complete chores to earn your first badge.</p>
            </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }
    grid.innerHTML = list.map(b => {
        const safeLabel = String(b.label || '').replace(/[<>]/g, '');
        const iconName  = (b.icon || 'award').replace(/[^a-zA-Z0-9-]/g, '');
        return `
            <div class="badge-item earned" title="${String(b.description || '').replace(/"/g, '&quot;')}">
                <div class="badge-circle"><i data-lucide="${iconName}"></i></div>
                <span>${safeLabel}</span>
            </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// =============================================================================
// FIX (Bug #3): Edit Profile modal now uploads files via multipart/form-data
// to /api/upload/avatar BEFORE saving the profile. The old flow tried to
// embed a Base64 data URL in the PUT /auth/me JSON body, which hit the
// 100KB JSON limit and threw PayloadTooLargeError for anything but tiny
// images.
//
// New flow:
//   1. Emoji presets -> avatar_url = "🦊" (tiny string, JSON is fine)
//   2. File upload   -> POST multipart to /api/upload/avatar
//                       -> server returns "/uploads/avatars/xxx.jpg"
//                       -> that string goes into avatar_url on PUT /auth/me
//   3. Save button issues PUT /auth/me with {name, email, avatar_url}
// =============================================================================
function wireEditProfile(initialUser) {
    const modal       = document.getElementById('editProfileModal');
    const openBtn     = document.getElementById('editProfileBtn');
    const nameIn      = document.getElementById('ep-name');
    const emailIn     = document.getElementById('ep-email');
    const upload      = document.getElementById('ep-upload');
    const preview     = document.getElementById('ep-avatar-preview');
    const saveBtn     = document.getElementById('ep-save');
    const optionsWrap = document.getElementById('ep-avatar-options');
    if (!modal || !openBtn) return;

    let selectedAvatar = initialUser.avatar_url || null;   // the value that ends up on the user row
    let pendingFile    = null;                             // File to upload on Save

    function syncPreview() {
        if (!preview) return;
        preview.innerHTML = '';
        preview.style.backgroundImage = '';
        if (!selectedAvatar && !pendingFile) return;
        if (pendingFile) {
            const objUrl = URL.createObjectURL(pendingFile);
            preview.style.backgroundImage = `url("${objUrl}")`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
        } else {
            const url = resolveAvatarUrl(selectedAvatar);
            if (url && (/^data:image\//.test(url) || /^https?:\/\//.test(url))) {
                preview.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
            } else {
                preview.textContent = selectedAvatar;
            }
        }
    }

    function open() {
        nameIn.value   = initialUser.name  || '';
        emailIn.value  = initialUser.email || '';
        pendingFile    = null;
        if (upload) upload.value = '';
        optionsWrap.querySelectorAll('.avatar-opt').forEach(b => {
            b.classList.toggle('selected', b.dataset.val === selectedAvatar);
        });
        syncPreview();
        modal.hidden = false;
        setTimeout(() => nameIn.focus(), 50);
    }
    function close() { modal.hidden = true; }

    openBtn.addEventListener('click', open);
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
        if (!modal.hidden && e.key === 'Escape') close();
    });

    optionsWrap.querySelectorAll('.avatar-opt').forEach(b => {
        b.addEventListener('click', () => {
            optionsWrap.querySelectorAll('.avatar-opt').forEach(x => x.classList.remove('selected'));
            b.classList.add('selected');
            selectedAvatar = b.dataset.val;
            pendingFile = null;
            if (upload) upload.value = '';
            syncPreview();
        });
    });

    if (upload) {
        upload.addEventListener('change', () => {
            const f = upload.files && upload.files[0];
            if (!f) { pendingFile = null; return; }
            // Client-side sanity check — the server enforces too.
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
                toast('Only JPEG, PNG, or WebP allowed', 'error');
                upload.value = ''; return;
            }
            if (f.size > 2 * 1024 * 1024) {
                toast('Image must be under 2 MB', 'error');
                upload.value = ''; return;
            }
            pendingFile = f;
            optionsWrap.querySelectorAll('.avatar-opt').forEach(x => x.classList.remove('selected'));
            syncPreview();
        });
    }

    saveBtn.addEventListener('click', async () => {
        const name  = nameIn.value.trim();
        const email = emailIn.value.trim();
        if (!name)  { toast('Name is required', 'error'); nameIn.focus();  return; }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            toast('Please enter a valid email', 'error'); emailIn.focus(); return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
            // Step 1 — upload new avatar file if one was chosen.
            let nextAvatar = selectedAvatar;
            if (pendingFile) {
                const formData = new FormData();
                formData.append('avatar', pendingFile);
                const token = getToken();
                const uploadRes = await fetch(
                    (typeof API_URL === 'string' ? API_URL : '') + '/upload/avatar',
                    {
                        method: 'POST',
                        headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                        body: formData
                    }
                );
                const uploadData = uploadRes.status === 204 ? null : await uploadRes.json();
                if (!uploadRes.ok) {
                    throw new Error((uploadData && uploadData.error) || 'Avatar upload failed');
                }
                nextAvatar = uploadData.avatar_url;
            }

            // Step 2 — save profile (name/email/avatar pointer only, tiny JSON).
            const resp = await apiFetch('/auth/me', {
                method: 'PUT',
                body: JSON.stringify({ name, email, avatar_url: nextAvatar })
            });
            const updatedUser = resp.user || resp;
            saveSession(getToken(), updatedUser);
            initialUser    = updatedUser;
            selectedAvatar = updatedUser.avatar_url;
            pendingFile    = null;
            close();
            toast('Profile updated', 'success');
            await populateProfileUI(updatedUser);
        } catch (err) {
            toast(err.message || 'Update failed', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        }
    });
}

function initProfileSettings() {
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to logout?')) clearSession();
        });
    }
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) {
        darkToggle.checked = (localStorage.getItem('rota_theme') === 'dark');
        darkToggle.addEventListener('change', e => {
            const isDark = e.target.checked;
            document.body.classList.toggle('dark-mode', isDark);
            localStorage.setItem('rota_theme', isDark ? 'dark' : 'light');
            toast(`Dark mode ${isDark ? 'on' : 'off'}`, 'info', 1500);
        });
    }
}
