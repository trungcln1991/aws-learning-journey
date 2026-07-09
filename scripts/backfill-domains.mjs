#!/usr/bin/env node
/**
 * One-off: gắn quiz.domain (secure|resilient|performant|cost) cho các bài đã sinh
 * TRƯỚC KHI field này tồn tại trong schema. Chỉ sửa field domain, không đụng câu hỏi/đáp án.
 * Usage: ANTHROPIC_API_KEY=sk-... node scripts/backfill-domains.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

const DOMAIN_GUIDE = `SAA-C03 exam domains:
- "secure" (Domain 1, 30%) — IAM, KMS, encryption, network security (SG/NACL/WAF), least privilege, compliance
- "resilient" (Domain 2, 26%) — Multi-AZ, DR, decoupling (SQS/SNS), auto-healing, backup/restore, fault tolerance
- "performant" (Domain 3, 24%) — caching, CDN, read replicas, auto scaling, storage/compute selection for performance
- "cost" (Domain 4, 20%) — Reserved/Spot, storage tiering, right-sizing, serverless vs always-on cost trade-offs`;

async function classify(questions) {
  const prompt = `${DOMAIN_GUIDE}

Classify each of these ${questions.length} AWS exam-style quiz questions into exactly ONE domain code above.
Pick the domain that BEST matches what the question is actually testing (not just which service it mentions).

${questions.map((q, i) => `${i + 1}. ${q.question}\n   Explanation: ${q.explanation}`).join('\n\n')}

Return ONLY a JSON array of ${questions.length} domain codes in order, e.g. ["secure","resilient","cost","performant","secure"]. No markdown, no explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = data.content[0].text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(raw);
}

const VALID = new Set(['secure', 'resilient', 'performant', 'cost']);

async function main() {
  const files = readdirSync(resolve(root, 'lessons')).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  let patched = 0, skipped = 0;

  for (const file of files) {
    const filePath = resolve(root, 'lessons', file);
    const lesson = JSON.parse(readFileSync(filePath, 'utf8'));
    const quiz = lesson.quiz || [];
    const missing = quiz.filter(q => !VALID.has(q.domain));
    if (!missing.length) { skipped++; continue; }

    console.log(`→ ${file}: gắn domain cho ${missing.length}/${quiz.length} câu`);
    try {
      const domains = await classify(quiz);
      quiz.forEach((q, i) => {
        if (!VALID.has(q.domain) && VALID.has(domains[i])) q.domain = domains[i];
        else if (!VALID.has(q.domain)) q.domain = 'resilient'; // fallback an toàn nếu model trả sai format
      });
      lesson.quiz = quiz;
      writeFileSync(filePath, JSON.stringify(lesson, null, 2), 'utf8');
      console.log(`  ✅ ${quiz.map(q => q.domain).join(', ')}`);
      patched++;
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n🎉 Done — patched ${patched} lessons, skipped ${skipped} (already had domain)`);
}

main();
