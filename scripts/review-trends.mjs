#!/usr/bin/env node
/**
 * Review Trends — Dashboard de calidad de reviews para Artifact Studio
 *
 * Uso:
 *   node scripts/review-trends.mjs              ← últimos 10 reviews
 *   node scripts/review-trends.mjs --days=7     ← últimos 7 días
 *   node scripts/review-trends.mjs --issue=ODE-91  ← reviews de un issue
 *   node scripts/review-trends.mjs --avg         ← promedio por semana
 */

import { readReviewHistory } from './lib/workflow-ledger.mjs';

function loadHistory() {
  // Incluye los archivos rotados: las tendencias comparan contra el pasado, así
  // que rotar la ventana activa no debe amputar el histórico.
  const history = readReviewHistory({ includeArchive: true });
  if (history.length === 0) {
    console.error('No review history found. Run reviews first to generate workflow/review-history.jsonl');
    process.exit(1);
  }
  return history;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toISOString().slice(11, 16);
}

function scoreEmoji(score) {
  if (score >= 9) return '🟢';
  if (score >= 7) return '🟡';
  if (score >= 5) return '🟠';
  return '🔴';
}

function verdictLabel(v) {
  if (v === 'approved') return 'APPROVED';
  if (v === 'changes_requested') return 'CHANGES';
  if (v === 'rejected') return 'REJECTED';
  return v || 'UNKNOWN';
}

// ── Parse args ──
const args = process.argv.slice(2);
const daysFlag = args.find(a => a.startsWith('--days='));
const issueFlag = args.find(a => a.startsWith('--issue='));
const avgFlag = args.includes('--avg');
const limitFlag = args.find(a => a.startsWith('--limit='));

const days = daysFlag ? parseInt(daysFlag.split('=')[1]) : null;
const issueFilter = issueFlag ? issueFlag.split('=')[1] : null;
const limit = limitFlag ? parseInt(limitFlag.split('=')[1]) : 10;

const history = loadHistory();

// ── Filter ──
let filtered = history;
if (days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  filtered = filtered.filter(r => new Date(r.ts) >= cutoff);
}
if (issueFilter) {
  filtered = filtered.filter(r => r.issue === issueFilter);
}

if (filtered.length === 0) {
  console.log('No reviews match the criteria.');
  process.exit(0);
}

// ── Average mode ──
if (avgFlag) {
  const byWeek = {};
  for (const r of filtered) {
    const d = new Date(r.ts);
    const week = `${d.getFullYear()}-W${String(Math.ceil((d.getDate()) / 7)).padStart(2, '0')}`;
    byWeek[week] = byWeek[week] || { scores: [], count: 0, P0: 0, P1: 0 };
    byWeek[week].scores.push(r.score);
    byWeek[week].count++;
    byWeek[week].P0 += r.P0 || 0;
    byWeek[week].P1 += r.P1 || 0;
  }

  console.log('\n📊 REVIEW TRENDS BY WEEK');
  console.log('═'.repeat(60));
  console.log('Week         Reviews  Avg Score  P0   P1   Trend');
  console.log('─'.repeat(60));

  const weeks = Object.keys(byWeek).sort();
  let prevAvg = null;
  for (const w of weeks) {
    const { scores, count, P0, P1 } = byWeek[w];
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    let trend = '  ';
    if (prevAvg !== null) {
      const delta = avg - prevAvg;
      trend = delta >= 0 ? `↑ +${delta.toFixed(1)}` : `↓ ${delta.toFixed(1)}`;
    }
    console.log(`${w}    ${String(count).padStart(3)}      ${avg.toFixed(1).padStart(5)}    ${String(P0).padStart(2)}   ${String(P1).padStart(2)}   ${trend}`);
    prevAvg = avg;
  }
  console.log('');
  process.exit(0);
}

// ── Table mode ──
console.log('\n📋 REVIEW HISTORY');
console.log('═'.repeat(90));
console.log('Date        Time   Issue     Branch                     Score  P0 P1 P2 P3  Verdict');
console.log('─'.repeat(90));

const display = filtered.slice(-limit);
for (const r of display) {
  const date = formatDate(r.ts);
  const time = formatTime(r.ts);
  const issue = (r.issue || 'N/A').padEnd(8);
  const branch = (r.branch || 'unknown').slice(0, 25).padEnd(26);
  const score = String(r.score?.toFixed(1) || 'N/A').padStart(5);
  const P0 = String(r.P0 || 0).padStart(2);
  const P1 = String(r.P1 || 0).padStart(2);
  const P2 = String(r.P2 || 0).padStart(2);
  const P3 = String(r.P3 || 0).padStart(2);
  const verdict = verdictLabel(r.verdict).padEnd(10);
  console.log(`${date}  ${time}  ${issue} ${branch} ${score}  ${P0} ${P1} ${P2} ${P3}  ${verdict} ${scoreEmoji(r.score || 0)}`);
}

// ── Summary ──
const scores = filtered.map(r => r.score).filter(s => typeof s === 'number');
const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
const totalP0 = filtered.reduce((a, r) => a + (r.P0 || 0), 0);
const totalP1 = filtered.reduce((a, r) => a + (r.P1 || 0), 0);

console.log('─'.repeat(90));
console.log(`Total reviews: ${filtered.length}  |  Avg score: ${avg.toFixed(1)}  |  Total P0: ${totalP0}  |  Total P1: ${totalP1}`);

// ── Trend alert ──
if (scores.length >= 3) {
  const recent = scores.slice(-3);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const older = scores.slice(0, -3);
  const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
  const delta = recentAvg - olderAvg;

  if (delta < -0.5) {
    console.log(`\n🔴 TREND ALERT: Score promedio bajó ${Math.abs(delta).toFixed(1)} puntos en los últimos 3 reviews.`);
    console.log(`   Revisar: ¿más complejidad? ¿menos tests? ¿pressura de tiempo?`);
  } else if (delta > 0.5) {
    console.log(`\n🟢 TREND UP: Score promedio subió ${delta.toFixed(1)} puntos. Buen trabajo.`);
  }
}

console.log('');
