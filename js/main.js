'use strict';

const STORAGE_KEY = 'aws_learning_v1';

function getProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveProgress(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Timezone-safe: tính hoàn toàn bằng UTC nội bộ, không đi qua giờ local
// (toISOString() sau khi tạo Date theo giờ local sẽ lùi thêm 1 ngày ở múi UTC+7)
function addDaysStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function calcStreak(progress) {
  // Use doneOn (actual completion dates) for streak; fall back to scores keys for legacy data
  const completed = Object.keys(progress.doneOn || progress.scores || {}).sort();
  if (!completed.length) return 0;
  const today = getTodayStr();
  let streak = 0, check = today;
  for (let i = 0; i < 365; i++) {
    if (completed.includes(check)) { streak++; }
    else if (check !== today) { break; }
    check = addDaysStr(check, -1);
  }
  return streak;
}

function goToLesson(date) {
  window.location.href = `lesson.html?date=${date}`;
}

async function loadMeta() {
  const res = await fetch('./lessons/meta.json');
  return res.json();
}

// ===== SRS DUE COUNT (đọc chung key 'aws_srs_v1' + 'aws_quiz_srs_v1' với quiz.js/lesson.js) =====
function getSRSDueCount() {
  try {
    const today = getTodayStr();
    const vocabDb = JSON.parse(localStorage.getItem('aws_srs_v1')) || {};
    const quizDb = JSON.parse(localStorage.getItem('aws_quiz_srs_v1')) || {};
    return Object.values(vocabDb).filter(c => c.due <= today).length
         + Object.values(quizDb).filter(c => c.due <= today).length;
  } catch { return 0; }
}

// ===== PACING: tổng số bài trong TOÀN BỘ curriculum (không chỉ số đã sinh) =====
async function loadCurriculumTotal() {
  try {
    const res = await fetch('./scripts/curriculum.json');
    if (!res.ok) return null;
    const d = await res.json();
    return d.topics?.length || null;
  } catch { return null; }
}

function renderPacingWidget(meta, doneCount, todayStr) {
  if (!meta.target_date) return;
  loadCurriculumTotal().then(totalTopics => {
    if (!totalTopics) return;
    const targetDate = new Date(meta.target_date + 'T00:00:00');
    const nowDate = new Date(todayStr + 'T00:00:00');
    const daysLeft = Math.round((targetDate - nowDate) / 86400000);
    if (daysLeft <= 0) return;
    const remaining = Math.max(0, totalTopics - doneCount);
    const weeksLeft = Math.max(1, daysLeft / 7);
    const perWeek = remaining > 0 ? Math.ceil(remaining / weeksLeft) : 0;

    document.getElementById('pacing-days').textContent =
      `⏳ Còn ${daysLeft} ngày tới SAA-C03 (${formatDateLabel(meta.target_date)})`;
    document.getElementById('pacing-detail').textContent = remaining > 0
      ? `Còn ${remaining}/${totalTopics} bài trong lộ trình — cần ~${perWeek} bài/tuần để kịp`
      : `🎉 Đã học đủ ${totalTopics} bài trong lộ trình!`;
    document.getElementById('pacing-fill').style.width = `${Math.round(doneCount / totalTopics * 100)}%`;
    document.getElementById('pacing-widget').style.display = 'block';
  });
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function dayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return ['CN','T2','T3','T4','T5','T6','T7'][d.getDay()];
}

async function loadContext() {
  try {
    const res = await fetch('./context.json?t=' + Date.now());
    if (!res.ok) return null;
    const ctx = await res.json();
    return ctx.suggest_topics?.length ? ctx : null;
  } catch { return null; }
}

async function renderJapfaSuggest(meta) {
  const ctx = await loadContext();
  if (!ctx) return;

  const today = getTodayStr();
  const matched = meta.lessons.filter(l =>
    ctx.suggest_topics.some(topic =>
      l.title.toLowerCase().includes(topic.toLowerCase().replace(/ &.*/,'').trim())
    ) && l.date >= today
  ).slice(0, 2);

  if (!matched.length) return;

  const updatedAt = ctx.updated_at
    ? new Date(ctx.updated_at).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '';

  const card = document.getElementById('japfa-suggest-card');
  card.innerHTML = `
    <div class="jsc-header">
      <span class="jsc-icon">🏭</span>
      <div style="flex:1;min-width:0">
        <div class="jsc-title">Vừa làm: <span class="jsc-topics">${ctx.suggest_topics.join(' · ')}</span></div>
        <div class="jsc-meta">"${(ctx.commit_msg || '').slice(0, 55)}"${updatedAt ? ' · ' + updatedAt : ''}</div>
      </div>
    </div>
    ${matched.map(l => `
      <div class="jsc-lesson" onclick="window.location.href='lesson.html?date=${l.date}'">
        <span style="font-size:1.4rem">${l.emoji || '☁️'}</span>
        <div style="flex:1;min-width:0">
          <div class="jsc-l-title">${l.title}</div>
          <div class="jsc-l-sub">Ngày ${l.day || ''} · Liên quan đến công việc hôm nay</div>
        </div>
        <span class="jsc-arrow">→</span>
      </div>
    `).join('')}
  `;
  document.getElementById('japfa-suggest').style.display = 'block';
}

async function initDashboard() {
  const meta = await loadMeta();
  const progress = getProgress();
  const today = getTodayStr();
  const streak = calcStreak(progress);
  const completedDates = Object.keys(progress.scores || {});

  // streak badge
  document.getElementById('streak-count').textContent = `🔥 ${streak} ngày`;

  // find today's lesson
  const todayLesson = meta.lessons.find(l => l.date === today)
    || meta.lessons.find(l => l.date > today)
    || meta.lessons[0];

  // stats
  const totalVocab = completedDates.length * 5;
  const totalServices = completedDates.length * 3;
  const avgScore = completedDates.length
    ? Math.round(Object.values(progress.scores || {}).reduce((a,b)=>a+b,0) / completedDates.length / 5 * 100)
    : 0;
  document.getElementById('stat-vocab').textContent = totalVocab;
  document.getElementById('stat-services').textContent = totalServices;
  document.getElementById('stat-score').textContent = avgScore ? avgScore + '%' : '—';

  // progress bar
  const totalLessons = meta.lessons.length;
  const doneCount = completedDates.length;
  const pct = Math.round(doneCount / totalLessons * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `${doneCount}/${totalLessons} bài (${pct}%)`;

  // today card
  const isDone = completedDates.includes(todayLesson.date);
  document.getElementById('today-emoji').textContent = todayLesson.emoji;
  document.getElementById('today-title').textContent = todayLesson.title;
  document.getElementById('today-sub').textContent = todayLesson.subtitle;
  document.getElementById('today-label').textContent =
    today === todayLesson.date ? 'Bài hôm nay' : `Bài ngày ${formatDateLabel(todayLesson.date)}`;
  document.getElementById('today-card-header').style.background =
    `linear-gradient(135deg, ${todayLesson.color}, ${todayLesson.color}cc)`;

  const btnStart = document.getElementById('btn-start');
  btnStart.textContent = isDone ? '✅ Đã hoàn thành — Ôn lại' : '▶ Bắt đầu học';
  if (isDone) btnStart.classList.add('completed');
  btnStart.onclick = () => goToLesson(todayLesson.date);

  // week stats on card
  document.getElementById('tc-vocab').textContent = todayLesson.vocab_count || 5;
  document.getElementById('tc-services').textContent = todayLesson.service_count || 3;
  const dayScore = progress.scores?.[todayLesson.date];
  document.getElementById('tc-quiz').textContent = dayScore != null ? `${dayScore}/5` : '—';

  // japfa activity suggestion
  renderJapfaSuggest(meta);

  // SRS due banner (dùng chung key 'aws_srs_v1' với quiz.js/lesson.js)
  const srsDue = getSRSDueCount();
  if (srsDue > 0) {
    document.getElementById('srs-banner-text').textContent = `${srsDue} mục cần ôn SRS hôm nay (từ vựng + câu AWS)`;
    document.getElementById('srs-banner').style.display = 'flex';
  }

  // Pacing widget — còn bao nhiêu ngày tới ngày thi + cần bao nhiêu bài/tuần
  renderPacingWidget(meta, doneCount, today);

  // weekly calendar — cửa sổ 7 bài trượt theo ngày hiện tại, không cố định Ngày 1-7
  const weekGrid = document.getElementById('week-grid');
  weekGrid.innerHTML = '';
  const todayIdx = meta.lessons.findIndex(l => l.date >= today);
  const centerIdx = todayIdx === -1 ? meta.lessons.length - 1 : todayIdx;
  let winStart = Math.max(0, centerIdx - 3);
  let winEnd = Math.min(meta.lessons.length, winStart + 7);
  winStart = Math.max(0, winEnd - 7);
  const recentLessons = meta.lessons.slice(winStart, winEnd);
  recentLessons.forEach(lesson => {
    const done = completedDates.includes(lesson.date);
    const isToday = lesson.date === today;
    const isFuture = lesson.date > today;
    const div = document.createElement('div');
    div.className = `day-dot${done ? ' completed' : ''}${isToday ? ' today' : ''}${isFuture ? ' future' : ''}`;
    div.innerHTML = `
      <span class="dd-name">${dayName(lesson.date)}</span>
      <span class="dd-num">${new Date(lesson.date+'T00:00:00').getDate()}</span>
      <span class="dd-circle"></span>
    `;
    div.onclick = () => !isFuture && goToLesson(lesson.date);
    weekGrid.appendChild(div);
  });
}

async function initLessonsList() {
  const meta = await loadMeta();
  const progress = getProgress();
  const today = getTodayStr();
  const completedDates = Object.keys(progress.scores || {});
  const list = document.getElementById('lessons-list');
  list.innerHTML = '';
  meta.lessons.forEach(lesson => {
    const done = completedDates.includes(lesson.date);
    const isFuture = lesson.date > today;
    const item = document.createElement('div');
    item.className = 'lesson-item';
    item.innerHTML = `
      <span class="li-emoji">${lesson.emoji}</span>
      <div class="li-info">
        <div class="li-title">${lesson.title}</div>
        <div class="li-sub mono">Ngày ${lesson.day || '?'} · T${lesson.month}W${lesson.week} · ${formatDateLabel(lesson.date)}</div>
      </div>
      <div class="li-status">
        ${done ? '<span class="li-check">✅</span>' : isFuture ? '<span class="li-lock muted">🔒</span>' : '<span class="li-arrow red">→</span>'}
      </div>
    `;
    if (!isFuture) item.onclick = () => goToLesson(lesson.date);
    else item.style.opacity = '.5';
    list.appendChild(item);
  });
}

const DOMAIN_LABELS = {
  secure:     { vi: 'Bảo mật',           weight: 30, color: 'var(--red)' },
  resilient:  { vi: 'Khả năng phục hồi', weight: 26, color: 'var(--blue)' },
  performant: { vi: 'Hiệu năng cao',     weight: 24, color: 'var(--amber)' },
  cost:       { vi: 'Tối ưu chi phí',    weight: 20, color: 'var(--green)' }
};
function getDomainStats() { try { return JSON.parse(localStorage.getItem('aws_domain_stats_v1')) || {}; } catch { return {}; } }

function renderDomainBreakdown() {
  const stats = getDomainStats();
  const domains = Object.keys(DOMAIN_LABELS);
  const answered = domains.filter(d => stats[d]?.total > 0);
  if (!answered.length) return;

  const box = document.getElementById('domain-breakdown');
  box.innerHTML = domains.map(d => {
    const s = stats[d] || { correct: 0, total: 0 };
    const pct = s.total ? Math.round(s.correct / s.total * 100) : null;
    const label = DOMAIN_LABELS[d];
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:3px">
          <span style="font-weight:700">${label.vi} <span style="color:var(--muted);font-family:monospace;font-size:.7rem">(${label.weight}% đề thi)</span></span>
          <span style="font-family:monospace;color:var(--muted)">${pct === null ? '— chưa làm' : `${s.correct}/${s.total} · ${pct}%`}</span>
        </div>
        <div style="height:8px;background:var(--paper-2);border-radius:999px;overflow:hidden;border:1px solid var(--line)">
          <div style="height:100%;width:${pct ?? 0}%;background:${label.color};border-radius:999px"></div>
        </div>
      </div>
    `;
  }).join('');

  // Weakest domain (đủ ít nhất 3 câu để có ý nghĩa thống kê)
  const eligible = answered.filter(d => stats[d].total >= 3);
  if (eligible.length) {
    const weakest = eligible.reduce((a, b) =>
      (stats[a].correct / stats[a].total) <= (stats[b].correct / stats[b].total) ? a : b
    );
    const pct = Math.round(stats[weakest].correct / stats[weakest].total * 100);
    if (pct < 80) {
      const el = document.getElementById('domain-weakest');
      el.style.display = 'block';
      el.innerHTML = `⚠️ Yếu nhất: <strong>${DOMAIN_LABELS[weakest].vi}</strong> (${pct}%) — chiếm ${DOMAIN_LABELS[weakest].weight}% đề thi, nên ưu tiên ôn lại.`;
    }
  }
}

function renderScoreTrend(scores) {
  const dates = Object.keys(scores).sort();
  if (dates.length < 2) return;
  const recent = dates.slice(-15);
  const pts = recent.map(d => Math.round(scores[d] / 5 * 100));
  const w = 300, h = 80, pad = 8;
  const stepX = recent.length > 1 ? (w - pad * 2) / (recent.length - 1) : 0;
  const toY = v => h - pad - (v / 100) * (h - pad * 2);
  const points = pts.map((v, i) => `${pad + i * stepX},${toY(v)}`).join(' ');
  const avgPct = Math.round(pts.reduce((a, b) => a + b, 0) / pts.length);
  const trendUp = pts[pts.length - 1] >= pts[0];
  document.getElementById('score-trend').innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block">
      <polyline points="${points}" fill="none" stroke="${trendUp ? 'var(--green)' : 'var(--red)'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map((v, i) => `<circle cx="${pad + i * stepX}" cy="${toY(v)}" r="3" fill="${trendUp ? 'var(--green)' : 'var(--red)'}"/>`).join('')}
    </svg>
    <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:.72rem;color:var(--muted);margin-top:4px">
      <span>Trung bình ${recent.length} bài gần nhất: ${avgPct}%</span>
      <span>${trendUp ? '📈 Đang tiến bộ' : '📉 Cần chú ý'}</span>
    </div>
  `;
}

const CATEGORY_LABELS = { compute: 'Compute', storage: 'Storage', network: 'Networking', security: 'Security', database: 'Database', serverless: 'Serverless', monitoring: 'Monitoring' };
async function renderCategoryCoverage(completedDates) {
  if (!completedDates.length) return;
  const results = await Promise.all(completedDates.map(d => fetch(`./lessons/${d}.json`).then(r => r.ok ? r.json() : null).catch(() => null)));
  const counts = {};
  results.filter(Boolean).forEach(l => (l.services || []).forEach(s => {
    const cat = s.category || 'other';
    counts[cat] = (counts[cat] || 0) + 1;
  }));
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;
  const max = Math.max(...entries.map(([, n]) => n));
  document.getElementById('category-coverage').innerHTML = entries.map(([cat, n]) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="width:90px;font-size:.78rem;font-weight:700;flex-shrink:0">${CATEGORY_LABELS[cat] || cat}</span>
      <div style="flex:1;height:8px;background:var(--paper-2);border-radius:999px;overflow:hidden;border:1px solid var(--line)">
        <div style="height:100%;width:${Math.round(n / max * 100)}%;background:var(--blue);border-radius:999px"></div>
      </div>
      <span style="font-family:monospace;font-size:.75rem;color:var(--muted);width:24px;text-align:right">${n}</span>
    </div>
  `).join('');
}

async function initStats() {
  const progress = getProgress();
  const meta = await loadMeta();
  const scores = progress.scores || {};
  const completed = Object.keys(scores);

  document.getElementById('stat-streak').textContent = calcStreak(progress);
  document.getElementById('stat-total').textContent = completed.length;
  document.getElementById('stat-vocab').textContent = completed.length * 5;
  document.getElementById('stat-pct').textContent =
    completed.length ? Math.round(completed.length / meta.lessons.length * 100) + '%' : '0%';

  renderDomainBreakdown();
  renderScoreTrend(scores);
  renderCategoryCoverage(completed);

  const hist = document.getElementById('score-history');
  hist.innerHTML = '';
  if (!completed.length) {
    hist.innerHTML = '<div class="empty-state"><div class="es-icon">📊</div><div class="es-msg">Chưa có bài nào — hãy bắt đầu học!</div></div>';
    return;
  }
  completed.sort().reverse().slice(0, 10).forEach(date => {
    const score = scores[date];
    const pct = Math.round(score / 5 * 100);
    const lesson = meta.lessons.find(l => l.date === date);
    const row = document.createElement('div');
    row.className = 'score-bar-row';
    row.innerHTML = `
      <span class="sbr-date">${formatDateLabel(date)}</span>
      <div class="sbr-track"><div class="sbr-fill" style="width:${pct}%;background:${pct>=80?'var(--green)':pct>=60?'var(--amber)':'var(--red)'}"></div></div>
      <span class="sbr-score" style="color:${pct>=80?'var(--green)':pct>=60?'var(--amber)':'var(--red)'}">${score}/5</span>
    `;
    row.title = lesson?.title || date;
    hist.appendChild(row);
  });
}

// Page routing
const page = document.body.dataset.page;
if (page === 'dashboard') initDashboard();
else if (page === 'lessons') initLessonsList();
else if (page === 'stats') initStats();
