// PIN lock — personal access control
// Change PIN: go to browser console → localStorage.removeItem('aws_pin_hash') → reload → enter new PIN
// Default first-time PIN: you choose when first loading the app
(async () => {
  const SESSION_KEY = 'aws_pin_ok';
  const HASH_KEY = 'aws_pin_hash';

  if (sessionStorage.getItem(SESSION_KEY)) return;

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const isFirstTime = !localStorage.getItem(HASH_KEY);

  const overlay = document.createElement('div');
  overlay.id = 'pin-overlay';
  overlay.innerHTML = `
    <div class="pin-box" id="pin-box">
      <div class="pin-logo">🎓</div>
      <div class="pin-title">AWS Journey</div>
      <div class="pin-sub" id="pin-sub">${isFirstTime ? 'Tạo mã PIN 4 chữ số của bạn' : 'Nhập mã PIN để tiếp tục'}</div>
      <div class="pin-dots">
        <span class="dot" id="d0"></span>
        <span class="dot" id="d1"></span>
        <span class="dot" id="d2"></span>
        <span class="dot" id="d3"></span>
      </div>
      <div class="pin-error" id="pin-error"></div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9,'','0','⌫'].map(k =>
          `<button class="pin-key" data-k="${k}">${k}</button>`
        ).join('')}
      </div>
    </div>
  `;
  document.body.prepend(overlay);

  let entered = '';

  function updateDots() {
    for (let i = 0; i < 4; i++) {
      document.getElementById(`d${i}`).classList.toggle('filled', i < entered.length);
    }
  }

  function showError(msg) {
    const el = document.getElementById('pin-error');
    if (el) el.textContent = msg;
  }

  function shake() {
    const box = document.getElementById('pin-box');
    if (!box) return;
    box.classList.add('shake');
    setTimeout(() => box.classList.remove('shake'), 500);
  }

  function unlock() {
    sessionStorage.setItem(SESSION_KEY, '1');
    overlay.style.transition = 'opacity .3s ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }

  async function checkPin() {
    const hash = await sha256(entered);
    const stored = localStorage.getItem(HASH_KEY);

    if (!stored) {
      // First time: save this PIN
      localStorage.setItem(HASH_KEY, hash);
      unlock();
      return;
    }

    if (hash === stored) {
      unlock();
    } else {
      showError('❌ PIN không đúng — thử lại');
      shake();
      entered = '';
      updateDots();
    }
  }

  overlay.addEventListener('click', async e => {
    const btn = e.target.closest('[data-k]');
    if (!btn) return;
    const k = btn.dataset.k;
    if (k === '') return;

    if (k === '⌫') {
      entered = entered.slice(0, -1);
    } else if (entered.length < 4) {
      entered += k;
      showError('');
    }

    updateDots();
    if (entered.length === 4) await checkPin();
  });

  // Keyboard support (desktop)
  document.addEventListener('keydown', async e => {
    if (!document.getElementById('pin-overlay')) return;
    if (e.key >= '0' && e.key <= '9' && entered.length < 4) {
      entered += e.key;
      showError('');
      updateDots();
      if (entered.length === 4) await checkPin();
    } else if (e.key === 'Backspace') {
      entered = entered.slice(0, -1);
      updateDots();
    }
  });
})();
