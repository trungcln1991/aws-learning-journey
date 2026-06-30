'use strict';

const STORAGE_KEY = 'aws_learning_v1';
const SRS_KEY = 'aws_srs_v1';

function getProgress() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
function saveProgress(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }
function getSRS() { try { return JSON.parse(localStorage.getItem(SRS_KEY)) || {}; } catch { return {}; } }
function saveSRS(d) { localStorage.setItem(SRS_KEY, JSON.stringify(d)); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ===== WEB SPEECH TTS =====
function speak(text, rate, btn) {
  rate = rate || 1.0;
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  document.querySelectorAll('.speak-btn.speaking').forEach(b => b.classList.remove('speaking'));
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-US'; utt.rate = rate;
  if (btn) {
    btn.classList.add('speaking');
    utt.onend = () => btn.classList.remove('speaking');
    utt.onerror = () => btn.classList.remove('speaking');
  }
  window.speechSynthesis.speak(utt);
}
window.speak = speak;
document.addEventListener('click', e => {
  const btn = e.target.closest('.speak-btn');
  if (!btn || !btn.dataset.speak) return;
  speak(btn.dataset.speak, parseFloat(btn.dataset.rate || '1'), btn);
});
function escAttr(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

// ===== SM-2 SPACED REPETITION =====
function sm2Update(cardId, quality) {
  const db = getSRS();
  const card = db[cardId] || { ef: 2.5, interval: 0, reps: 0, due: todayStr(), totalReviews: 0, correct: 0 };
  card.totalReviews = (card.totalReviews || 0) + 1;
  if (quality >= 3) {
    card.correct = (card.correct || 0) + 1;
    if (card.reps === 0) card.interval = 1;
    else if (card.reps === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.ef);
    card.ef = Math.max(1.3, card.ef + 0.1 - (5-quality)*(0.08+(5-quality)*0.02));
    card.reps++;
  } else {
    card.reps = 0; card.interval = 1;
  }
  const due = new Date(todayStr()+'T00:00:00'); due.setDate(due.getDate() + card.interval);
  card.due = due.toISOString().slice(0, 10);
  card.lastReviewed = todayStr();
  db[cardId] = card;
  saveSRS(db);
  return card;
}

function srsCardId(word, date) { return `${date}__${word}`; }

function getSRSDue() {
  const db = getSRS(); const today = todayStr();
  return Object.entries(db).filter(([,c]) => c.due <= today).map(([id,c]) => ({id,...c}));
}

// ===== DATA LOADING =====
async function loadMeta() {
  const r = await fetch('./lessons/meta.json'); return r.json();
}
async function loadLesson(date) {
  try { const r = await fetch(`./lessons/${date}.json`); return r.ok ? r.json() : null; }
  catch { return null; }
}
async function loadAllCompletedLessons() {
  const progress = getProgress();
  const completed = Object.keys(progress.scores || {}).sort();
  if (!completed.length) return [];
  const results = await Promise.all(completed.map(loadLesson));
  return results.filter(Boolean);
}
async function loadAllAvailableLessons() {
  const meta = await loadMeta();
  const today = new Date().toISOString().slice(0,10);
  const available = meta.lessons.filter(l => l.date <= today);
  const results = await Promise.all(available.map(l => loadLesson(l.date)));
  return results.filter(Boolean);
}

// ===== ENGLISH QUESTION GENERATORS =====
function shuffle(arr) { return [...arr].sort(() => Math.random() - .5); }

function pickDistractors(correct, pool, key, n = 3) {
  const others = pool.filter(v => v[key] !== correct).map(v => v[key]);
  const unique = [...new Set(others)].filter(Boolean);
  const picked = shuffle(unique).slice(0, n);
  while (picked.length < n) picked.push('—');
  return picked;
}

// TYPE A: Word → Meaning (VI)
function genWordMeaning(vocab, pool) {
  const meaning = vocab.meaning.split('—')[0].trim().split('·')[0].trim();
  const distractors = pickDistractors(
    vocab.meaning, pool, 'meaning', 3
  ).map(m => m.split('—')[0].trim().split('·')[0].trim());
  const options = shuffle([meaning, ...distractors]);
  return {
    qtype: 'english', badge: '🇺🇸 Từ vựng',
    word: vocab.word, example: vocab.example_en,
    question: `"${vocab.word}" có nghĩa là gì?`,
    sub: `Phát âm: ${vocab.ipa} · ${vocab.type}`,
    options,
    answer: options.indexOf(meaning),
    explanation: `${vocab.word} (${vocab.ipa}) = ${vocab.meaning}\n\nVí dụ: "${vocab.example_en}"\n→ ${vocab.example_vi}`
  };
}

// TYPE B: IPA → Word
function genIpaWord(vocab, pool) {
  const distractors = shuffle(pool.filter(v => v.word !== vocab.word)).slice(0,3).map(v => v.word);
  const options = shuffle([vocab.word, ...distractors]);
  return {
    qtype: 'english', badge: '🇺🇸 Phát âm IPA',
    word: vocab.word, example: vocab.example_en,
    question: `Từ có phát âm ${vocab.ipa} là từ nào?`,
    sub: `Gợi ý cách đọc: ${vocab.ipa_guide}`,
    options,
    answer: options.indexOf(vocab.word),
    explanation: `${vocab.ipa} = "${vocab.word}" · Đọc: ${vocab.ipa_guide}\n\nNghĩa: ${vocab.meaning}`
  };
}

// TYPE C: Fill in blank (từ example_en)
function genFillBlank(vocab, pool) {
  const sentence = vocab.example_en;
  const wordLower = vocab.word.toLowerCase();
  const regex = new RegExp(`\\b${wordLower}[a-z]*\\b`, 'i');
  const blanked = sentence.replace(regex, '___');
  if (blanked === sentence) {
    // fallback: show meaning in VI, pick EN word
    const distractors = shuffle(pool.filter(v => v.word !== vocab.word)).slice(0,3).map(v => v.word);
    const options = shuffle([vocab.word, ...distractors]);
    return {
      qtype: 'english', badge: '🇺🇸 Điền từ',
      word: vocab.word, example: vocab.example_en,
      question: `Từ tiếng Anh nào có nghĩa là: "${vocab.meaning}"?`,
      sub: `Loại từ: ${vocab.type} · Dùng trong: ${vocab.usage}`,
      options,
      answer: options.indexOf(vocab.word),
      explanation: `Đáp án: "${vocab.word}"\n${vocab.ipa} · ${vocab.ipa_guide}\n\nVí dụ: "${vocab.example_en}"`
    };
  }
  const distractors = shuffle(pool.filter(v => v.word !== vocab.word)).slice(0,3).map(v => v.word);
  const options = shuffle([vocab.word, ...distractors]);
  return {
    qtype: 'english', badge: '🇺🇸 Điền từ',
    word: vocab.word, example: vocab.example_en,
    question: `Điền vào chỗ trống:\n"${blanked}"`,
    sub: `Gợi ý: ${vocab.type} · Dùng trong: ${vocab.usage}`,
    options,
    answer: options.indexOf(vocab.word),
    explanation: `Câu đầy đủ: "${sentence}"\n→ ${vocab.example_vi}\n\nTừ: ${vocab.word} (${vocab.ipa})`
  };
}

// TYPE D: Word Type Identification
function genWordType(vocab, pool) {
  const allTypes = ['danh từ', 'động từ', 'tính từ', 'trạng từ', 'cụm từ'];
  const correct = vocab.type;
  const distractors = shuffle(allTypes.filter(t => t !== correct)).slice(0,3);
  const options = shuffle([correct, ...distractors]);
  return {
    qtype: 'english', badge: '🇺🇸 Phân loại từ',
    word: vocab.word, example: vocab.example_en,
    question: `"${vocab.word}" thuộc loại từ nào trong tiếng Anh?`,
    sub: `${vocab.ipa} · "${vocab.example_en.slice(0,60)}..."`,
    options,
    answer: options.indexOf(correct),
    explanation: `"${vocab.word}" là ${vocab.type}.\n\nNghĩa: ${vocab.meaning}\nVí dụ: "${vocab.example_en}"`
  };
}

// TYPE E: Reverse — Meaning context → Word (hardest)
function genContext(vocab, pool) {
  const distractors = shuffle(pool.filter(v => v.word !== vocab.word)).slice(0,3).map(v => v.word);
  const options = shuffle([vocab.word, ...distractors]);
  const ctx = vocab.japfa || vocab.usage;
  return {
    qtype: 'english', badge: '🇺🇸 Ngữ cảnh',
    word: vocab.word, example: vocab.example_en,
    question: `Trong ngữ cảnh:\n"${ctx}"\n\nTừ tiếng Anh phù hợp nhất là?`,
    sub: `Gợi ý loại từ: ${vocab.type}`,
    options,
    answer: options.indexOf(vocab.word),
    explanation: `Đáp án: "${vocab.word}"\nNghĩa: ${vocab.meaning}\n${vocab.ipa} · ${vocab.ipa_guide}`
  };
}

function generateEnglishQuestions(lessons, count = 6) {
  const allVocab = lessons.flatMap(l => l.vocabulary || []);
  if (!allVocab.length) return [];
  const types = [genWordMeaning, genIpaWord, genFillBlank, genWordType, genContext];
  const questions = [];
  const shuffledVocab = shuffle(allVocab);
  for (let i = 0; i < Math.min(count, shuffledVocab.length); i++) {
    const vocab = shuffledVocab[i];
    const typeFn = types[i % types.length];
    try { questions.push(typeFn(vocab, allVocab)); }
    catch { questions.push(genWordMeaning(vocab, allVocab)); }
  }
  return questions;
}

function generateAwsQuestions(lessons, count = 9) {
  const allQ = lessons.flatMap(l =>
    (l.quiz || []).map(q => ({ ...q, qtype: 'aws', badge: '☁️ AWS', lessonTitle: l.title }))
  );
  return shuffle(allQ).slice(0, count);
}

// ===== QUIZ MODES =====
const MODES = {
  srs: {
    id: 'srs', icon: '🧠', label: 'Ôn SRS',
    desc: 'Từ vựng sắp quên — ôn đúng lịch SM-2', color: '#6B3E99',
    enCount: 0, awsCount: 0, time: '~3 phút', srsMode: true,
    rule: 'Quy tắc #4: Spaced Repetition — não nhớ 10× lâu hơn'
  },
  vocab: {
    id: 'vocab', icon: '🇺🇸', label: 'Vocab Sprint',
    desc: '10 câu Tiếng Anh — 5 dạng bài', color: '#C32D1A',
    enCount: 10, awsCount: 0, time: '~5 phút',
    rule: 'Quy tắc #2, #3: Học cụm · IPA · Fill blank'
  },
  aws: {
    id: 'aws', icon: '☁️', label: 'AWS Sprint',
    desc: '10 câu AWS — từ các bài đã học', color: '#1F5F86',
    enCount: 0, awsCount: 10, time: '~8 phút',
    rule: 'Quy tắc #5, #8: Pattern nhận dạng · Testing Effect'
  },
  mixed: {
    id: 'mixed', icon: '⚡', label: 'Daily Mix',
    desc: '5 Tiếng Anh + 5 AWS = 10 câu', color: '#1C7A47',
    enCount: 5, awsCount: 5, time: '~7 phút',
    rule: 'Quy tắc #7: 30 phút/ngày đủ mọi kỹ năng'
  },
  master: {
    id: 'master', icon: '🔥', label: 'Full Review',
    desc: '8 Tiếng Anh + 12 AWS = 20 câu', color: '#A9700A',
    enCount: 8, awsCount: 12, time: '~15 phút',
    rule: 'Quy tắc #4, #10: Spaced Rep + Deliberate Practice'
  }
};

// ===== QUIZ RUNNER STATE =====
let quizState = {};

function renderModeSelect(hasLessons) {
  const app = document.getElementById('quiz-app');
  const srsDue = getSRSDue().length;
  const db = getSRS();
  const srsTotal = Object.keys(db).length;

  app.innerHTML = `
    <div style="padding:16px 16px 8px">
      <div style="font-family:monospace;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:4px">CHỌN CHẾ ĐỘ LUYỆN TẬP</div>
      <div style="font-size:.85rem;color:var(--ink-soft)">Phân bổ theo 10 quy tắc học khoa học</div>
    </div>

    <!-- SRS STATUS BANNER -->
    ${srsTotal > 0 ? `
    <div style="margin:0 16px 12px;padding:12px 14px;border-radius:10px;border:2px solid ${srsDue>0?'var(--red)':'var(--green)'};background:${srsDue>0?'rgba(195,45,26,.06)':'rgba(28,122,71,.06)'};display:flex;align-items:center;gap:10px">
      <span style="font-size:1.6rem">${srsDue>0?'⏰':'✅'}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.9rem">${srsDue>0?`${srsDue} từ cần ôn hôm nay!`:'Đã ôn đủ hôm nay 🎉'}</div>
        <div style="font-size:.75rem;color:var(--muted);font-family:monospace">${srsTotal} từ trong SRS · ${Object.values(db).filter(c=>c.interval>=21).length} từ mature</div>
      </div>
      ${srsDue>0?`<button onclick="startQuiz('srs')" style="padding:8px 14px;background:var(--red);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:.82rem;cursor:pointer;white-space:nowrap">Ôn ngay →</button>`:''}
    </div>` : ''}

    ${Object.values(MODES).map(m => `
      <div class="mode-card" onclick="startQuiz('${m.id}')" style="border-left-color:${m.color}${m.id==='srs'&&srsDue===0?';opacity:.5':''}" >
        <div class="mc-head">
          <span class="mc-icon">${m.icon}</span>
          <div class="mc-info">
            <div class="mc-label">${m.label}${m.id==='srs'&&srsDue>0?` <span style="background:var(--red);color:#fff;font-size:.65rem;padding:2px 7px;border-radius:999px;font-family:monospace;font-weight:700;margin-left:4px">${srsDue} DUE</span>`:''}</div>
            <div class="mc-desc">${m.id==='srs'?(srsDue>0?`${srsDue} từ cần ôn hôm nay theo lịch SM-2`:'Không có từ nào due hôm nay — học bài mới nhé!'):m.desc}</div>
          </div>
          <span class="mc-time">${m.time}</span>
        </div>
        <div class="mc-rule">${m.rule}</div>
        ${m.enCount && m.awsCount ? `
          <div class="mc-split">
            <span class="mc-en">🇺🇸 ${m.enCount} EN</span>
            <span class="mc-aws">☁️ ${m.awsCount} AWS</span>
          </div>` : ''}
      </div>
    `).join('')}

    ${!hasLessons ? `
      <div style="margin:16px;padding:20px;background:rgba(195,45,26,.07);border-radius:12px;border:2px dashed var(--red);text-align:center">
        <div style="font-size:2rem;margin-bottom:8px">📚</div>
        <div style="font-weight:700;margin-bottom:4px">Chưa có bài nào</div>
        <div style="font-size:.85rem;color:var(--muted)">Học bài đầu để bắt đầu luyện quiz!</div>
        <a href="lesson.html?date=2026-07-01" style="display:inline-block;margin-top:12px;padding:10px 20px;background:var(--ink);color:var(--paper);border-radius:8px;font-weight:700;font-size:.9rem;text-decoration:none">▶ Bài đầu tiên</a>
      </div>
    ` : ''}
  `;
}

async function startQuiz(modeId) {
  const mode = MODES[modeId];
  const app = document.getElementById('quiz-app');
  app.innerHTML = `<div class="loader"><div class="spinner"></div><span style="font-family:monospace;font-size:.8rem;color:var(--muted)">Đang tạo đề...</span></div>`;

  const lessons = await loadAllAvailableLessons();

  // SRS mode: generate questions only for due cards
  if (mode.srsMode) {
    const due = getSRSDue();
    if (!due.length) {
      app.innerHTML = `<div style="padding:32px 16px;text-align:center">
        <div style="font-size:3rem;margin-bottom:12px">✅</div>
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">Đã ôn đủ hôm nay!</div>
        <div style="font-size:.9rem;color:var(--muted);margin-bottom:20px">Không có từ nào cần ôn. SRS đang hoạt động tốt.</div>
        <button onclick="renderModeSelect(true)" style="padding:12px 24px;background:var(--ink);color:var(--paper);border:none;border-radius:8px;font-weight:700;cursor:pointer">← Chọn chế độ khác</button>
      </div>`;
      return;
    }
    // Find vocab objects for due cards
    const allVocab = lessons.flatMap(l => (l.vocabulary||[]).map(v => ({...v, lessonDate: l.date})));
    const dueVocab = due.map(d => {
      const [date, word] = d.id.split('__');
      return allVocab.find(v => v.word === word && v.lessonDate === date);
    }).filter(Boolean);

    const questions = dueVocab.flatMap(v => {
      const pool = allVocab.filter(av => av.word !== v.word);
      const fns = [genWordMeaning, genIpaWord, genFillBlank];
      const fn = fns[Math.floor(Math.random() * fns.length)];
      try { return [fn(v, pool)]; } catch { return [genWordMeaning(v, pool)]; }
    });
    quizState = { mode, questions, current: 0, selected: null, submitted: false, scores: [], enScores: [], awsScores: [], srsCards: dueVocab.map(v => srsCardId(v.word, v.lessonDate)) };
    renderQuestion();
    return;
  }

  const enQ = mode.enCount > 0 ? generateEnglishQuestions(lessons, mode.enCount) : [];
  const awsQ = mode.awsCount > 0 ? generateAwsQuestions(lessons, mode.awsCount) : [];
  const questions = shuffle([...enQ, ...awsQ]);

  if (!questions.length) {
    app.innerHTML = `<div class="empty-state" style="padding:48px 16px;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:12px">😕</div>
      <div>Không đủ dữ liệu để tạo quiz.<br>Hãy hoàn thành thêm bài học!</div>
      <button onclick="renderModeSelect(false)" style="margin-top:16px;padding:10px 20px;background:var(--ink);color:var(--paper);border-radius:8px;font-weight:700;border:none;cursor:pointer">← Quay lại</button>
    </div>`;
    return;
  }

  quizState = {
    mode, questions, current: 0, selected: null,
    submitted: false, scores: [], enScores: [], awsScores: []
  };
  renderQuestion();
}

function renderQuestion() {
  const { questions, current } = quizState;
  const q = questions[current];
  const total = questions.length;
  const pct = Math.round(current / total * 100);
  const isEn = q.qtype === 'english';
  const badgeColor = isEn ? 'var(--red)' : 'var(--blue)';

  document.getElementById('quiz-app').innerHTML = `
    <div style="padding:16px">
      <!-- progress -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="flex:1;height:6px;background:var(--paper-2);border-radius:999px;overflow:hidden;border:1px solid var(--line)">
          <div style="height:100%;width:${pct}%;background:var(--red);border-radius:999px;transition:width .3s"></div>
        </div>
        <span style="font-family:monospace;font-size:.8rem;font-weight:700;color:var(--muted);white-space:nowrap">${current+1}/${total}</span>
        <button onclick="renderModeSelect(true)" style="font-size:.8rem;color:var(--muted);background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:4px;font-family:monospace">✕ Thoát</button>
      </div>

      <!-- question card -->
      <div style="border:2px solid var(--ink);border-radius:12px;overflow:hidden;box-shadow:4px 4px 0 rgba(22,19,13,.1)">
        <div style="background:var(--ink);color:var(--paper);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;font-family:monospace;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em">
          <span style="background:${badgeColor};padding:3px 10px;border-radius:999px">${q.badge}</span>
          <span style="opacity:.6">${isEn ? 'TIẾNG ANH' : ('Ngày ' + (q.lessonTitle || ''))}</span>
        </div>
        <div style="padding:18px 16px;background:var(--paper)">
          <div style="font-size:.98rem;font-weight:700;line-height:1.55;margin-bottom:6px;white-space:pre-line" id="q-text">${q.question}</div>
          ${q.word ? `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <button class="speak-btn" data-speak="${escAttr(q.word)}" data-rate="1" title="Nghe từ (bình thường)">🔊 ${q.word}</button>
            <button class="speak-btn speak-slow" data-speak="${escAttr(q.word)}" data-rate="0.65" title="Nghe chậm">🐢</button>
            ${q.example ? `<button class="speak-btn speak-example" data-speak="${escAttr(q.example)}" data-rate="0.85" title="Nghe câu ví dụ">🎧 Câu ví dụ</button>` : ''}
          </div>` : ''}
          ${q.sub ? `<div style="font-family:monospace;font-size:.75rem;color:${badgeColor};font-weight:700;margin-bottom:14px">${q.sub}</div>` : '<div style="margin-bottom:14px"></div>'}
          <ul style="list-style:none;display:flex;flex-direction:column;gap:8px" id="q-opts">
            ${q.options.map((opt, i) => `
              <li class="quiz-option" data-idx="${i}" onclick="selectOpt(${i})">
                <span class="opt-key">${String.fromCharCode(65+i)}.</span>
                <span>${opt}</span>
              </li>
            `).join('')}
          </ul>
          <div class="quiz-explanation" id="q-exp"></div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn-check" id="btn-check" disabled onclick="checkAnswer()">Kiểm tra</button>
            <button class="btn-next show" id="btn-next" onclick="nextQ()" style="display:none">
              ${current+1 < total ? 'Câu tiếp →' : 'Xem kết quả →'}
            </button>
          </div>
        </div>
      </div>

      <!-- score mini bar -->
      <div style="display:flex;gap:8px;margin-top:12px">
        <div style="flex:1;background:var(--paper-2);border-radius:8px;padding:8px 12px;border:1.5px solid var(--line)">
          <div style="font-size:.65rem;font-family:monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">🇺🇸 Tiếng Anh</div>
          <div style="font-weight:900;font-size:1rem;color:var(--red)" id="score-en">
            ${quizState.enScores.filter(Boolean).length}/${quizState.enScores.length || '—'}
          </div>
        </div>
        <div style="flex:1;background:var(--paper-2);border-radius:8px;padding:8px 12px;border:1.5px solid var(--line)">
          <div style="font-size:.65rem;font-family:monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">☁️ AWS</div>
          <div style="font-weight:900;font-size:1rem;color:var(--blue)" id="score-aws">
            ${quizState.awsScores.filter(Boolean).length}/${quizState.awsScores.length || '—'}
          </div>
        </div>
      </div>
    </div>
  `;
  quizState.submitted = false;
  quizState.selected = null;
}

window.selectOpt = function(idx) {
  if (quizState.submitted) return;
  document.querySelectorAll('.quiz-option').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.quiz-option[data-idx="${idx}"]`).classList.add('selected');
  quizState.selected = idx;
  document.getElementById('btn-check').disabled = false;
};

window.checkAnswer = function() {
  if (quizState.selected === null || quizState.submitted) return;
  quizState.submitted = true;
  const q = quizState.questions[quizState.current];
  const correct = quizState.selected === q.answer;

  if (q.qtype === 'english') {
    quizState.enScores.push(correct ? 1 : 0);
    // Update SRS for English vocab questions
    if (q.vocabWord && q.lessonDate) {
      const cardId = srsCardId(q.vocabWord, q.lessonDate);
      sm2Update(cardId, correct ? 4 : 1);
    } else if (quizState.srsCards?.[quizState.current]) {
      sm2Update(quizState.srsCards[quizState.current], correct ? 4 : 1);
    }
  } else {
    quizState.awsScores.push(correct ? 1 : 0);
  }
  quizState.scores.push(correct ? 1 : 0);

  document.querySelectorAll('.quiz-option').forEach((el, i) => {
    if (i === q.answer) el.classList.add('correct');
    else if (i === quizState.selected && !correct) el.classList.add('wrong');
    el.style.cursor = 'default';
  });

  const exp = document.getElementById('q-exp');
  exp.textContent = q.explanation;
  exp.classList.add('show');
  if (!correct) exp.classList.add('wrong-exp');

  document.getElementById('btn-check').style.display = 'none';
  document.getElementById('btn-next').style.display = 'block';
};

window.nextQ = function() {
  quizState.current++;
  if (quizState.current >= quizState.questions.length) showResults();
  else renderQuestion();
};

function showResults() {
  const { scores, enScores, awsScores, mode, questions } = quizState;
  const total = scores.length;
  const correct = scores.reduce((a,b) => a+b, 0);
  const pct = Math.round(correct/total*100);
  const enCorrect = enScores.reduce((a,b)=>a+b,0);
  const awsCorrect = awsScores.reduce((a,b)=>a+b,0);

  const grade = pct===100?['🎉','Hoàn hảo!','var(--green)']:pct>=80?['💪','Rất giỏi!','var(--blue)']:pct>=60?['📚','Khá tốt!','var(--amber)']:['🔄','Cần ôn thêm','var(--red)'];

  // Save to progress
  const progress = getProgress();
  const today = new Date().toISOString().slice(0,10);
  if (!progress.quizHistory) progress.quizHistory = [];
  progress.quizHistory.push({ date: today, mode: mode.id, score: correct, total, enScore: enCorrect, enTotal: enScores.length, awsScore: awsCorrect, awsTotal: awsScores.length });
  if (progress.quizHistory.length > 50) progress.quizHistory = progress.quizHistory.slice(-50);
  saveProgress(progress);

  document.getElementById('quiz-app').innerHTML = `
    <div style="padding:16px">
      <div style="border:2px solid var(--ink);border-radius:12px;padding:24px 16px;text-align:center;box-shadow:5px 5px 0 rgba(22,19,13,.12);background:var(--paper);margin-bottom:14px">
        <div style="font-size:3rem;margin-bottom:8px">${grade[0]}</div>
        <div style="font-family:monospace;font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)">KẾT QUẢ ${mode.icon} ${mode.label.toUpperCase()}</div>
        <div style="font-size:4rem;font-weight:900;font-family:Georgia,serif;letter-spacing:-.04em;color:${grade[2]};line-height:1;margin:8px 0 4px">${correct}/${total}</div>
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:12px">${grade[1]} · ${pct}% chính xác</div>

        <!-- Breakdown -->
        <div style="display:flex;gap:8px;margin:16px 0">
          ${enScores.length ? `<div style="flex:1;border:2px solid var(--red);border-radius:10px;padding:12px 8px">
            <div style="font-size:1.5rem;font-weight:900;color:var(--red)">${enCorrect}/${enScores.length}</div>
            <div style="font-family:monospace;font-size:.65rem;color:var(--muted);text-transform:uppercase">🇺🇸 Tiếng Anh<br>${Math.round(enCorrect/enScores.length*100)}%</div>
          </div>` : ''}
          ${awsScores.length ? `<div style="flex:1;border:2px solid var(--blue);border-radius:10px;padding:12px 8px">
            <div style="font-size:1.5rem;font-weight:900;color:var(--blue)">${awsCorrect}/${awsScores.length}</div>
            <div style="font-family:monospace;font-size:.65rem;color:var(--muted);text-transform:uppercase">☁️ AWS<br>${Math.round(awsCorrect/awsScores.length*100)}%</div>
          </div>` : ''}
        </div>

        <!-- Recommendation -->
        <div style="padding:12px;background:var(--paper-2);border-radius:8px;font-size:.82rem;line-height:1.55;text-align:left;border-left:3px solid ${grade[2]}">
          ${getRecommendation(pct, enScores, awsScores)}
        </div>
      </div>

      <button onclick="startQuiz('${mode.id}')" style="width:100%;padding:13px;border-radius:8px;background:var(--ink);color:var(--paper);font-size:.95rem;font-weight:700;border:2px solid var(--ink);margin-bottom:8px;cursor:pointer">🔄 Làm lại ${mode.label}</button>
      <button onclick="renderModeSelect(true)" style="width:100%;padding:12px;border-radius:8px;background:var(--paper);color:var(--ink);font-size:.9rem;font-weight:700;border:2px solid var(--ink);cursor:pointer">← Đổi chế độ khác</button>
    </div>
  `;
}

function getRecommendation(pct, enScores, awsScores) {
  const enPct = enScores.length ? Math.round(enScores.reduce((a,b)=>a+b,0)/enScores.length*100) : null;
  const awsPct = awsScores.length ? Math.round(awsScores.reduce((a,b)=>a+b,0)/awsScores.length*100) : null;
  const tips = [];
  if (enPct !== null && enPct < 70) tips.push('📖 Đọc lại <strong>phần Vocab</strong> trong bài học — đặc biệt chú ý IPA + ví dụ câu (Quy tắc #3).');
  if (awsPct !== null && awsPct < 70) tips.push('☁️ Đọc lại <strong>phần Concepts</strong> trong bài học — hiểu WHY trước HOW (Quy tắc #1 AWS).');
  if (pct === 100) tips.push('🏆 Xuất sắc! Thử chế độ <strong>Full Review</strong> để ôn tổng hợp nhiều bài (Quy tắc #4 Spaced Rep).');
  if (pct >= 80 && pct < 100) tips.push('💪 Tốt! Ôn lại câu sai → đọc giải thích kỹ. Mỗi câu sai = 1 bài học miễn phí (Quy tắc #10).');
  if (!tips.length) tips.push('🎯 Tiếp tục đều đặn mỗi ngày — <strong>30 phút/ngày beats 4 tiếng cuối tuần</strong> (Quy tắc #7).');
  return tips.join('<br>');
}

// ===== INIT =====
async function init() {
  const lessons = await loadAllAvailableLessons();
  renderModeSelect(lessons.length > 0);
}

init();
