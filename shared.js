// ===== MOBILE MENU =====
function toggleMobileMenu() {
  const hamburger = document.querySelector('.hamburger');
  const menu = document.getElementById('mobileMenu');
  const nav = document.querySelector('nav');
  const isActive = menu.classList.contains('active');
  
  if (isActive) {
    menu.classList.remove('active');
    hamburger.classList.remove('active');
    nav.classList.remove('menu-open');
    document.body.style.overflow = '';
  } else {
    menu.classList.add('active');
    hamburger.classList.add('active');
    nav.classList.add('menu-open');
    document.body.style.overflow = 'hidden';
  }
}

function closeMobileMenu() {
  const hamburger = document.querySelector('.hamburger');
  const menu = document.getElementById('mobileMenu');
  const nav = document.querySelector('nav');
  if (menu) {
    menu.classList.remove('active');
    hamburger.classList.remove('active');
    nav.classList.remove('menu-open');
    document.body.style.overflow = '';
  }
}

function toggleMobileDropdown(btn) {
  btn.classList.toggle('open');
  const items = btn.nextElementSibling;
  items.classList.toggle('open');
}

// Close mobile menu on link click
document.addEventListener('click', function(e) {
  if (e.target.closest('.mobile-menu-inner a:not(.mobile-dropdown-trigger)') && 
      !e.target.closest('.mobile-dropdown-items')) {
    // Don't close for dropdown trigger
  }
  if (e.target.matches('.mobile-menu-inner a') && !e.target.matches('.mobile-dropdown-trigger')) {
    closeMobileMenu();
  }
});

// ===== COPY INSTALL COMMAND =====
function copyInstall() {
  const cmd = 'pip install --no-deps -r "https://YOUR_TOKEN@missinglink.build/a100.txt"';
  navigator.clipboard.writeText(cmd).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

// ===== FAQ TOGGLE =====
function toggleFaq(btn) {
  const item = btn.parentElement;
  const wasOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}

// ===== RESEND MODAL =====
function openResend() {
  closeMobileMenu();
  document.getElementById('resendModal').classList.add('active');
  document.getElementById('resendEmail').value = '';
  document.getElementById('resendMsg').textContent = '';
  document.getElementById('resendMsg').className = 'modal-msg';
}

function closeResend() {
  document.getElementById('resendModal').classList.remove('active');
}

async function submitResend() {
  const email = document.getElementById('resendEmail').value.trim();
  const msg = document.getElementById('resendMsg');
  if (!email || !email.includes('@')) {
    msg.textContent = 'Please enter a valid email.';
    msg.className = 'modal-msg error';
    return;
  }
  try {
    await fetch('https://missinglink.build/resend-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
  } catch (e) {}
  msg.textContent = "If an active subscription exists for that email, we've sent your token.";
  msg.className = 'modal-msg success';
}

// ===== PORTAL MODAL =====
function openPortal() {
  closeMobileMenu();
  document.getElementById('portalModal').classList.add('active');
  document.getElementById('portalEmail').value = '';
  document.getElementById('portalMsg').textContent = '';
  document.getElementById('portalMsg').className = 'modal-msg';
  document.getElementById('portalBtn').textContent = 'Go to portal';
  document.getElementById('portalBtn').disabled = false;
}

function closePortal() {
  document.getElementById('portalModal').classList.remove('active');
}

async function submitPortal() {
  const email = document.getElementById('portalEmail').value.trim();
  const msg = document.getElementById('portalMsg');
  const btn = document.getElementById('portalBtn');
  if (!email || !email.includes('@')) {
    msg.textContent = 'Please enter a valid email.';
    msg.className = 'modal-msg error';
    return;
  }
  btn.textContent = 'Redirecting...';
  btn.disabled = true;
  try {
    const res = await fetch('https://missinglink.build/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      msg.textContent = data.error || 'Could not create portal session. Check your email and try again.';
      msg.className = 'modal-msg error';
      btn.textContent = 'Go to portal';
      btn.disabled = false;
    }
  } catch (e) {
    msg.textContent = 'Something went wrong. Please try again.';
    msg.className = 'modal-msg error';
    btn.textContent = 'Go to portal';
    btn.disabled = false;
  }
}

// ===== MODAL BACKDROP CLICKS =====
document.addEventListener('DOMContentLoaded', function() {
  const resendModal = document.getElementById('resendModal');
  const portalModal = document.getElementById('portalModal');
  if (resendModal) resendModal.addEventListener('click', function(e) { if (e.target === this) closeResend(); });
  if (portalModal) portalModal.addEventListener('click', function(e) { if (e.target === this) closePortal(); });
});

// ===== KEYBOARD =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeResend();
    closePortal();
    closeMobileMenu();
  }
});
