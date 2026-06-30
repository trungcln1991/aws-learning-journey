'use strict';
// SM-2 Spaced Repetition Algorithm
// Reference: Piotr Wozniak, SuperMemo algorithm

const SRS_KEY = 'aws_srs_v1';

function getSRS() { try { return JSON.parse(localStorage.getItem(SRS_KEY)) || {}; } catch { return {}; } }
function saveSRS(d) { localStorage.setItem(SRS_KEY, JSON.stringify(d)); }

function todayStr() { return new Date().toISOString().slice(0, 10); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// quality: 0=total fail, 1=wrong, 2=wrong but easy, 3=correct hard, 4=correct, 5=perfect
export function sm2Update(cardId, quality) {
  const db = getSRS();
  const card = db[cardId] || { ef: 2.5, interval: 0, reps: 0, due: todayStr(), totalReviews: 0, correctCount: 0 };

  card.totalReviews = (card.totalReviews || 0) + 1;
  if (quality >= 3) {
    card.correctCount = (card.correctCount || 0) + 1;
    if (card.reps === 0) card.interval = 1;
    else if (card.reps === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.ef);
    card.ef = Math.max(1.3, card.ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    card.reps++;
  } else {
    card.reps = 0;
    card.interval = 1;
  }
  card.due = addDays(todayStr(), card.interval);
  card.lastReviewed = todayStr();
  db[cardId] = card;
  saveSRS(db);
  return card;
}

export function getCardsDueToday() {
  const db = getSRS();
  const today = todayStr();
  return Object.entries(db)
    .filter(([, card]) => card.due <= today)
    .map(([id, card]) => ({ id, ...card }));
}

export function getCardStats() {
  const db = getSRS();
  const today = todayStr();
  const cards = Object.values(db);
  return {
    total: cards.length,
    dueToday: cards.filter(c => c.due <= today).length,
    mature: cards.filter(c => c.interval >= 21).length,
    young: cards.filter(c => c.interval > 0 && c.interval < 21).length,
    new: cards.filter(c => c.reps === 0).length,
  };
}

export function getCardId(word, lessonDate) {
  return `${lessonDate}__${word}`;
}

export function initCard(word, lessonDate) {
  const id = getCardId(word, lessonDate);
  const db = getSRS();
  if (!db[id]) {
    db[id] = { ef: 2.5, interval: 0, reps: 0, due: todayStr(), totalReviews: 0, correctCount: 0 };
    saveSRS(db);
  }
  return id;
}
