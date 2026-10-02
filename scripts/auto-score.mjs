#!/usr/bin/env node
// Auto score entry for Draft the Stars.
// Pulls per-judge scores from the Wikipedia season article, drops guest judges,
// maps couples to data/season.json ids, validates, and merges into data/scores.json
// WITHOUT silently overwriting anything. See README "Auto scoring".
//
// Usage: node scripts/auto-score.mjs [--dry-run] [--accept-changes] [--allow-partial]
//                                    [--wikitext-file path] [--data-dir data] [--only-week N]
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY_RUN = flag('dry-run') || process.env.DRY_RUN === 'true';
const ACCEPT_CHANGES = flag('accept-changes');
const DATA_DIR = opt('data-dir', 'data');
const CONFIG_PATH = opt('config', 'config/auto-score.json');
const ONLY_WEEK = opt('only-week') ? Number(opt('only-week')) : null;

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const ALLOW_PARTIAL = flag('allow-partial') || config.requireCompleteWeek === false;
const season = JSON.parse(readFileSync(join(DATA_DIR, 'season.json'), 'utf8'));
const scoresPath = join(DATA_DIR, 'scores.json');
const scoresRaw = readFileSync(scoresPath, 'utf8');
const existing = JSON.parse(scoresRaw);

const report = { flags: [], conflicts: [], applied: [], unchanged: 0, info: [] };
const flagIssue = (week, msg) => report.flags.push(`Week ${week ?? '?'}: ${msg}`);

// ---------- wikitext helpers ----------
export function norm(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripRefs(s) {
  return s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

// Resolve templates innermost-first.
function expandTemplates(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const parts = body.split('|');
      const name = parts[0].trim().toLowerCase();
      if (['nowrap', 'small', 'nobold', 'center', 'big', 'abbr'].includes(name)) return parts[1] ?? '';
      if (name === 'sortname') return `${parts[1] ?? ''} ${parts[2] ?? ''}`.trim();
      if (name === 'fontcolor') return parts[2] ?? '';
      return ''; // efn, dagger, double-dagger, TBA, refn, etc.
    });
  } while (s !== prev);
  return s;
}

