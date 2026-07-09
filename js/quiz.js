'use strict';

const STORAGE_KEY = 'aws_learning_v1';
const SRS_KEY = 'aws_srs_v1';

function getProgress() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
function saveProgress(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }
function getSRS() { try { return JSON.parse(localStorage.getItem(SRS_KEY)) || {}; } catch { return {}; } }
function saveSRS(d) { localStorage.setItem(SRS_KEY, JSON.stringify(d)); }
// Local calendar date (khớp với main.js/lesson.js) — KHÔNG dùng toISOString()
// vì đó là giờ UTC, lệch với giờ VN đặc biệt trong khung 00:00-06:59
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

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
  card.due = addDaysStr(todayStr(), card.interval);
  card.lastReviewed = todayStr();
  db[cardId] = card;
  saveSRS(db);
  return card;
}

function srsCardId(word, date) { return `${date}__${word}`; }

// ===== SAA-C03 DOMAIN TRACKING (4 domain thi thật — dùng cho Thống kê + Mock Exam) =====
const DOMAIN_KEY = 'aws_domain_stats_v1';
const DOMAIN_LABELS = {
  secure:     { vi: 'Bảo mật',           en: 'Design Secure Architectures',        weight: 30, color: 'var(--red)' },
  resilient:  { vi: 'Khả năng phục hồi', en: 'Design Resilient Architectures',     weight: 26, color: 'var(--blue)' },
  performant: { vi: 'Hiệu năng cao',     en: 'Design High-Performing Architectures', weight: 24, color: 'var(--amber)' },
  cost:       { vi: 'Tối ưu chi phí',    en: 'Design Cost-Optimized Architectures', weight: 20, color: 'var(--green)' }
};
function getDomainStats() { try { return JSON.parse(localStorage.getItem(DOMAIN_KEY)) || {}; } catch { return {}; } }
function saveDomainStats(d) { localStorage.setItem(DOMAIN_KEY, JSON.stringify(d)); }
function trackDomain(domain, correct) {
  if (!domain || !DOMAIN_LABELS[domain]) return;
  const stats = getDomainStats();
  if (!stats[domain]) stats[domain] = { correct: 0, total: 0 };
  stats[domain].total++;
  if (correct) stats[domain].correct++;
  saveDomainStats(stats);
}

// ===== ACTIVE RECALL: fuzzy answer matching (typing, không phải trắc nghiệm) =====
function normText(s) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/["'`.,!?;:]/g, '');
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
    }
  }
  return dp[m][n];
}
// Cho phép gõ sai ~20% ký tự (typo, thiếu dấu) vẫn tính đúng — vẫn buộc phải nhớ ra từ, không phải gõ y hệt
function fuzzyEqual(input, correct) {
  const a = normText(input), b = normText(correct);
  if (!a) return false;
  if (a === b) return true;
  const tol = Math.max(1, Math.floor(b.length * 0.2));
  return levenshtein(a, b) <= tol;
}
// Chấm lệnh CLI: bỏ qua "aws" ở đầu, yêu cầu đúng service + action (2 token đầu), cho phép sai lệch nhỏ phần còn lại
function cliMatch(input, correct) {
  const a = normText(input).replace(/^aws\s+/, '');
  const b = normText(correct).replace(/^aws\s+/, '');
  if (a === b) return true;
  const at = a.split(' '), bt = b.split(' ');
  if (at[0] && bt[0] && at[0] === bt[0] && at[1] === bt[1]) return true;
  return fuzzyEqual(a, b);
}

