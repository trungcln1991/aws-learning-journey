#!/usr/bin/env node
/**
 * Auto-generate AWS lesson JSON files using Anthropic API
 * Usage: ANTHROPIC_API_KEY=sk-... node scripts/generate-lesson.mjs [--count 3]
 * Called by GitHub Actions weekly to keep content fresh
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const COUNT = parseInt(process.argv.find((a, i, arr) => arr[i-1] === '--count') || '3');

// Load curriculum & meta
const curriculum = JSON.parse(readFileSync(resolve(__dir, 'curriculum.json'), 'utf8'));
const meta = JSON.parse(readFileSync(resolve(root, 'lessons/meta.json'), 'utf8'));

// Find next lessons to generate — dựa vào FILE nội dung thật đã tồn tại, không chỉ dựa vào
// việc "day" có mặt trong meta.json. meta.json có thể chứa placeholder (day + date đã khai báo)
// nhưng chưa từng sinh file lessons/<date>.json — nếu chỉ check meta.lessons thì các ngày này
// bị coi là "đã xong" và bị bỏ qua VĨNH VIỄN, dẫn tới bài học không bao giờ được tạo nội dung.
const metaByDay = new Map(meta.lessons.map(l => [l.day, l]));
const hasContent = (l) => existsSync(resolve(root, `lessons/${l.date}.json`));
const existingDays = new Set(meta.lessons.filter(hasContent).map(l => l.day));
const nextTopics = curriculum.topics.filter(t => !existingDays.has(t.day)).slice(0, COUNT);

if (!nextTopics.length) {
  console.log('All curriculum topics already generated!');
  process.exit(0);
}

console.log(`Generating ${nextTopics.length} lessons: ${nextTopics.map(t => t.title).join(', ')}`);

// Find next lesson date (skip weekends, continue from last lesson)
// Tính hoàn toàn theo UTC nội bộ để không phụ thuộc timezone máy chạy script
// (tránh lặp lại bug cũ: tạo Date theo giờ local rồi toISOString() làm lệch ngày)
function nextLessonDate(lastDateStr) {
  const [y, m, d] = lastDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Build the JSON schema prompt
function buildPrompt(topic, lessonDate) {
  return `You are generating a lesson JSON file for an AWS learning PWA app. The learner is a Vietnamese IT Operations engineer at Japfa Vietnam (poultry company). They manage 7 AWS accounts (jp:prod, jp:uat, jp:poc, jp:network, jp:aggregator, jp:cloudtrail, jp:shareservice) and on-premises infrastructure (FortiGate VPN, VMware).

Generate a lesson JSON for:
- Date: ${lessonDate}
- Day: ${topic.day}, Week: ${topic.week}, Month: ${topic.month}
- Title: ${topic.title}
- Subtitle: ${topic.subtitle}
- Category: ${topic.category}
- Color: ${topic.color}
- Emoji: ${topic.emoji}

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation. Use this EXACT schema:

{
  "date": "${lessonDate}",
  "day": ${topic.day},
  "week": ${topic.week},
  "month": ${topic.month},
  "title": "${topic.title}",
  "subtitle": "${topic.subtitle}",
  "category": "${topic.category}",
  "color": "${topic.color}",
  "emoji": "${topic.emoji}",
  "vocabulary": [
    {
      "word": "string (AWS/IT English word)",
      "ipa": "/IPA notation/",
      "ipa_guide": "Vietnamese pronunciation guide, e.g. 'Đọc: OB-ject'",
      "type": "danh từ|động từ|tính từ|trạng từ",
      "meaning": "Vietnamese meaning — detailed",
      "example_en": "Full English sentence using this word in AWS context",
      "example_vi": "Vietnamese translation of example",
      "usage": "Where this word is used, e.g. 'S3 · CLI · CloudFormation'",
      "japfa": "Real Japfa Vietnam connection (mention specific account/resource)"
    }
  ],
  "services": [
    {
      "name": "AWS Service short name",
      "full": "AWS Service Full Name",
      "category": "compute|storage|network|security|database|serverless|monitoring",
      "icon": "emoji",
      "what": "What it does in 1-2 sentences",
      "when": "When to use it",
      "key_points": ["point 1", "point 2", "point 3", "point 4"],
      "japfa": true|false,
      "japfa_detail": "How Japfa uses this service specifically (if japfa=true)",
      "cli": {
        "task": "Vietnamese description of a common CLI task for this service, e.g. 'Liệt kê tất cả EC2 instances'",
        "command": "The real AWS CLI v2 command, e.g. 'aws ec2 describe-instances'"
      }
    }
  ],
  "concepts": [
    {
      "title": "Concept title",
      "icon": "emoji",
      "body": "Clear explanation in Vietnamese, 2-3 sentences",
      "diagram": "ASCII diagram showing the concept (use spaces/arrows)",
      "exam_tip": "SAA-C03 exam tip — what they commonly ask",
      "japfa": "How this applies to Japfa Vietnam infrastructure"
    }
  ],
  "quiz": [
    {
      "id": 1,
      "question": "Question in Vietnamese",
      "options": ["A option", "B option", "C option", "D option"],
      "answer": 0,
      "difficulty": "easy|medium|hard",
      "explanation": "Vietnamese explanation of why the answer is correct"
    }
  ]
}

STRICT REQUIREMENTS (keep responses concise to fit in tokens):
- vocabulary: exactly 5 words. Each field max 120 chars. No long paragraphs.
- services: exactly 3 AWS services. key_points: max 3 points, each max 80 chars.
- services.cli: a real, correct AWS CLI v2 read-only command (describe/list/get) — used to teach hands-on CLI recall, must actually work
- concepts: exactly 2 concepts. body: max 2 sentences. diagram: simple ASCII max 10 lines.
- quiz: exactly 5 questions. explanation: max 80 chars each.
- All Vietnamese text EXCEPT: word, ipa, example_en, diagram content
- IPA must be phonetically correct
- Japfa connections: mention specific account names (jp:prod/jp:poc/etc) or real resources
- CRITICAL: Return complete valid JSON only. No markdown fences. No truncation.`;
}

// ===== REVIEW LESSONS: lấy đúng nội dung 5 bài thật liền trước, không để AI bịa mới =====
// (Quy tắc #4/#10 trong app: ôn phải bám sát cái đã học, không phải học thêm nội dung mới đội lốt "ôn tập")
function getPriorRealLessons(topic, allTopics) {
  const idx = allTopics.findIndex(t => t.day === topic.day);
  const prior = [];
  for (let i = idx - 1; i >= 0 && prior.length < 5; i--) {
    const t = allTopics[i];
    if (t.category === 'Review') continue; // không ôn lại 1 bài ôn tập khác
    const placeholder = metaByDay.get(t.day);
    if (!placeholder || !hasContent(placeholder)) continue; // bài chưa sinh thì bỏ qua
    try {
      const lesson = JSON.parse(readFileSync(resolve(root, `lessons/${placeholder.date}.json`), 'utf8'));
      prior.unshift({
        title: t.title,
        vocab: (lesson.vocabulary || []).map(v => `${v.word} = ${v.meaning.split('—')[0].trim()}`),
        services: (lesson.services || []).map(s => `${s.name} (${s.full}): ${s.what}`)
      });
    } catch {}
  }
  return prior;
}

function buildReviewPrompt(topic, lessonDate, priorLessons) {
  const vocabPool = priorLessons.flatMap(l => l.vocab);
  const servicePool = priorLessons.flatMap(l => l.services);
  return `You are generating a REVIEW lesson JSON for an AWS learning PWA app. The learner is a Vietnamese IT Operations engineer at Japfa Vietnam (poultry company), managing 7 AWS accounts (jp:prod, jp:uat, jp:poc, jp:network, jp:aggregator, jp:cloudtrail, jp:shareservice) and on-premises infrastructure (FortiGate VPN, VMware).

This is a REVIEW lesson recapping the ${priorLessons.length} lessons the learner just finished:
${priorLessons.map(l => `- ${l.title}`).join('\n')}

Vocabulary already taught (REUSE these exact words — do NOT invent new vocabulary):
${vocabPool.map(v => `- ${v}`).join('\n')}

Services already taught (REUSE these exact services — do NOT invent new services):
${servicePool.map(s => `- ${s}`).join('\n')}

Generate a lesson JSON for:
- Date: ${lessonDate}
- Day: ${topic.day}, Week: ${topic.week}, Month: ${topic.month}
- Title: ${topic.title}
- Subtitle: ${topic.subtitle}
- Category: Review
- Color: ${topic.color}
- Emoji: ${topic.emoji}

REVIEW-SPECIFIC RULES (this is what makes it a real review, not a new lesson):
- vocabulary: pick exactly 5 words FROM THE LIST ABOVE (the ones most likely to be confused/forgotten). Keep the same word + same core meaning, but write a FRESH example_en sentence for variety.
- services: pick exactly 3 services FROM THE LIST ABOVE. Fresh "what/when/key_points" wording is fine, but it must be the same real service.
- concepts: exactly 2 concepts — make at least 1 of them a CROSS-CUTTING comparison/synthesis across 2+ of the services above (e.g. "So sánh X vs Y" or "Khi nào dùng X thay vì Y") — this is the core value of a review.
- quiz: exactly 5 questions, each written as an SAA-C03 style scenario. Each question MUST combine 2-3 of the services/vocab above in one scenario (not test them in isolation) — mirrors how the real exam interleaves topics.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation. Use this EXACT schema:

{
  "date": "${lessonDate}",
  "day": ${topic.day},
  "week": ${topic.week},
  "month": ${topic.month},
  "title": "${topic.title}",
  "subtitle": "${topic.subtitle}",
  "category": "Review",
  "color": "${topic.color}",
  "emoji": "${topic.emoji}",
  "vocabulary": [
    {
      "word": "string (must be one of the taught words above)",
      "ipa": "/IPA notation/",
      "ipa_guide": "Vietnamese pronunciation guide, e.g. 'Đọc: OB-ject'",
      "type": "danh từ|động từ|tính từ|trạng từ",
      "meaning": "Vietnamese meaning — detailed",
      "example_en": "Fresh English sentence using this word in AWS context",
      "example_vi": "Vietnamese translation of example",
      "usage": "Where this word is used, e.g. 'S3 · CLI · CloudFormation'",
      "japfa": "Real Japfa Vietnam connection (mention specific account/resource)"
    }
  ],
  "services": [
    {
      "name": "AWS Service short name (must be one of the taught services above)",
      "full": "AWS Service Full Name",
      "category": "compute|storage|network|security|database|serverless|monitoring",
      "icon": "emoji",
      "what": "What it does in 1-2 sentences",
      "when": "When to use it",
      "key_points": ["point 1", "point 2", "point 3", "point 4"],
      "japfa": true|false,
      "japfa_detail": "How Japfa uses this service specifically (if japfa=true)",
      "cli": {
        "task": "Vietnamese description of a common CLI task for this service, e.g. 'Liệt kê tất cả EC2 instances'",
        "command": "The real AWS CLI v2 command, e.g. 'aws ec2 describe-instances'"
      }
    }
  ],
  "concepts": [
    {
      "title": "Concept title (at least 1 concept must compare/synthesize 2+ services from the review scope)",
      "icon": "emoji",
      "body": "Clear explanation in Vietnamese, 2-3 sentences",
      "diagram": "ASCII diagram showing the concept (use spaces/arrows)",
      "exam_tip": "SAA-C03 exam tip — what they commonly ask",
      "japfa": "How this applies to Japfa Vietnam infrastructure"
    }
  ],
  "quiz": [
    {
      "id": 1,
      "question": "Scenario question in Vietnamese combining 2-3 services from the review scope",
      "options": ["A option", "B option", "C option", "D option"],
      "answer": 0,
      "difficulty": "easy|medium|hard",
      "explanation": "Vietnamese explanation of why the answer is correct"
    }
  ]
}

STRICT REQUIREMENTS (keep responses concise to fit in tokens):
- vocabulary: exactly 5 words, all reused from the list above. Each field max 120 chars.
- services: exactly 3 services, all reused from the list above. key_points: max 3 points, each max 80 chars.
- services.cli: a real, correct AWS CLI v2 read-only command (describe/list/get)
- concepts: exactly 2 concepts. body: max 2 sentences. diagram: simple ASCII max 10 lines.
- quiz: exactly 5 questions, each a multi-service scenario. explanation: max 80 chars each.
- All Vietnamese text EXCEPT: word, ipa, example_en, diagram content
- IPA must be phonetically correct
- Japfa connections: mention specific account names (jp:prod/jp:poc/etc) or real resources
- CRITICAL: Return complete valid JSON only. No markdown fences. No truncation.`;
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

// Main generation loop
let lastDate = meta.lessons.at(-1)?.date || new Date().toISOString().slice(0,10);
const newLessons = [];

for (const topic of nextTopics) {
  // Nếu day này đã có placeholder trong meta.json (thiếu file nội dung) thì dùng lại đúng ngày
  // đã khai báo — không gán ngày mới, tránh tạo 2 bài trùng ngày hoặc lệch lịch đã công bố.
  const placeholder = metaByDay.get(topic.day);
  const lessonDate = placeholder ? placeholder.date : nextLessonDate(lastDate);
  console.log(`\n→ Generating Day ${topic.day}: ${topic.title} (${lessonDate})${placeholder ? ' [backfill placeholder]' : ''}`);

  try {
    const isReview = topic.category === 'Review';
    const prompt = isReview
      ? buildReviewPrompt(topic, lessonDate, getPriorRealLessons(topic, curriculum.topics))
      : buildPrompt(topic, lessonDate);
    const raw = await callClaude(prompt);

    // Extract JSON (strip any markdown if present)
    const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const lesson = JSON.parse(jsonStr);

    // Validate required fields
    if (!lesson.vocabulary?.length || !lesson.services?.length || !lesson.quiz?.length) {
      throw new Error('Missing required fields in generated lesson');
    }

    // Save lesson file
    const filePath = resolve(root, `lessons/${lessonDate}.json`);
    writeFileSync(filePath, JSON.stringify(lesson, null, 2), 'utf8');
    console.log(`  ✅ Saved: lessons/${lessonDate}.json`);

    // Add to meta — chỉ khi day này CHƯA có entry sẵn (backfill placeholder thì đã có rồi)
    if (!placeholder) {
      const newEntry = {
        date: lessonDate,
        day: topic.day,
        title: topic.title,
        subtitle: topic.subtitle,
        category: topic.category,
        week: topic.week,
        month: topic.month,
        color: topic.color,
        emoji: topic.emoji,
        vocab_count: lesson.vocabulary.length,
        service_count: lesson.services.length
      };
      newLessons.push(newEntry);
      // Cập nhật metaByDay NGAY trong vòng lặp — nếu không, getPriorRealLessons() của 1 bài Review
      // sinh sau đó trong CÙNG lần chạy này sẽ không thấy các bài vừa sinh (metaByDay ban đầu chỉ
      // snapshot meta.json cũ), và lặc lùi quá xa lấy nhầm nội dung của các bài học trước đó nữa.
      metaByDay.set(topic.day, newEntry);
      lastDate = lessonDate;
    }

    // Rate limit: wait 2s between calls
    if (nextTopics.indexOf(topic) < nextTopics.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error(`  ❌ Failed: ${err.message}`);
  }
}

// Update meta.json
if (newLessons.length) {
  meta.lessons = [...meta.lessons, ...newLessons];
  meta.last_generated = new Date().toISOString();
  meta.total_lessons = meta.lessons.length;
  writeFileSync(resolve(root, 'lessons/meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  console.log(`\n✅ Updated meta.json — total ${meta.lessons.length} lessons`);
}

console.log('\n🎉 Generation complete!');
