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

function calcStreak(progress) {
  // Use doneOn (actual completion dates) for streak; fall back to scores keys for legacy data
  const completed = Object.keys(progress.doneOn || progress.scores || {}).sort();
  if (!completed.length) return 0;
  const today = getTodayStr();
  let streak = 0, check = today;
  for (let i = 0; i < 365; i++) {
    if (completed.includes(check)) { streak++; }
    else if (check !== today) { break; }
    const d = new Date(check + 'T00:00:00'); d.setDate(d.getDate() - 1);
    check = d.toISOString().slice(0, 10);
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

  // weekly calendar (last 7 lessons)
  const weekGrid = document.getElementById('week-grid');
  weekGrid.innerHTML = '';
  const recentLessons = meta.lessons.slice(0, 7);
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