// ===== ACTIVE RECALL: bảng lệnh AWS CLI phổ biến theo service (dùng khi bài học chưa có field cli) =====
const CLI_COMMANDS = {
  'ec2': { task: 'Liệt kê tất cả EC2 instances', command: 'aws ec2 describe-instances' },
  'ami': { task: 'Liệt kê các AMI do mình tạo', command: 'aws ec2 describe-images --owners self' },
  'ebs': { task: 'Liệt kê các EBS volume', command: 'aws ec2 describe-volumes' },
  'auto scaling group': { task: 'Liệt kê các Auto Scaling Group', command: 'aws autoscaling describe-auto-scaling-groups' },
  's3': { task: 'Liệt kê các S3 bucket', command: 'aws s3 ls' },
  's3 lifecycle': { task: 'Xem lifecycle policy của 1 S3 bucket', command: 'aws s3api get-bucket-lifecycle-configuration --bucket <name>' },
  's3 glacier': { task: 'Khởi tạo restore file từ S3 Glacier', command: 'aws s3api restore-object --bucket <name> --key <key> --restore-request Days=7' },
  'iam': { task: 'Liệt kê các IAM user', command: 'aws iam list-users' },
  'iam role': { task: 'Liệt kê các IAM role', command: 'aws iam list-roles' },
  'iam policy types': { task: 'Xem chi tiết 1 IAM policy', command: 'aws iam get-policy --policy-arn <arn>' },
  'iam identity center': { task: 'Liệt kê các instance IAM Identity Center', command: 'aws sso-admin list-instances' },
  'sts': { task: 'Xem danh tính IAM đang dùng để gọi CLI', command: 'aws sts get-caller-identity' },
  'security group': { task: 'Liệt kê các Security Group', command: 'aws ec2 describe-security-groups' },
  'network acl': { task: 'Liệt kê các Network ACL', command: 'aws ec2 describe-network-acls' },
  'vpc': { task: 'Liệt kê các VPC', command: 'aws ec2 describe-vpcs' },
  'vpc endpoints': { task: 'Liệt kê các VPC Endpoint', command: 'aws ec2 describe-vpc-endpoints' },
  'vpc peering': { task: 'Liệt kê các VPC Peering Connection', command: 'aws ec2 describe-vpc-peering-connections' },
  'tgw': { task: 'Liệt kê các Transit Gateway', command: 'aws ec2 describe-transit-gateways' },
  'transit gateway': { task: 'Liệt kê các Transit Gateway', command: 'aws ec2 describe-transit-gateways' },
  's2s vpn': { task: 'Liệt kê các Site-to-Site VPN Connection', command: 'aws ec2 describe-vpn-connections' },
  'vpn gateway / site-to-site vpn': { task: 'Liệt kê các VPN Connection', command: 'aws ec2 describe-vpn-connections' },
  'dx': { task: 'Liệt kê các Direct Connect connection', command: 'aws directconnect describe-connections' },
  'rds': { task: 'Liệt kê các RDS DB instance', command: 'aws rds describe-db-instances' },
  'aurora': { task: 'Liệt kê các Aurora DB cluster', command: 'aws rds describe-db-clusters' },
  'alb': { task: 'Liệt kê các Load Balancer', command: 'aws elbv2 describe-load-balancers' },
  'application load balancer': { task: 'Liệt kê các Application Load Balancer', command: 'aws elbv2 describe-load-balancers' },
  'target group health check': { task: 'Xem health status của Target Group', command: 'aws elbv2 describe-target-health --target-group-arn <arn>' },
  'cloudfront': { task: 'Liệt kê các CloudFront distribution', command: 'aws cloudfront list-distributions' },
  'route 53': { task: 'Liệt kê các hosted zone Route 53', command: 'aws route53 list-hosted-zones' },
  'lambda': { task: 'Liệt kê các Lambda function', command: 'aws lambda list-functions' },
  'ecs': { task: 'Liệt kê các ECS cluster', command: 'aws ecs list-clusters' },
  'ecr': { task: 'Liệt kê các ECR repository', command: 'aws ecr describe-repositories' },
  'sns': { task: 'Liệt kê các SNS topic', command: 'aws sns list-topics' },
  'sqs': { task: 'Liệt kê các SQS queue', command: 'aws sqs list-queues' },
  'eventbridge': { task: 'Liệt kê các EventBridge rule', command: 'aws events list-rules' },
  'cloudwatch': { task: 'Liệt kê các CloudWatch alarm', command: 'aws cloudwatch describe-alarms' },
  'aws waf': { task: 'Liệt kê các Web ACL của WAF', command: 'aws wafv2 list-web-acls --scope REGIONAL' },
  'waf': { task: 'Liệt kê các Web ACL của WAF', command: 'aws wafv2 list-web-acls --scope REGIONAL' },
  'shield': { task: 'Xem trạng thái đăng ký Shield Advanced', command: 'aws shield describe-subscription' },
  'aws backup': { task: 'Liệt kê các Backup plan', command: 'aws backup list-backup-plans' },
  'aws organizations': { task: 'Liệt kê các account trong Organization', command: 'aws organizations list-accounts' },
};
function cliInfoFor(service) {
  if (service.cli && service.cli.command) return service.cli;
  const key = normText(service.name);
  if (CLI_COMMANDS[key]) return CLI_COMMANDS[key];
  const fullKey = normText(service.full || '');
  return CLI_COMMANDS[fullKey] || null;
}

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
  const today = todayStr();
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

// ===== ACTIVE RECALL: câu hỏi phải GÕ đáp án (Generation Effect — Quy tắc #9) =====
// Không có sẵn đáp án để chọn → buộc não tự sinh ra câu trả lời, mã hóa trí nhớ sâu hơn nhiều so với trắc nghiệm.

