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
    const prompt = buildPrompt(topic, lessonDate);
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
      newLessons.push({
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
      });
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
