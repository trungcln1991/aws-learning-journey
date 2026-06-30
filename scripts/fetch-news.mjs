#!/usr/bin/env node
/**
 * Fetch AWS news from official RSS feeds → generate news.json
 * Sources: AWS What's New · AWS Security Bulletins · AWS Blog · AWS Status
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

const FEEDS = [
  {
    key: 'whats_new',
    label: 'Services Mới & Cập Nhật',
    icon: '🆕',
    color: '#1C7A47',
    url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
    max: 25
  },
  {
    key: 'security',
    label: 'Security Bulletins',
    icon: '🔒',
    color: '#C32D1A',
    url: 'https://aws.amazon.com/security/security-bulletins/feed/',
    max: 10
  },
  {
    key: 'blog',
    label: 'AWS Blog',
    icon: '📝',
    color: '#1F5F86',
    url: 'https://aws.amazon.com/blogs/aws/feed/',
    max: 10
  }
];

// AWS service name extraction from title
const SERVICE_TAGS = {
  'EC2': ['ec2', 'instance', 'elastic compute'],
  'S3': ['s3', 'simple storage', 'bucket'],
  'RDS': ['rds', 'relational database', 'aurora', 'mysql', 'postgres'],
  'Lambda': ['lambda', 'serverless', 'function'],
  'VPC': ['vpc', 'virtual private cloud', 'subnet'],
  'IAM': ['iam', 'identity', 'access management', 'permission'],
  'CloudWatch': ['cloudwatch', 'monitoring', 'metrics', 'alarm'],
  'ECS': ['ecs', 'container', 'fargate', 'docker'],
  'Route 53': ['route 53', 'route53', 'dns'],
  'CloudFront': ['cloudfront', 'cdn', 'distribution'],
  'ALB': ['load balancer', 'alb', 'elb', 'nlb'],
  'WAF': ['waf', 'web application firewall'],
  'SQS': ['sqs', 'simple queue'],
  'SNS': ['sns', 'simple notification'],
  'DynamoDB': ['dynamodb', 'dynamo'],
  'KMS': ['kms', 'key management'],
  'CloudTrail': ['cloudtrail', 'trail', 'audit'],
  'Organizations': ['organizations', 'control tower', 'scp'],
  'TGW': ['transit gateway', 'tgw'],
  'EKS': ['eks', 'kubernetes', 'k8s'],
  'Bedrock': ['bedrock', 'generative ai', 'llm', 'foundation model'],
  'SageMaker': ['sagemaker', 'machine learning', 'ml'],
  'Security Hub': ['security hub', 'finding', 'compliance'],
  'Inspector': ['inspector', 'vulnerability', 'cve'],
  'Cost': ['cost', 'billing', 'savings plan', 'reserved'],
};

function extractTags(text) {
  const lower = text.toLowerCase();
  return Object.entries(SERVICE_TAGS)
    .filter(([, keywords]) => keywords.some(k => lower.includes(k)))
    .map(([tag]) => tag)
    .slice(0, 3);
}

function extractCDATA(str) {
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : str.trim();
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  let text = extractCDATA(m[1]);
  // Decode HTML entities first (RSS may encode < as &lt;), then strip tags
  text = text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

function getLinkFromItem(xml) {
  // <link> in RSS sometimes has weird encoding or comes after CDATA
  const m = xml.match(/<link>(.*?)<\/link>/i)
    || xml.match(/<link\s+rel="alternate"\s+href="([^"]+)"/i);
  return m ? m[1].trim() : '';
}

function parseDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return dateStr;
  }
}

function parseRSS(xml, maxItems) {
  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = regex.exec(xml)) !== null && items.length < maxItems) {
    const raw = m[1];
    const title = getTag(raw, 'title');
    const link = getLinkFromItem(raw) || getTag(raw, 'guid');
    const date = parseDate(getTag(raw, 'pubDate') || getTag(raw, 'dc:date'));
    const description = getTag(raw, 'description').slice(0, 400);
    const tags = extractTags(title + ' ' + description);
    if (title) items.push({ title, link, date, description, tags });
  }
  return items;
}

async function fetchFeed(feed) {
  console.log(`  Fetching: ${feed.url}`);
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'AWS-Learning-App/1.0 (github.com/trungcln1991/aws-learning-journey)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRSS(xml, feed.max);
    console.log(`  ✅ ${feed.key}: ${items.length} items`);
    return items;
  } catch (err) {
    console.error(`  ❌ ${feed.key}: ${err.message}`);
    return [];
  }
}

// Fetch AWS Service Health (status.aws.amazon.com JSON)
async function fetchStatus() {
  console.log('  Fetching: AWS Service Health Dashboard');
  try {
    const res = await fetch('https://health.aws.amazon.com/health/status', {
      signal: AbortSignal.timeout(10000)
    });
    // AWS status page returns HTML; fall back to checking RSS
    const rssRes = await fetch('https://status.aws.amazon.com/rss/all.rss', {
      signal: AbortSignal.timeout(10000)
    });
    if (!rssRes.ok) return { overall: 'unknown', incidents: [] };
    const xml = await rssRes.text();
    const items = parseRSS(xml, 10);
    const hasIssue = items.some(i =>
      i.title.toLowerCase().includes('issue') ||
      i.title.toLowerCase().includes('error') ||
      i.title.toLowerCase().includes('degraded')
    );
    return {
      overall: hasIssue ? 'issues' : 'operational',
      incidents: items.slice(0, 5)
    };
  } catch {
    return { overall: 'unknown', incidents: [] };
  }
}

// ===== BATCH TRANSLATION via Claude Haiku =====
async function translateAllItems(allItems) {
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    console.log('  ℹ️ No ANTHROPIC_API_KEY — skipping Vietnamese translation');
    return;
  }

  const items = allItems.filter(i => i.description && i.description.trim());
  if (!items.length) return;

  console.log(`\n🌐 Translating ${items.length} descriptions to Vietnamese (1 batch call)...`);

  // Build numbered list for the prompt
  const numbered = items.map((item, i) =>
    `[${i}] ${item.title} — ${item.description.slice(0, 180)}`
  ).join('\n');

  const prompt = `Translate these AWS news summaries from English to Vietnamese. Rules:
- Keep AWS service names in English (EC2, S3, Lambda, VPC, IAM, RDS, CloudWatch, etc.)
- Keep version numbers and technical codes as-is
- Be concise, natural Vietnamese — write like a tech news reader, not like Google Translate
- Return ONLY a JSON array of strings in the same order as input, no markdown fences

${numbered}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw = data.content[0].text.trim()
      .replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const translations = JSON.parse(raw);

    if (!Array.isArray(translations)) throw new Error('Response is not an array');
    items.forEach((item, i) => {
      if (translations[i] && typeof translations[i] === 'string') {
        item.description_vi = translations[i];
      }
    });
    console.log(`  ✅ Translated ${translations.filter(Boolean).length}/${items.length} items`);
  } catch (err) {
    console.error(`  ⚠️ Translation failed: ${err.message} — items will show English only`);
  }
}

async function main() {
  console.log('🔍 Fetching AWS news feeds...\n');

  const results = {};
  for (const feed of FEEDS) {
    results[feed.key] = await fetchFeed(feed);
    await new Promise(r => setTimeout(r, 500)); // polite delay
  }

  const status = await fetchStatus();

  // Batch translate all descriptions to Vietnamese
  const allItems = [
    ...(results.whats_new || []),
    ...(results.security || []),
    ...(results.blog || [])
  ];
  await translateAllItems(allItems);

  // Build news.json
  const news = {
    generated_at: new Date().toISOString(),
    feeds: FEEDS.map(f => ({
      key: f.key, label: f.label, icon: f.icon, color: f.color,
      count: results[f.key].length
    })),
    whats_new: results.whats_new || [],
    security: results.security || [],
    blog: results.blog || [],
    status
  };

  const outPath = resolve(root, 'news.json');
  writeFileSync(outPath, JSON.stringify(news, null, 2), 'utf8');
  console.log(`\n✅ Generated news.json (${news.whats_new.length} updates, ${news.security.length} security, ${news.blog.length} blog)`);
}

main().catch(err => { console.error(err); process.exit(1); });