// TYPE F: điền từ còn thiếu (gõ, không chọn)
function genTypeFillBlank(vocab) {
  const sentence = vocab.example_en;
  const wordLower = vocab.word.toLowerCase();
  const regex = new RegExp(`\\b${wordLower}[a-z]*\\b`, 'i');
  const match = sentence.match(regex);
  const targetWord = match ? match[0] : vocab.word;
  const blanked = match ? sentence.replace(regex, '_____') : `${sentence} (từ: _____)`;
  return {
    qtype: 'english', badge: '✍️ Điền từ', inputType: 'typed', typedKind: 'fillblank',
    vocabWord: vocab.word, lessonDate: vocab.lessonDate,
    word: vocab.word, example: vocab.example_en,
    question: `Gõ từ tiếng Anh còn thiếu:\n"${blanked}"`,
    sub: `Gợi ý nghĩa: ${vocab.meaning.split('—')[0].trim()} · ${vocab.type}`,
    placeholder: 'Gõ từ tiếng Anh...',
    answer: targetWord,
    explanation: `Đáp án: "${targetWord}"\n${vocab.ipa} · ${vocab.ipa_guide}\n\nCâu đầy đủ: "${sentence}"\n→ ${vocab.example_vi}`
  };
}

// TYPE G: nghĩa tiếng Việt → gõ từ tiếng Anh
function genTypeViToEn(vocab) {
  const meaning = vocab.meaning.split('—')[0].trim().split('·')[0].trim();
  return {
    qtype: 'english', badge: '✍️ Việt → Anh', inputType: 'typed', typedKind: 'vitoen',
    vocabWord: vocab.word, lessonDate: vocab.lessonDate,
    word: vocab.word, example: vocab.example_en,
    question: `Từ tiếng Anh nào có nghĩa là:\n"${meaning}"?`,
    sub: `Loại từ: ${vocab.type} · Dùng trong: ${vocab.usage}`,
    placeholder: 'Gõ từ tiếng Anh...',
    answer: vocab.word,
    explanation: `Đáp án: "${vocab.word}" (${vocab.ipa} · ${vocab.ipa_guide})\n\nVí dụ: "${vocab.example_en}"\n→ ${vocab.example_vi}`
  };
}

// TYPE H: từ tiếng Anh → gõ nghĩa tiếng Việt (tự chấm — nghĩa diễn giải nhiều cách nên không so khớp máy móc)
function genTypeTranslateToVi(vocab) {
  return {
    qtype: 'english', badge: '✍️ Dịch nghĩa', inputType: 'typed', typedKind: 'translate',
    vocabWord: vocab.word, lessonDate: vocab.lessonDate,
    word: vocab.word, example: vocab.example_en,
    question: `Dịch câu sau sang tiếng Việt:\n"${vocab.example_en}"`,
    sub: `Từ khóa: ${vocab.word} (${vocab.ipa})`,
    placeholder: 'Gõ bản dịch tiếng Việt...',
    answer: vocab.example_vi,
    explanation: `Bản dịch tham khảo: "${vocab.example_vi}"\n\n"${vocab.word}" = ${vocab.meaning}`
  };
}

// TYPE I: gõ lệnh AWS CLI theo mô tả tác vụ
function genTypeCli(service) {
  const info = cliInfoFor(service);
  if (!info) return null;
  return {
    qtype: 'aws', badge: '⌨️ CLI', inputType: 'typed', typedKind: 'cli',
    lessonTitle: service.lessonTitle || service.name,
    question: `Gõ lệnh AWS CLI để: ${info.task}`,
    sub: `Service: ${service.name}${service.full ? ' — ' + service.full : ''}`,
    placeholder: 'aws ...',
    answer: info.command,
    explanation: `Lệnh đúng: ${info.command}\n\n${service.what || ''}`
  };
}

function generateActiveRecallQuestions(lessons, enCount = 6, cliCount = 4) {
  const allVocab = lessons.flatMap(l => (l.vocabulary || []).map(v => ({ ...v, lessonDate: l.date })));
  const allServices = lessons.flatMap(l => (l.services || []).map(s => ({ ...s, lessonTitle: l.title })));

  const enTypes = [genTypeFillBlank, genTypeViToEn, genTypeTranslateToVi];
  const shuffledVocab = shuffle(allVocab);
  const enQs = [];
  for (let i = 0; i < Math.min(enCount, shuffledVocab.length); i++) {
    const fn = enTypes[i % enTypes.length];
    try { const q = fn(shuffledVocab[i]); if (q) enQs.push(q); } catch {}
  }

  const cliQs = [];
  for (const s of shuffle(allServices)) {
    if (cliQs.length >= cliCount) break;
    const q = genTypeCli(s);
    if (q && !cliQs.some(x => x.answer === q.answer)) cliQs.push(q);
  }

  return shuffle([...enQs, ...cliQs]);
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

// Đúng tỷ trọng 4 domain thi thật (Secure 30% · Resilient 26% · Performant 24% · Cost 20% của 65 câu)
const MOCK_EXAM_TARGETS = { secure: 20, resilient: 17, performant: 16, cost: 12 };
function generateMockExamQuestions(lessons) {
  const allQ = lessons.flatMap(l =>
    (l.quiz || []).map(q => ({ ...q, qtype: 'aws', badge: '📝 Mock Exam', lessonTitle: l.title }))
  );
  const picked = [];
  for (const [domain, target] of Object.entries(MOCK_EXAM_TARGETS)) {
    const pool = shuffle(allQ.filter(q => q.domain === domain));
    picked.push(...pool.slice(0, target));
  }
  return shuffle(picked);
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
  },
  recall: {
    id: 'recall', icon: '✍️', label: 'Active Recall',
    desc: 'GÕ đáp án — dịch · điền từ · lệnh CLI, không có sẵn để chọn', color: '#16130D',
    enCount: 6, cliCount: 4, time: '~10 phút', recallMode: true,
    rule: 'Quy tắc #9: Generation Effect — tự viết ra nhớ sâu hơn chọn trắc nghiệm'
  },
  mockexam: {
    id: 'mockexam', icon: '📝', label: 'Mock Exam',
    desc: 'Tới 65 câu · 130 phút · đúng tỷ trọng 4 domain như đề thật — không xem đáp án ngay', color: '#C32D1A',
    time: '130 phút', mockExamMode: true,
    rule: 'Mô phỏng áp lực phòng thi thật — chấm 1 lần khi nộp bài'
  }
};

