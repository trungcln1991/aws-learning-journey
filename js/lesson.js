'use strict';

const STORAGE_KEY = 'aws_learning_v1';

function getProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveProgress(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }

function getDateParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get('date');
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function typeClass(type) {
  if (type.includes('động')) return 'type-verb';
  if (type.includes('tính')) return 'type-adj';
  if (type.includes('cụm')) return 'type-phrase';
  return 'type-noun';
}

function renderVocab(vocab) {
  return vocab.map(v => `
    <div class="vocab-card">
      <div class="vocab-card-head">
        <span class="vc-word">${v.word}</span>
        <span class="vc-type-badge ${typeClass(v.type)}">${v.type}</span>
      </div>
      <div class="vocab-card-body">
        <div class="vc-ipa">${v.ipa}</div>
        <div class="vc-guide">${v.ipa_guide}</div>
        <div class="vc-meaning">${v.meaning}</div>
        <div class="vc-divider"></div>
        <div class="vc-example-en">"${v.example_en}"</div>
        <div class="vc-example-vi">${v.example_vi}</div>
        <div class="vc-usage">Dùng trong: ${v.usage}</div>
        ${v.japfa ? `<div class="vc-japfa">🏭 Japfa: ${v.japfa}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderServices(services) {
  return services.map(s => `
    <div class="service-card">
      <div class="service-card-head">
        <span class="svc-icon">${s.icon}</span>
        <div class="svc-names">
          <div class="svc-name">${s.name}</div>
          <div class="svc-full">${s.full}</div>
        </div>
        ${s.japfa ? '<span class="japfa-pill">Japfa ✓</span>' : ''}
      </div>
      <div class="service-card-body">
        <div class="svc-what">${s.what}</div>
        <div class="svc-when-label">Dùng khi nào</div>
        <div class="svc-when">${s.when}</div>
        <ul class="svc-points">
          ${s.key_points.map(p => `<li>${p}</li>`).join('')}
        </ul>
        ${s.japfa && s.japfa_detail ? `<div class="svc-japfa">${s.japfa_detail}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderConcepts(concepts) {
  return concepts.map(c => `
    <div class="concept-card">
      <div class="concept-card-head">
        <span class="cc-icon">${c.icon}</span>
        <span class="cc-title">${c.title}</span>
      </div>
      <div class="concept-card-body">
        <div class="cc-body">${c.body}</div>
        ${c.diagram ? `<div class="cc-diagram">${c.diagram}</div>` : ''}
        ${c.exam_tip ? `<div class="cc-exam">${c.exam_tip}</div>` : ''}
        ${c.japfa ? `<div class="cc-japfa">${c.japfa}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ===== QUIZ STATE =====
let quizState = {
  questions: [],
  current: 0,
  selected: null,
  submitted: false,
  scores: [],
  done: false
};

function renderCurrentQuestion() {
  const q = quizState.questions[quizState.current];
  const total = quizState.questions.length;
  const pct = Math.round(quizState.current / total * 100);

  document.getElementById('q-progress-fill').style.width = pct + '%';
  document.getElementById('q-progress-label').textContent = `${quizState.current + 1} / ${total}`;
  document.getElementById('q-number').textContent = `Câu ${quizState.current + 1}/${total}`;
  document.getElementById('q-difficulty').textContent = q.difficulty === 'easy' ? '🟢 Dễ' : q.difficulty === 'hard' ? '🔴 Khó' : '🟡 TB';
  document.getElementById('q-question').textContent = q.question;

  const optsList = document.getElementById('q-options');
  optsList.innerHTML = q.options.map((opt, i) => `
    <li class="quiz-option" data-idx="${i}">
      <span class="opt-key">${String.fromCharCode(65+i)}.</span>
      <span>${opt}</span>
    </li>
  `).join('');

  optsList.querySelectorAll('.quiz-option').forEach(el => {
    el.addEventListener('click', () => {
      if (quizState.submitted) return;
      optsList.querySelectorAll('.quiz-option').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      quizState.selected = parseInt(el.dataset.idx);
      document.getElementById('btn-check').disabled = false;
    });
  });

  document.getElementById('quiz-explanation').classList.remove('show', 'wrong-exp');
  document.getElementById('quiz-explanation').textContent = '';
  const btnCheck = document.getElementById('btn-check');
  const btnNext = document.getElementById('btn-next');
  btnCheck.disabled = true;
  btnCheck.style.display = '';
  btnNext.classList.remove('show');
  btnNext.textContent = quizState.current + 1 < total ? 'Câu tiếp →' : 'Xem kết quả →';
  quizState.submitted = false;
  quizState.selected = null;
}

function submitAnswer() {
  if (quizState.selected === null || quizState.submitted) return;
  quizState.submitted = true;
  const q = quizState.questions[quizState.current];
  const correct = quizState.selected === q.answer;
  quizState.scores.push(correct ? 1 : 0);

  const opts = document.querySelectorAll('.quiz-option');
  opts.forEach((el, i) => {
    if (i === q.answer) el.classList.add('correct');
    else if (i === quizState.selected && !correct) el.classList.add('wrong');
    else if (i !== q.answer) el.classList.add('reveal-correct');
    el.style.cursor = 'default';
  });

  const exp = document.getElementById('quiz-explanation');
  exp.textContent = q.explanation;
  exp.classList.add('show');
  if (!correct) exp.classList.add('wrong-exp');

  document.getElementById('btn-check').style.display = 'none';
  document.getElementById('btn-next').classList.add('show');
}

function nextQuestion() {
  quizState.current++;
  if (quizState.current >= quizState.questions.length) {
    showResults();
  } else {
    renderCurrentQuestion();
  }
}

function showResults() {
  quizState.done = true;
  const score = quizState.scores.reduce((a, b) => a + b, 0);
  const total = quizState.questions.length;
  const pct = Math.round(score / total * 100);

  const messages = {
    100: ['🎉 Hoàn hảo!', 'Xuất sắc! Bạn nắm vững hoàn toàn nội dung hôm nay.'],
    80:  ['💪 Rất giỏi!', 'Bạn hiểu tốt — ôn lại câu sai để củng cố thêm.'],
    60:  ['📚 Khá!', 'Đã hiểu phần lớn — đọc lại phần Concepts và thử quiz lại nhé.'],
    0:   ['🔄 Cần ôn thêm', 'Đọc lại bài học rồi thử lại — lần này sẽ tốt hơn!'],
  };
  const msgKey = pct === 100 ? 100 : pct >= 80 ? 80 : pct >= 60 ? 60 : 0;
  const [title, msg] = messages[msgKey];
  const scoreClass = pct === 100 ? 'perfect' : pct >= 80 ? 'good' : pct >= 60 ? 'ok' : 'retry';

  document.getElementById('quiz-container').innerHTML = `
    <div class="quiz-results">
      <div class="qr-label">Kết quả Quiz</div>
      <div class="qr-score ${scoreClass}">${score}/${total}</div>
      <div class="qr-label">${pct}% chính xác · ${title}</div>
      <div class="qr-msg">${msg}</div>
      <button class="btn-complete" id="btn-complete">✅ Đánh dấu hoàn thành</button>
      <button class="btn-retry" id="btn-retry">🔄 Làm lại Quiz</button>
    </div>
  `;

  document.getElementById('btn-complete').onclick = () => completeLesson(score, total);
  document.getElementById('btn-retry').onclick = () => startQuiz(quizState.questions);
}

function completeLesson(score, total) {
  const date = getDateParam();
  const progress = getProgress();
  if (!progress.scores) progress.scores = {};
  progress.scores[date] = score;
  // Track actual calendar date for streak (lesson date ≠ completion date)
  if (!progress.doneOn) progress.doneOn = {};
  progress.doneOn[getTodayStr()] = true;
  saveProgress(progress);
  showToast('✅ Đã lưu! Streak tăng lên rồi 🔥');
  setTimeout(() => window.location.href = 'index.html', 1800);
}

function startQuiz(questions) {
  quizState = { questions, current: 0, selected: null, submitted: false, scores: [], done: false };
  document.getElementById('quiz-container').innerHTML = `
    <div class="quiz-wrap">
      <div class="quiz-progress">
        <div class="qp-track"><div class="qp-fill" id="q-progress-fill" style="width:0%"></div></div>
        <span class="qp-label" id="q-progress-label">1/${questions.length}</span>
      </div>
      <div class="quiz-q-card">
        <div class="quiz-q-head">
          <span id="q-number"></span>
          <span id="q-difficulty"></span>
        </div>
        <div class="quiz-q-body">
          <div class="quiz-question" id="q-question"></div>
          <ul class="quiz-options" id="q-options"></ul>
          <div class="quiz-explanation" id="quiz-explanation"></div>
          <div class="quiz-actions">
            <button class="btn-check" id="btn-check" disabled onclick="submitAnswer()">Kiểm tra</button>
            <button class="btn-next" id="btn-next" onclick="nextQuestion()">Câu tiếp →</button>
          </div>
        </div>
      </div>
    </div>
  `;
  // expose functions to inline handlers
  window.submitAnswer = submitAnswer;
  window.nextQuestion = nextQuestion;
  renderCurrentQuestion();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== TAB SWITCHING =====
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ===== MAIN INIT =====
async function init() {
  const date = getDateParam();
  if (!date) { window.location.href = 'index.html'; return; }

  // Set header date
  document.getElementById('lesson-date').textContent = new Date(date+'T00:00:00').toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric'});

  try {
    const res = await fetch(`./lessons/${date}.json`);
    if (!res.ok) throw new Error('Chưa có bài học cho ngày này');
    const lesson = await res.json();

    // header
    document.getElementById('lesson-emoji').textContent = lesson.emoji;
    document.getElementById('lesson-title').textContent = lesson.title;
    document.getElementById('lesson-sub').textContent = lesson.subtitle;
    document.getElementById('lesson-meta').textContent =
      `Ngày ${lesson.day} · Tuần ${lesson.week} · Tháng ${lesson.month} · ${lesson.category}`;
    document.getElementById('lesson-hero').style.borderColor = lesson.color;

    // check completion
    const progress = getProgress();
    const isDone = progress.scores?.[date] != null;
    if (isDone) {
      document.getElementById('done-banner').style.display = 'flex';
      document.getElementById('done-score').textContent = `Quiz: ${progress.scores[date]}/5`;
    }

    // render tabs
    document.getElementById('tab-vocab').innerHTML = renderVocab(lesson.vocabulary);
    document.getElementById('tab-services').innerHTML = renderServices(lesson.services);
    document.getElementById('tab-concepts').innerHTML = renderConcepts(lesson.concepts);

    // update tab counts
    document.querySelector('[data-tab="vocab"]').textContent = `📚 Vocab (${lesson.vocabulary.length})`;
    document.querySelector('[data-tab="services"]').textContent = `☁️ AWS (${lesson.services.length})`;
    document.querySelector('[data-tab="concepts"]').textContent = `💡 Concepts (${lesson.concepts.length})`;

    // quiz tab
    document.querySelector('[data-tab="quiz"]').textContent = `✏️ Quiz (${lesson.quiz.length} câu)`;
    document.getElementById('quiz-container').innerHTML = `
      <div style="text-align:center;padding:32px 16px">
        <div style="font-size:2.5rem;margin-bottom:12px">✏️</div>
        <p style="font-size:.95rem;color:var(--ink-soft);margin-bottom:20px">
          ${lesson.quiz.length} câu hỏi · Đọc xong Vocab + AWS trước khi làm nhé!
        </p>
        <button class="btn-start" onclick="startQuiz(window.__quiz__)">▶ Bắt đầu Quiz</button>
      </div>
    `;
    window.__quiz__ = lesson.quiz;
    window.startQuiz = startQuiz;

    initTabs();
    document.getElementById('loader').style.display = 'none';
    document.getElementById('lesson-content').style.display = 'block';

  } catch (err) {
    document.getElementById('loader').innerHTML = `
      <div class="empty-state">
        <div class="es-icon">😕</div>
        <div class="es-msg">${err.message}<br><br><a href="index.html" style="color:var(--red);font-weight:700">← Quay về trang chủ</a></div>
      </div>
    `;
  }
}

init();