function clean(s) {
  s = expandTemplates(stripRefs(s));
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  s = s.replace(/'''?/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  return s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Split "attrs | content" at first depth-0 pipe.
function splitCell(raw) {
  let depthC = 0, depthL = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const two = raw.slice(i, i + 2);
    if (two === '{{') { depthC += 1; i += 1; continue; }
    if (two === '}}') { depthC -= 1; i += 1; continue; }
    if (two === '[[') { depthL += 1; i += 1; continue; }
    if (two === ']]') { depthL -= 1; i += 1; continue; }
    if (raw[i] === '|' && depthC === 0 && depthL === 0) {
      const attrs = raw.slice(0, i);
      if (/=/.test(attrs) || attrs.trim() === '') return { attrs, content: raw.slice(i + 1) };
      return { attrs: '', content: raw };
    }
  }
  return { attrs: '', content: raw };
}

function splitInline(line, sep) {
  // split on || or !! at depth 0
  const out = []; let cur = ''; let dC = 0, dL = 0;
  for (let i = 0; i < line.length; i += 1) {
    const two = line.slice(i, i + 2);
    if (two === '{{') dC += 1; if (two === '}}') dC -= 1;
    if (two === '[[') dL += 1; if (two === ']]') dL -= 1;
    if (two === sep && dC <= 0 && dL <= 0) { out.push(cur); cur = ''; i += 1; continue; }
    cur += line[i];
  }
  out.push(cur);
  return out;
}

// Parse one wikitable into { headers: [], rows: [[{text, header}]] } with rowspans resolved.
export function parseTable(src) {
  const lines = src.split('\n');
  const rawRows = []; let row = null; let caption = '';
  const pushCell = (cellRaw, header) => {
    const { attrs, content } = splitCell(cellRaw);
    const rs = Number((attrs.match(/rowspan\s*=\s*"?(\d+)/i) || [])[1] || 1);
    const cs = Number((attrs.match(/colspan\s*=\s*"?(\d+)/i) || [])[1] || 1);
    if (!row) { row = []; rawRows.push(row); }
    row.push({ raw: content, text: clean(content), header, rowspan: rs, colspan: cs, scopeRow: /scope\s*=\s*"?row/i.test(attrs) });
  };
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    if (line.startsWith('{|') || line.startsWith('|}')) continue;
    if (line.startsWith('|+')) { caption = clean(line.slice(2)); continue; }
    if (line.startsWith('|-')) { row = null; continue; }
    // continuation lines (multi-line cell content)
    while (i + 1 < lines.length && !/^[|!{]/.test(lines[i + 1])) { line += '\n' + lines[i + 1]; i += 1; }
    if (line.startsWith('!')) splitInline(line.slice(1), '!!').forEach((c) => pushCell(c, true));
    else if (line.startsWith('|')) splitInline(line.slice(1), '||').forEach((c) => pushCell(c, false));
  }
  // resolve rowspans into a grid
  const grid = []; const pending = [];
  for (const r of rawRows) {
    const out = []; let col = 0; const queue = [...r];
    while (queue.length || pending.some((p, idx) => p && p.left > 0 && idx >= col)) {
      if (pending[col] && pending[col].left > 0) { out[col] = pending[col].cell; pending[col].left -= 1; col += 1; continue; }
      const cell = queue.shift();
      if (!cell) break;
      for (let k = 0; k < cell.colspan; k += 1) {
        out[col] = cell;
        if (cell.rowspan > 1) pending[col] = { cell, left: cell.rowspan - 1 };
        col += 1;
      }
    }
    grid.push(out);
  }
  const headerRow = grid.find((r) => r.every((c) => c && c.header && !c.scopeRow)) || [];
  const headers = headerRow.map((c) => norm(c.text));
  const rows = grid.filter((r) => r !== headerRow && r.some((c) => c && !c.header || c?.scopeRow));
  return { caption, headers, rows };
}

export function parseJudgeOrder(text) {
  const m = text.match(/listed in this order from left to right:\s*([\s\S]*?)\.?''/i);
  if (!m) return null;
  return clean(m[1]).replace(/\band\b/g, ',').split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseScoreCell(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || /^(—|–|-|n\/a|tba)$/i.test(t)) return { empty: true };
  if (/^\+?\d{1,2}$/.test(t)) return { bonus: Number(t.replace('+', '')) };
  const m = t.match(/^(\d{1,2})\s*\(\s*([\d\s,]+?)\s*\)\s*$/);
  if (!m) return { error: `unrecognised score cell "${t}"` };
  return { total: Number(m[1]), judges: m[2].split(',').map((x) => Number(x.trim())) };
}

export function extractWeeks(wikitext) {
  const start = wikitext.search(/^==\s*Weekly scores\s*==\s*$/m);
  if (start < 0) throw new Error('No "Weekly scores" section found');
  const after = stripRefs(wikitext.slice(start)).replace(/<!--[\s\S]*?-->/g, '');
  const endRel = after.slice(3).search(/^==[^=].*==\s*$/m);
  const section = endRel >= 0 ? after.slice(0, endRel + 3) : after;
  const globalOrder = parseJudgeOrder(section.split(/^===/m)[0]);
  const parts = section.split(/^(?====\s*Week)/m).slice(1);
  return parts.map((part) => {
    const heading = part.match(/^===\s*Week\s*(\d+)\s*:?\s*(.*?)\s*===/);
    const week = Number(heading?.[1]);
    const label = clean(heading?.[2] || '');
    const body = part.replace(/^===.*===\s*$/m, '');
    const firstTable = body.indexOf('{|');
    const order = parseJudgeOrder(firstTable >= 0 ? body.slice(0, firstTable) : body) || globalOrder;
    const tables = [];
    const re = /^\{\|[\s\S]*?^\|\}/gm; let m;
    while ((m = re.exec(body))) tables.push(parseTable(m[0]));
    return { week, label, order, tables, orderIsWeekSpecific: order !== globalOrder };
  }).filter((w) => w.week);
}

// ---------- name mapping ----------
function buildMatcher() {
  const couples = season.couples.map((c) => ({
    id: c.id,
    amFirst: norm(c.amateur.name).split(' ')[0],
    amLast: norm(c.amateur.name).split(' ').slice(1).join(' '),
    amFull: norm(c.amateur.name),
    proFirst: norm(c.pro.name).split(' ')[0],
    proFull: norm(c.pro.name)
  }));
  const multiWord = couples.map((c) => c.amFull);
  return (label) => {
    if (config.aliases?.[label]) return { id: config.aliases[label], how: 'alias' };
    const [left, right] = label.split(/\s*&\s*/);
    if (!left || !right) return { error: `cannot split couple label "${label}"` };
    const L = norm(left); const R = norm(right);
    const tokens = L.split(' ');
    const candidates = couples.filter((c) => {
      const proOk = R === c.proFirst || R === c.proFull;
      if (!proOk) return false;
      if (L === c.amFull || L === c.amFirst) return true;
      // "Conner L." -> first name + last initial
      if (tokens.length === 2 && tokens[0] === c.amFirst && tokens[1].length === 1) return c.amLast.startsWith(tokens[1]);
      // "Sarah Jane" (multi-word first name)
      return c.amFull.startsWith(L + ' ') && multiWord.filter((n) => n.startsWith(L + ' ')).length === 1;
    });
    if (candidates.length === 1) return { id: candidates[0].id, how: 'name' };
    return { error: `${candidates.length ? 'ambiguous' : 'unknown'} couple "${label}"${candidates.length ? ` (${candidates.map((c) => c.id).join(', ')})` : ''}` };
  };
}

// ---------- build proposed weeks ----------
function permanentIndexes(order) {
  const perm = config.permanentJudges.map(norm);
  const idx = []; const guests = [];
  order.forEach((name, i) => {
    const n = norm(name.replace(/guest judge/i, ''));
    if (perm.includes(n)) idx.push(i); else guests.push(name);
  });
  return { idx, guests, missing: perm.filter((p) => !order.map((o) => norm(o)).includes(p)) };
}

function buildProposals(weeks) {
  const match = buildMatcher();
  const [lo, hi] = config.judgeScoreRange;
  const proposals = [];
  for (const w of weeks) {
    if (ONLY_WEEK && w.week !== ONLY_WEEK) continue;
    if (!w.order) { flagIssue(w.week, 'no judge order line found; skipped'); continue; }
    const { idx, guests, missing } = permanentIndexes(w.order);
    if (missing.length) { flagIssue(w.week, `permanent judge(s) absent from order: ${missing.join(', ')} — week skipped (needs a decision)`); continue; }
    if (idx.length !== config.permanentJudges.length) { flagIssue(w.week, `expected ${config.permanentJudges.length} permanent judges, found ${idx.length}`); continue; }
    const byCouple = new Map(); let sawTable = false; let empty = 0; let invalid = false;
    for (const t of w.tables) {
      const coupleCol = t.headers.findIndex((h) => h === 'couple');
      const scoreCol = t.headers.findIndex((h) => h.startsWith('score'));
      const resultCol = t.headers.findIndex((h) => h.startsWith('result'));
      if (coupleCol !== 0 || scoreCol < 0) { if (t.headers.length) report.info.push(`Week ${w.week}: ignored non-couple table "${t.caption}" (team dance/bonus/other)`); continue; }
      const cells = t.rows.map((r) => (r[scoreCol]?.text || '').trim()).filter(Boolean);
      if (cells.length && cells.every((c) => /^\+?\d{1,2}$/.test(c)) || /marathon|bonus|dance-off|team/i.test(t.caption)) {
        report.info.push(`Week ${w.week}: ignored bonus/team table "${t.caption}" (bonus points are never counted)`); continue;
      }
      sawTable = true;
      for (const r of t.rows) {
        const label = r[coupleCol]?.text; if (!label) continue;
        if ((label.match(/&/g) || []).length !== 1) { report.info.push(`Week ${w.week}: ignored group/team row "${label.slice(0, 60)}"`); continue; }
        const m = match(label);
        if (m.error) { flagIssue(w.week, m.error + ' — NOT guessed, couple skipped'); invalid = true; continue; }
        const entry = byCouple.get(m.id) || { coupleId: m.id, label, dances: [], resultText: '' };
        const sc = parseScoreCell(r[scoreCol]?.text || '');
        if (sc.bonus !== undefined) { report.info.push(`Week ${w.week}: ${label} bonus ${sc.bonus} ignored (bonus points are not counted)`); byCouple.set(m.id, entry); continue; }
        if (sc.empty) { empty += 1; entry.pending = true; }
        else if (sc.error) { flagIssue(w.week, `${label}: ${sc.error}`); invalid = true; entry.bad = true; }
        else {
          const problems = [];
          if (sc.judges.length !== w.order.length) problems.push(`${sc.judges.length} judge scores but ${w.order.length} judges listed`);
          if (sc.judges.some((j) => !Number.isInteger(j) || j < lo || j > hi)) problems.push(`judge score outside ${lo}-${hi}`);
          if (sc.judges.reduce((a, b) => a + b, 0) !== sc.total) problems.push(`listed total ${sc.total} != sum of judges`);
          if (problems.length) { flagIssue(w.week, `${label}: ${problems.join('; ')}`); entry.bad = true; invalid = true; }
          else {
            const perm = idx.reduce((s, i) => s + sc.judges[i], 0);
            entry.dances.push({ total: sc.total, judges: sc.judges, permanentTotal: perm, guestScores: sc.judges.filter((_, i) => !idx.includes(i)) });
          }
        }
        const res = r[resultCol]?.text || '';
        if (res) entry.resultText = res;
        byCouple.set(m.id, entry);
      }
    }
    if (!sawTable) { report.info.push(`Week ${w.week}: no score table yet`); continue; }
    const results = [];
    for (const c of season.couples) {
      const e = byCouple.get(c.id); if (!e || e.bad || e.pending || !e.dances.length) continue;
      let score;
      if (e.dances.length === 1) score = e.dances[0].permanentTotal;
      else if (config.multiDancePolicy === 'average') score = e.dances.reduce((s, d) => s + d.permanentTotal, 0) / e.dances.length;
      else if (config.multiDancePolicy === 'sum') score = e.dances.reduce((s, d) => s + d.permanentTotal, 0);
      else if (config.multiDancePolicy === 'first') score = e.dances[0].permanentTotal;
      else { flagIssue(w.week, `${e.label}: ${e.dances.length} judged dances; multiDancePolicy="flag" so it was skipped (Zach to decide)`); invalid = true; continue; }
      if (score > config.maxScore || score < 0) { flagIssue(w.week, `${e.label}: computed ${score} outside 0-${config.maxScore}`); invalid = true; continue; }
      if (/withdr|quit|left/i.test(e.resultText)) flagIssue(w.week, `${e.label}: result "${e.resultText}" — marked eliminated, please review`);
      results.push({ coupleId: c.id, score, eliminated: /eliminat|withdr|quit/i.test(e.resultText), _guest: e.dances.flatMap((d) => d.guestScores), _raw: e.dances.map((d) => `${d.total} (${d.judges.join(', ')})`) });
    }
    if (!results.length) { report.info.push(`Week ${w.week}: no scores posted yet`); continue; }
    if ((empty || invalid) && !ALLOW_PARTIAL) { flagIssue(w.week, `incomplete (${empty} unscored, ${invalid ? 'some invalid' : 'none invalid'}) — week not written (use --allow-partial to override)`); continue; }
    proposals.push({ week: w.week, label: w.label, guests: permanentIndexes(w.order).guests, results });
  }
  return proposals;
}

// ---------- merge without silent overwrites ----------
function merge(proposals) {
  const next = JSON.parse(scoresRaw);
  next.weeks = Array.isArray(next.weeks) ? next.weeks : [];
  let changed = false;
  for (const p of proposals) {
    let wk = next.weeks.find((w) => Number(w.week) === p.week);
    const guestNote = p.guests.length ? ` (guest judge dropped: ${p.guests.join(', ')})` : '';
    if (!wk) {
      wk = { week: p.week, label: p.label, maxScore: config.maxScore, results: [] };
      next.weeks.push(wk);
      report.applied.push(`Week ${p.week}: NEW week "${p.label}" with ${p.results.length} couples${guestNote}`);
    }
    for (const r of p.results) {
      const cur = (wk.results || []).find((x) => x.coupleId === r.coupleId);
      const clean = { coupleId: r.coupleId, score: r.score, eliminated: r.eliminated };
      if (!cur) {
        wk.results.push(clean); changed = true;
        report.applied.push(`Week ${p.week} ${r.coupleId}: +score ${r.score}${r.eliminated ? ' (eliminated)' : ''} from ${r._raw.join(' / ')}${r._guest.length ? ` guest ${r._guest.join('/')} dropped` : ''}`);
        continue;
      }
      if (Number(cur.score) !== r.score) {
        const msg = `Week ${p.week} ${r.coupleId}: existing score ${cur.score} vs source ${r.score} (${r._raw.join(' / ')})`;
        if (ACCEPT_CHANGES) { cur.score = r.score; changed = true; report.applied.push(`CHANGED ${msg}`); }
        else report.conflicts.push(`${msg} — kept existing`);
      } else report.unchanged += 1;
      if (Boolean(cur.eliminated) !== r.eliminated) {
        const msg = `Week ${p.week} ${r.coupleId}: eliminated ${Boolean(cur.eliminated)} -> ${r.eliminated}`;
        if (!cur.eliminated && r.eliminated) { cur.eliminated = true; changed = true; report.applied.push(msg); }
        else if (ACCEPT_CHANGES) { cur.eliminated = r.eliminated; changed = true; report.applied.push(`CHANGED ${msg}`); }
        else report.conflicts.push(`${msg} — kept existing`);
      }
    }
    // keep results in season order, matching the hand-entered files
    const order = season.couples.map((c) => c.id);
    wk.results.sort((a, b) => order.indexOf(a.coupleId) - order.indexOf(b.coupleId));
  }
  next.weeks.sort((a, b) => b.week - a.week); // newest first, as in the existing file
  return { next, changed };
}

async function loadWikitext() {
  const file = opt('wikitext-file');
  if (file) return { wikitext: readFileSync(file, 'utf8'), revid: 'file:' + file };
  const title = config.wikipediaTitle;
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext%7Crevid&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'user-agent': 'DraftTheStars-autoscore/1.0 (https://github.com/ZacheryTaylor/dwts-draft)' } });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Wikipedia: ${json.error.info}`);
  return { wikitext: json.parse.wikitext, revid: json.parse.revid, url: `https://en.wikipedia.org/w/index.php?oldid=${json.parse.revid}` };
}

async function main() {
  const { wikitext, revid, url } = await loadWikitext();
  const weeks = extractWeeks(wikitext);
  const proposals = buildProposals(weeks);
  const { next, changed } = merge(proposals);

  const lines = [
    `# Auto score ${DRY_RUN ? '(DRY RUN)' : ''}`,
    `Source: Wikipedia revision ${revid}${url ? ` ${url}` : ''}`,
    `Permanent judges kept: ${config.permanentJudges.join(', ')}; guests dropped automatically.`,
    `Weeks in source: ${weeks.map((w) => w.week).join(', ') || 'none'}; weeks with usable scores: ${proposals.map((p) => p.week).join(', ') || 'none'}`,
    `Unchanged couple-weeks (match existing data): ${report.unchanged}`,
    `Applied: ${report.applied.length}`, ...report.applied.map((x) => `  + ${x}`),
    `Conflicts (NOT applied): ${report.conflicts.length}`, ...report.conflicts.map((x) => `  ! ${x}`),
    `Flags: ${report.flags.length}`, ...report.flags.map((x) => `  ? ${x}`),
    ...report.info.map((x) => `  i ${x}`)
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  if (opt('report-json')) writeFileSync(opt('report-json'), JSON.stringify({ revid, proposals, report }, null, 2));

  if (changed && !DRY_RUN) {
    if (!ACCEPT_CHANGES && report.conflicts.length && !report.applied.length) { /* nothing to write */ }
    else {
      writeFileSync(scoresPath, JSON.stringify(next, null, 2) + '\n');
      const logPath = join(DATA_DIR, 'auto-score-log.json');
      const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : [];
      log.push({ runAt: new Date().toISOString(), revid, applied: report.applied, conflicts: report.conflicts, flags: report.flags });
      writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
      console.log(`Wrote ${scoresPath}`);
    }
  } else console.log(DRY_RUN ? 'Dry run: nothing written.' : 'No changes to write.');
  if (report.conflicts.length) process.exitCode = 2;
  else if (report.flags.length && process.env.FAIL_ON_FLAGS === 'true') process.exitCode = 3;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`auto-score failed: ${err.message}`); process.exitCode = 1; });
}