// ===== 10 QUY TẮC HỌC KHOA HỌC (căn cứ để thiết kế các chế độ luyện tập ở trên) =====
const LEARNING_RULES = [
  { n: 1, title: 'Hiểu WHY trước HOW', body: 'Đừng học thuộc cấu hình — hiểu tại sao AWS thiết kế service theo cách đó thì mới suy luận được câu hỏi tình huống trong đề thi.' },
  { n: 2, title: 'Chunking — học theo cụm', body: 'Học từ trong cụm/collocation thật (vd "launch an instance", không học rời "launch") — dễ nhớ và dùng đúng ngữ cảnh hơn học từ đơn lẻ.' },
  { n: 3, title: 'Multi-sensory Encoding', body: 'Nghe (TTS) + đọc + gõ + phát âm (IPA) cùng lúc — càng nhiều giác quan tham gia, càng nhiều đường liên kết trong não để nhớ lại sau này.' },
  { n: 4, title: 'Spaced Repetition (SM-2)', body: 'Ôn đúng lúc sắp quên — không ôn lại quá sớm (phí thời gian) hay quá muộn (đã quên). Nhớ lâu hơn gấp nhiều lần so với học nhồi 1 lần.' },
  { n: 5, title: 'Pattern Recognition', body: 'Nhóm các AWS service theo pattern hay ra đề (High Availability, DR, tối ưu chi phí, bảo mật...) thay vì học rời rạc từng service.' },
  { n: 6, title: 'Elaboration', body: 'Tự giải thích lại bằng lời của mình + liên hệ hạ tầng Japfa thật (đó là lý do mỗi bài đều có mục "Japfa") — elaboration giúp mã hóa trí nhớ sâu hơn đọc thụ động.' },
  { n: 7, title: 'Distributed Practice', body: '30 phút/ngày đều đặn hiệu quả hơn nhiều so với dồn 4 tiếng cuối tuần — não cần thời gian nghỉ giữa các lần học để củng cố (consolidation).' },
  { n: 8, title: 'Testing Effect', body: 'Tự kiểm tra bằng quiz — kể cả khi chưa chắc câu trả lời — củng cố trí nhớ mạnh hơn nhiều so với đọc lại tài liệu thêm 1 lần.' },
  { n: 9, title: 'Generation Effect', body: 'Tự viết/gõ ra câu trả lời (dịch, điền từ, lệnh CLI) tạo trí nhớ sâu hơn hẳn so với chỉ nhận diện đáp án trong 4 lựa chọn có sẵn → dùng chế độ Active Recall.' },
  { n: 10, title: 'Deliberate Practice', body: 'Tập trung ôn đúng những câu/từ mình SAI, không lặp lại cái đã giỏi — mỗi câu sai là 1 tín hiệu chỉ đúng chỗ cần luyện.' }
];

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
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="font-size:.85rem;color:var(--ink-soft)">Phân bổ theo 10 quy tắc học khoa học</div>
        <button onclick="toggleRules()" id="rules-toggle-btn" style="flex-shrink:0;background:none;border:1.5px solid var(--line-strong);border-radius:999px;padding:4px 10px;font-size:.72rem;font-family:monospace;font-weight:700;color:var(--ink-soft);cursor:pointer">📖 Xem 10 quy tắc</button>
      </div>
    </div>

    <!-- 10 LEARNING RULES (collapsed by default) -->
    <div id="rules-panel" style="display:none;margin:0 16px 12px;border:2px solid var(--ink);border-radius:10px;overflow:hidden;background:var(--paper)">
      <div style="background:var(--ink);color:var(--paper);padding:8px 14px;font-family:monospace;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em">10 QUY TẮC HỌC KHOA HỌC — VÌ SAO APP THIẾT KẾ NHƯ VẬY</div>
      <div style="padding:10px 14px;display:flex;flex-direction:column;gap:10px">
        ${LEARNING_RULES.map(r => `
          <div style="display:flex;gap:10px">
            <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:var(--paper-2);border:1.5px solid var(--line-strong);display:flex;align-items:center;justify-content:center;font-family:monospace;font-weight:700;font-size:.7rem">${r.n}</span>
            <div>
              <div style="font-weight:700;font-size:.85rem;margin-bottom:1px">${r.title}</div>
              <div style="font-size:.78rem;color:var(--ink-soft);line-height:1.5">${r.body}</div>
            </div>
          </div>
        `).join('')}
      </div>
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
        ${m.recallMode ? `
          <div class="mc-split">
            <span class="mc-en">🇺🇸 ${m.enCount} dịch/điền từ</span>
            <span class="mc-aws">⌨️ ${m.cliCount} lệnh CLI</span>
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

  // Active Recall mode: câu hỏi phải GÕ đáp án (dịch, điền từ, lệnh CLI) — không có sẵn để chọn
  if (mode.recallMode) {
    const questions = generateActiveRecallQuestions(lessons, mode.enCount, mode.cliCount);
    if (!questions.length) {
      app.innerHTML = `<div class="empty-state" style="padding:48px 16px;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:12px">😕</div>
        <div>Không đủ dữ liệu để tạo đề Active Recall.<br>Hãy hoàn thành thêm bài học!</div>
        <button onclick="renderModeSelect(false)" style="margin-top:16px;padding:10px 20px;background:var(--ink);color:var(--paper);border-radius:8px;font-weight:700;border:none;cursor:pointer">← Quay lại</button>
      </div>`;
      return;
    }
    quizState = { mode, questions, current: 0, selected: null, submitted: false, scores: [], enScores: [], awsScores: [] };
    renderQuestion();
    return;
  }

  // Mock Exam: mô phỏng đề thi thật — 65 câu đúng tỷ trọng domain, có giờ, không xem đáp án ngay
  if (mode.mockExamMode) {
    const questions = generateMockExamQuestions(lessons);
    if (questions.length < 10) {
      app.innerHTML = `<div class="empty-state" style="padding:48px 16px;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:12px">😕</div>
        <div>Chưa đủ câu hỏi đã gắn domain để tạo Mock Exam (cần tối thiểu 10, hiện có ${questions.length}).<br>Học thêm vài bài rồi quay lại nhé!</div>
        <button onclick="renderModeSelect(false)" style="margin-top:16px;padding:10px 20px;background:var(--ink);color:var(--paper);border-radius:8px;font-weight:700;border:none;cursor:pointer">← Quay lại</button>
      </div>`;
      return;
    }
    startMockExam(questions);
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
          ${q.inputType === 'typed' ? `
            <input type="text" id="q-typed-input" class="quiz-typed-input${q.typedKind==='cli'?' cli-input':''}"
              placeholder="${escAttr(q.placeholder || 'Gõ đáp án...')}" autocomplete="off" autocapitalize="off" spellcheck="false"
              oninput="onTypedInput()" onkeydown="if(event.key==='Enter'){event.preventDefault();var b=document.getElementById('btn-check');if(!b.disabled)b.click();}">
            <div id="q-typed-reveal"></div>
          ` : `
          <ul style="list-style:none;display:flex;flex-direction:column;gap:8px" id="q-opts">
            ${q.options.map((opt, i) => `
              <li class="quiz-option" data-idx="${i}" onclick="selectOpt(${i})">
                <span class="opt-key">${String.fromCharCode(65+i)}.</span>
                <span>${opt}</span>
              </li>
            `).join('')}
          </ul>
          `}
          <div class="quiz-explanation" id="q-exp"></div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn-check" id="btn-check" disabled onclick="${q.inputType==='typed' ? 'checkTyped()' : 'checkAnswer()'}">${q.inputType==='typed' && q.typedKind==='translate' ? 'Xem đáp án' : 'Kiểm tra'}</button>
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
    trackDomain(q.domain, correct);
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

// ===== ACTIVE RECALL: chấm câu hỏi kiểu GÕ đáp án =====
window.onTypedInput = function() {
  const val = document.getElementById('q-typed-input').value.trim();
  document.getElementById('btn-check').disabled = !val;
};

window.checkTyped = function() {
  if (quizState.submitted) return;
  const q = quizState.questions[quizState.current];
  const inputEl = document.getElementById('q-typed-input');
  const val = inputEl.value;
  quizState.submitted = true;
  inputEl.disabled = true;

  // Dịch nghĩa (translate) không thể so khớp máy móc — tự chấm bằng cách xem đáp án rồi tự đánh giá
  if (q.typedKind === 'translate') {
    document.getElementById('q-typed-reveal').innerHTML = `
      <div style="margin-top:10px;padding:10px 12px;background:var(--paper-2);border-radius:8px;border-left:3px solid var(--blue)">
        <div style="font-family:monospace;font-size:.68rem;text-transform:uppercase;color:var(--muted);margin-bottom:2px">Bản dịch tham khảo</div>
        <div style="font-weight:700;font-size:.9rem">${q.answer}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="gradeTyped(true)" style="flex:1;padding:10px;border-radius:8px;border:2px solid var(--green);background:rgba(28,122,71,.08);color:var(--green);font-weight:700;cursor:pointer">✅ Tôi dịch đúng ý</button>
        <button onclick="gradeTyped(false)" style="flex:1;padding:10px;border-radius:8px;border:2px solid var(--red);background:rgba(195,45,26,.08);color:var(--red);font-weight:700;cursor:pointer">❌ Tôi dịch sai/thiếu</button>
      </div>
    `;
    document.getElementById('btn-check').style.display = 'none';
    return;
  }

  const correct = q.typedKind === 'cli' ? cliMatch(val, q.answer) : fuzzyEqual(val, q.answer);
  finalizeTyped(correct);
};

window.gradeTyped = function(correct) {
  finalizeTyped(correct);
};

function finalizeTyped(correct) {
  const q = quizState.questions[quizState.current];
  const inputEl = document.getElementById('q-typed-input');
  if (inputEl) inputEl.style.borderColor = correct ? 'var(--green)' : 'var(--red)';

  if (q.qtype === 'english') {
    quizState.enScores.push(correct ? 1 : 0);
    if (q.vocabWord && q.lessonDate) sm2Update(srsCardId(q.vocabWord, q.lessonDate), correct ? 4 : 1);
  } else {
    quizState.awsScores.push(correct ? 1 : 0);
    trackDomain(q.domain, correct);
  }
  quizState.scores.push(correct ? 1 : 0);

  const reveal = document.getElementById('q-typed-reveal');
  if (q.typedKind !== 'translate' && reveal) {
    reveal.innerHTML = correct
      ? `<div style="margin-top:10px;color:var(--green);font-weight:700;font-size:.88rem">✅ Chính xác!</div>`
      : `<div style="margin-top:10px;padding:10px 12px;background:rgba(195,45,26,.06);border-radius:8px;border-left:3px solid var(--red)">
          <div style="font-weight:700;color:var(--red);font-size:.8rem;margin-bottom:2px">Chưa đúng — đáp án:</div>
          <div style="font-weight:700;font-size:.9rem">${q.answer}</div>
        </div>`;
  }

  const exp = document.getElementById('q-exp');
  exp.textContent = q.explanation;
  exp.classList.add('show');
  if (!correct) exp.classList.add('wrong-exp');

  document.getElementById('btn-check').style.display = 'none';
  document.getElementById('btn-next').style.display = 'block';
}

window.toggleRules = function() {
  const panel = document.getElementById('rules-panel');
  const btn = document.getElementById('rules-toggle-btn');
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  btn.textContent = open ? '📖 Xem 10 quy tắc' : '📖 Ẩn 10 quy tắc';
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
  const today = todayStr();
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

// ===== MOCK EXAM ENGINE (không xem đáp án ngay — chấm 1 lần khi nộp bài, giống thi thật) =====
const EXAM_DURATION_SEC = 130 * 60;
let examTimerId = null;

function startMockExam(questions) {
  quizState = {
    mode: MODES.mockexam, questions, current: 0,
    examAnswers: new Array(questions.length).fill(null),
    examSecondsLeft: EXAM_DURATION_SEC
  };
  examTimerId = setInterval(() => {
    quizState.examSecondsLeft--;
    const t = document.getElementById('exam-timer');
    if (t) {
      t.textContent = formatExamTime(quizState.examSecondsLeft);
      if (quizState.examSecondsLeft <= 600) t.style.color = 'var(--red)';
    }
    if (quizState.examSecondsLeft <= 0) { clearInterval(examTimerId); finishExam(); }
  }, 1000);
  renderExamQuestion();
}

function formatExamTime(sec) {
  const m = Math.floor(Math.max(0, sec) / 60), s = Math.max(0, sec) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function exitMockExam() {
  if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
  renderModeSelect(true);
}
window.exitMockExam = exitMockExam;

function renderExamQuestion() {
  const { questions, current, examAnswers } = quizState;
  const q = questions[current];
  const total = questions.length;
  const answeredCount = examAnswers.filter(a => a !== null).length;

  document.getElementById('quiz-app').innerHTML = `
    <div style="padding:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="flex:1;height:6px;background:var(--paper-2);border-radius:999px;overflow:hidden;border:1px solid var(--line)">
          <div style="height:100%;width:${Math.round((current+1)/total*100)}%;background:var(--red);border-radius:999px"></div>
        </div>
        <span id="exam-timer" style="font-family:monospace;font-size:.85rem;font-weight:900;white-space:nowrap">${formatExamTime(quizState.examSecondsLeft)}</span>
        <button onclick="exitMockExam()" style="font-size:.8rem;color:var(--muted);background:none;border:none;cursor:pointer;padding:4px 6px;font-family:monospace">✕ Thoát</button>
      </div>

      <div style="border:2px solid var(--ink);border-radius:12px;overflow:hidden;box-shadow:4px 4px 0 rgba(22,19,13,.1)">
        <div style="background:var(--ink);color:var(--paper);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;font-family:monospace;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em">
          <span style="background:var(--red);padding:3px 10px;border-radius:999px">Câu ${current+1}/${total}</span>
          <span style="opacity:.6">Đã trả lời: ${answeredCount}/${total}</span>
        </div>
        <div style="padding:18px 16px;background:var(--paper)">
          <div style="font-size:.98rem;font-weight:700;line-height:1.55;margin-bottom:14px;white-space:pre-line">${q.question}</div>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:8px" id="exam-opts">
            ${q.options.map((opt, i) => `
              <li class="quiz-option${examAnswers[current] === i ? ' selected' : ''}" data-idx="${i}" onclick="examSelectOpt(${i})">
                <span class="opt-key">${String.fromCharCode(65+i)}.</span>
                <span>${opt}</span>
              </li>
            `).join('')}
          </ul>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button onclick="examNav(-1)" ${current === 0 ? 'disabled' : ''} style="flex:1;padding:12px;border-radius:8px;border:2px solid var(--ink);background:var(--paper);color:var(--ink);font-weight:700;cursor:pointer;opacity:${current===0?'.4':'1'}">← Câu trước</button>
            ${current + 1 < total
              ? `<button onclick="examNav(1)" style="flex:1;padding:12px;border-radius:8px;border:2px solid var(--ink);background:var(--ink);color:var(--paper);font-weight:700;cursor:pointer">Câu tiếp →</button>`
              : `<button onclick="confirmFinishExam()" style="flex:1;padding:12px;border-radius:8px;border:2px solid var(--red);background:var(--red);color:#fff;font-weight:700;cursor:pointer">📝 Nộp bài</button>`
            }
          </div>
          ${current + 1 === total ? '' : `<button onclick="confirmFinishExam()" style="width:100%;margin-top:8px;padding:8px;background:none;border:none;color:var(--muted);font-size:.78rem;font-family:monospace;cursor:pointer;text-decoration:underline">Nộp bài sớm (còn ${total - answeredCount} câu chưa trả lời)</button>`}
          <div id="exam-confirm-box" style="display:none;margin-top:12px;padding:12px;background:rgba(195,45,26,.06);border-radius:8px;border:2px solid var(--red)">
            <div class="ecb-text" style="font-size:.85rem;font-weight:700;margin-bottom:10px"></div>
            <div style="display:flex;gap:8px">
              <button onclick="document.getElementById('exam-confirm-box').style.display='none'" style="flex:1;padding:10px;border-radius:8px;border:2px solid var(--ink);background:var(--paper);color:var(--ink);font-weight:700;cursor:pointer">Chưa, quay lại</button>
              <button onclick="finishExam()" style="flex:1;padding:10px;border-radius:8px;border:2px solid var(--red);background:var(--red);color:#fff;font-weight:700;cursor:pointer">✅ Nộp bài</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.examSelectOpt = function(idx) {
  quizState.examAnswers[quizState.current] = idx;
  document.querySelectorAll('#exam-opts .quiz-option').forEach((el, i) => el.classList.toggle('selected', i === idx));
};

window.examNav = function(delta) {
  quizState.current = Math.max(0, Math.min(quizState.questions.length - 1, quizState.current + delta));
  renderExamQuestion();
};

window.confirmFinishExam = function() {
  const unanswered = quizState.examAnswers.filter(a => a === null).length;
  const box = document.getElementById('exam-confirm-box');
  box.querySelector('.ecb-text').textContent = unanswered > 0
    ? `Còn ${unanswered} câu chưa trả lời. Nộp bài luôn?`
    : 'Nộp bài Mock Exam?';
  box.style.display = 'block';
};

function finishExam() {
  if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
  const { questions, examAnswers } = quizState;
  const domainScore = { secure: [0,0], resilient: [0,0], performant: [0,0], cost: [0,0] };
  let correct = 0;

  questions.forEach((q, i) => {
    const isCorrect = examAnswers[i] === q.answer;
    if (isCorrect) correct++;
    trackDomain(q.domain, isCorrect);
    if (domainScore[q.domain]) {
      domainScore[q.domain][1]++;
      if (isCorrect) domainScore[q.domain][0]++;
    }
  });

  const total = questions.length;
  const pct = Math.round(correct / total * 100);
  const passed = pct >= 72; // xấp xỉ ngưỡng đậu thật (720/1000 scaled score) — chỉ mang tính mô phỏng

  const progress = getProgress();
  if (!progress.mockExamHistory) progress.mockExamHistory = [];
  progress.mockExamHistory.push({ date: todayStr(), score: correct, total, pct, passed });
  saveProgress(progress);

  document.getElementById('quiz-app').innerHTML = `
    <div style="padding:16px">
      <div style="border:2px solid var(--ink);border-radius:12px;padding:24px 16px;text-align:center;box-shadow:5px 5px 0 rgba(22,19,13,.12);background:var(--paper);margin-bottom:14px">
        <div style="font-size:3rem;margin-bottom:8px">${passed ? '🎉' : '📚'}</div>
        <div style="font-family:monospace;font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)">KẾT QUẢ MOCK EXAM</div>
        <div style="font-size:4rem;font-weight:900;font-family:Georgia,serif;color:${passed?'var(--green)':'var(--red)'};line-height:1;margin:8px 0 4px">${correct}/${total}</div>
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:4px">${pct}% chính xác</div>
        <div style="display:inline-block;padding:6px 16px;border-radius:999px;font-weight:700;font-size:.85rem;background:${passed?'rgba(28,122,71,.1)':'rgba(195,45,26,.1)'};color:${passed?'var(--green)':'var(--red)'}">
          ${passed ? '✅ ĐẬU (mô phỏng — ngưỡng ~72%)' : '❌ CHƯA ĐẬU (mô phỏng — ngưỡng ~72%)'}
        </div>

        <div style="margin-top:18px;text-align:left">
          ${Object.entries(domainScore).map(([d, [c, t]]) => {
            if (!t) return '';
            const dp = Math.round(c/t*100);
            return `<div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:3px">
                <span style="font-weight:700">${DOMAIN_LABELS[d].vi}</span>
                <span style="font-family:monospace;color:var(--muted)">${c}/${t} · ${dp}%</span>
              </div>
              <div style="height:8px;background:var(--paper-2);border-radius:999px;overflow:hidden;border:1px solid var(--line)">
                <div style="height:100%;width:${dp}%;background:${DOMAIN_LABELS[d].color};border-radius:999px"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <button onclick="renderExamReview()" style="width:100%;padding:13px;border-radius:8px;background:var(--paper);color:var(--ink);font-size:.95rem;font-weight:700;border:2px solid var(--ink);margin-bottom:8px;cursor:pointer">📋 Xem lại từng câu (kèm đáp án đúng)</button>
      <button onclick="renderModeSelect(true)" style="width:100%;padding:12px;border-radius:8px;background:var(--ink);color:var(--paper);font-size:.9rem;font-weight:700;border:2px solid var(--ink);cursor:pointer">← Về chọn chế độ</button>
    </div>
  `;
}

window.renderExamReview = function() {
  const { questions, examAnswers } = quizState;
  document.getElementById('quiz-app').innerHTML = `
    <div style="padding:16px">
      <button onclick="renderModeSelect(true)" style="margin-bottom:12px;padding:8px 14px;border-radius:8px;border:2px solid var(--ink);background:var(--paper);color:var(--ink);font-weight:700;cursor:pointer;font-size:.82rem">← Về chọn chế độ</button>
      ${questions.map((q, i) => {
        const correct = examAnswers[i] === q.answer;
        return `
        <div style="border:2px solid ${correct?'var(--green)':'var(--red)'};border-radius:10px;padding:14px;margin-bottom:10px;background:var(--paper)">
          <div style="font-size:.68rem;font-family:monospace;color:var(--muted);margin-bottom:6px">CÂU ${i+1} · ${DOMAIN_LABELS[q.domain]?.vi || '—'} · ${correct ? '✅ Đúng' : examAnswers[i]===null ? '⬜ Bỏ trống' : '❌ Sai'}</div>
          <div style="font-weight:700;font-size:.9rem;margin-bottom:8px;white-space:pre-line">${q.question}</div>
          <div style="font-size:.85rem;color:var(--ink-soft);margin-bottom:6px">Đáp án đúng: <strong>${q.options[q.answer]}</strong></div>
          <div style="font-size:.8rem;color:var(--muted);line-height:1.5">${q.explanation}</div>
        </div>`;
      }).join('')}
      <button onclick="renderModeSelect(true)" style="width:100%;padding:13px;border-radius:8px;background:var(--ink);color:var(--paper);font-size:.95rem;font-weight:700;border:2px solid var(--ink);cursor:pointer">← Về chọn chế độ</button>
    </div>
  `;
};

// ===== INIT =====
async function init() {
  const lessons = await loadAllAvailableLessons();
  const autoMode = new URLSearchParams(window.location.search).get('mode');
  if (autoMode && MODES[autoMode] && lessons.length > 0) { startQuiz(autoMode); return; }
  renderModeSelect(lessons.length > 0);
}

init();
