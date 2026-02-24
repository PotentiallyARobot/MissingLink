/* ===== MOBILE MENU ===== */
function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  const hamburger = document.querySelector('.hamburger');
  const nav = document.querySelector('nav');

  menu.classList.toggle('active');
  hamburger.classList.toggle('active');

  if (nav) nav.classList.toggle('menu-open');

  // Prevent body scroll when menu is open
  document.body.style.overflow = menu.classList.contains('active') ? 'hidden' : '';
}

function toggleMobileDropdown(btn) {
  btn.classList.toggle('open');
  const items = btn.nextElementSibling;
  if (items) items.classList.toggle('open');
}

/* ===== COPY INSTALL COMMAND ===== */
function copyInstall() {
  const codeEl = document.querySelector('.install-code');
  if (!codeEl) return;

  const text = codeEl.innerText
    .replace(/^#.*$/gm, '')
    .replace(/Copy/g, '')
    .trim();

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.copy-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }
  });
}

/* ===== RESEND TOKEN MODAL ===== */
function openResend() {
  const modal = document.getElementById('resendModal');
  if (modal) modal.classList.add('active');
}

function closeResend() {
  const modal = document.getElementById('resendModal');
  if (modal) modal.classList.remove('active');
  const msg = document.getElementById('resendMsg');
  if (msg) { msg.textContent = ''; msg.className = 'modal-msg'; }
}

async function submitResend() {
  const emailInput = document.getElementById('resendEmail');
  const msg = document.getElementById('resendMsg');
  if (!emailInput || !msg) return;

  const email = emailInput.value.trim();
  if (!email) {
    msg.textContent = 'Please enter your email.';
    msg.className = 'modal-msg error';
    return;
  }

  msg.textContent = 'Sending…';
  msg.className = 'modal-msg';

  try {
    const resp = await fetch('https://missinglink.build/resend-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();
    msg.textContent = data.message || 'If an active subscription exists, an email will be sent.';
    msg.className = 'modal-msg success';
  } catch (e) {
    msg.textContent = 'Something went wrong. Please try again.';
    msg.className = 'modal-msg error';
  }
}

/* ===== MANAGE SUBSCRIPTION MODAL ===== */
function openPortal() {
  const modal = document.getElementById('portalModal');
  if (modal) modal.classList.add('active');
}

function closePortal() {
  const modal = document.getElementById('portalModal');
  if (modal) modal.classList.remove('active');
  const msg = document.getElementById('portalMsg');
  if (msg) { msg.textContent = ''; msg.className = 'modal-msg'; }
}

async function submitPortal() {
  const emailInput = document.getElementById('portalEmail');
  const msg = document.getElementById('portalMsg');
  const btn = document.getElementById('portalBtn');
  if (!emailInput || !msg) return;

  const email = emailInput.value.trim();
  if (!email) {
    msg.textContent = 'Please enter your email.';
    msg.className = 'modal-msg error';
    return;
  }

  msg.textContent = 'Loading…';
  msg.className = 'modal-msg';
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch('https://missinglink.build/create-portal-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      msg.textContent = data.message || 'Could not find a subscription for that email.';
      msg.className = 'modal-msg error';
    }
  } catch (e) {
    msg.textContent = 'Something went wrong. Please try again.';
    msg.className = 'modal-msg error';
  } finally {
    if (btn) btn.disabled = false;
  }
}


/* ===== SUBSCRIBE MODAL (trial-gated) ===== */
function openSubscribe() {
  const modal = document.getElementById('subscribeModal');
  if (modal) modal.classList.add('active');
}

function closeSubscribe() {
  const modal = document.getElementById('subscribeModal');
  if (modal) modal.classList.remove('active');
  const msg = document.getElementById('subscribeMsg');
  if (msg) { msg.textContent = ''; msg.className = 'modal-msg'; }
}

async function submitSubscribe() {
  const emailInput = document.getElementById('subscribeEmail');
  const msg = document.getElementById('subscribeMsg');
  const btn = document.getElementById('subscribeBtn');
  if (!emailInput || !msg) return;

  const email = emailInput.value.trim();
  if (!email) {
    msg.textContent = 'Please enter your email.';
    msg.className = 'modal-msg error';
    return;
  }

  msg.textContent = 'Checking…';
  msg.className = 'modal-msg';
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch('https://missinglink.build/check-trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await resp.json();

    if (data.eligible) {
      msg.textContent = 'Starting your 7-day free trial…';
      msg.className = 'modal-msg success';
    } else {
      msg.textContent = 'Redirecting to subscribe (trial already used)…';
      msg.className = 'modal-msg';
    }

    setTimeout(() => {
      window.location.href = 'https://missinglink.build/create-checkout-session?email=' + encodeURIComponent(email);
    }, 600);
  } catch (e) {
    window.location.href = 'https://missinglink.build/create-checkout-session?email=' + encodeURIComponent(email);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ===== CLOSE MODALS ON OVERLAY CLICK ===== */
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

/* ===== CLOSE MODALS ON ESC ===== */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
  }
});

/* ===== FAQ TOGGLE (if present) ===== */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.faq-item').classList.toggle('open');
    });
  });
});
