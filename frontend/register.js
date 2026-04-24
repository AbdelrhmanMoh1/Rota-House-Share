lucide.createIcons();

function switchAuth(type) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');
  document.querySelectorAll('.form-container').forEach(f => f.classList.remove('active'));
  const target = document.getElementById(type === 'login' ? 'loginForm' : 'signupForm');
  if (target) target.classList.add('active');
}

function togglePassword(btn) {
  const input = btn.previousElementSibling;
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.setAttribute('data-lucide', input.type === 'password' ? 'eye' : 'eye-off');
  lucide.createIcons();
}

async function handleAuth(e, type) {
  e.preventDefault();
  const btn = e.target.querySelector('.submit-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Processing...';
  lucide.createIcons();

  try {
    const emailEl    = e.target.querySelector('input[type="email"]');
    const passwordEl = e.target.querySelector('.password-field');
    if (!emailEl || !passwordEl) throw new Error('Form fields not found');

    let data;
    if (type === 'signup') {
      const nameEl = e.target.querySelector('input[placeholder="Full Name"]');
      if (!nameEl) throw new Error('Name field not found');
      data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: nameEl.value, email: emailEl.value, password: passwordEl.value })
      });
    } else {
      data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: emailEl.value, password: passwordEl.value })
      });
    }

    saveSession(data.token, data.user);
    window.location.href = 'loadingscreen.html';

  } catch (err) {
    toast(err.message || 'Something went wrong. Please try again.', 'error');
    btn.disabled = false;
    btn.innerHTML = type === 'login'
      ? 'Sign In <i data-lucide="arrow-right"></i>'
      : 'Create Account <i data-lucide="sparkles"></i>';
    lucide.createIcons();
  }
}

const style = document.createElement('style');
style.innerHTML = `.spin{animation:rota-spin 1s linear infinite}@keyframes rota-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
document.head.appendChild(style);
