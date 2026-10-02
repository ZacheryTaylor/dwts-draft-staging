// Offline tests for scripts/auto-score.mjs. Run: node tests/test-auto-score.mjs
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTable, norm } from '../scripts/auto-score.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass += 1; console.log('  ok  ', msg); } else { fail += 1; console.log('  FAIL', msg); } };
const run = (dir, extra = [], cfg = 'config/auto-score.json') => {
  try {
    const out = execFileSync('node', ['scripts/auto-score.mjs', '--data-dir', dir, '--config', cfg, '--report-json', join(dir, 'report.json'), ...extra], { encoding: 'utf8' });
    return { code: 0, out, rep: JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) };
  } catch (e) { return { code: e.status, out: e.stdout, rep: existsSync(join(dir, 'report.json')) ? JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) : null }; }
};
const tmp = () => mkdtempSync(join(tmpdir(), 'autoscore-'));

// ---- 1. Season 35 (current) against the real backed-up data: every overlap must match.
{
  console.log('Season 35 vs existing data/scores.json');
  const d = tmp(); ['season.json', 'scores.json'].forEach((f) => copyFileSync(join('data', f), join(d, f)));
  const before = readFileSync(join(d, 'scores.json'), 'utf8');
  const r = run(d, ['--wikitext-file', 'tests/fixtures/season35-rev1377959004.wikitext']);
  ok(r.code === 0, 'exit 0, no conflicts');
  ok(r.rep.report.conflicts.length === 0 && r.rep.report.flags.length === 0, 'no conflicts, no flags');
  ok(r.rep.report.unchanged === 43, `43/43 couple-weeks identical (got ${r.rep.report.unchanged})`);
  ok(readFileSync(join(d, 'scores.json'), 'utf8') === before, 'scores.json byte-identical (nothing rewritten)');
}

// ---- 2. Dry run on empty data writes nothing; real run rebuilds weeks 1-3 exactly.
{
  console.log('Rebuild season 35 from scratch');
  const d = tmp(); copyFileSync('data/season.json', join(d, 'season.json'));
  writeFileSync(join(d, 'scores.json'), JSON.stringify({ source: 'test', updatedAt: null, weeks: [] }));
  run(d, ['--wikitext-file', 'tests/fixtures/season35-rev1377959004.wikitext', '--dry-run']);
  ok(JSON.parse(readFileSync(join(d, 'scores.json'), 'utf8')).weeks.length === 0, 'dry run wrote nothing');
  run(d, ['--wikitext-file', 'tests/fixtures/season35-rev1377959004.wikitext']);
  const built = JSON.parse(readFileSync(join(d, 'scores.json'), 'utf8'));
  const orig = JSON.parse(readFileSync('data/scores.json', 'utf8'));
  const strip = (s) => s.weeks.map((w) => ({ week: w.week, maxScore: w.maxScore, results: w.results }));
  ok(JSON.stringify(strip(built)) === JSON.stringify(strip(orig)), 'auto-built weeks/results/order identical to hand-entered data');
  ok(existsSync(join(d, 'auto-score-log.json')), 'audit log written');
}

// ---- 3. Conflict: an existing score that differs is NOT overwritten, exit code 2.
{
  console.log('Conflict protection');
  const d = tmp(); ['season.json', 'scores.json'].forEach((f) => copyFileSync(join('data', f), join(d, f)));
  const s = JSON.parse(readFileSync(join(d, 'scores.json'), 'utf8'));
  s.weeks.find((w) => w.week === 2).results.find((x) => x.coupleId === 'carson').score = 13;
  writeFileSync(join(d, 'scores.json'), JSON.stringify(s, null, 2));
  const before = readFileSync(join(d, 'scores.json'), 'utf8');
  const r = run(d, ['--wikitext-file', 'tests/fixtures/season35-rev1377959004.wikitext']);
  ok(r.code === 2, 'exit code 2 on conflict');
  ok(r.rep.report.conflicts.some((c) => /carson: existing score 13 vs source 12/.test(c)), 'diff logged: carson 13 vs 12');
  ok(readFileSync(join(d, 'scores.json'), 'utf8') === before, 'existing score kept (file untouched)');
}

// ---- 4. Unknown names are flagged, not guessed.
{
  console.log('Unknown name');
  const d = tmp(); ['season.json', 'scores.json'].forEach((f) => copyFileSync(join('data', f), join(d, f)));
  const wt = readFileSync('tests/fixtures/season35-rev1377959004.wikitext', 'utf8').replace('! scope="row" | Guillermo & Witney\n| 15 (5, 5, 5)', '! scope="row" | Guillermo & Witnee\n| 15 (5, 5, 5)');
  writeFileSync(join(d, 'w.txt'), wt);
  const r = run(d, ['--wikitext-file', join(d, 'w.txt')]);
  ok(r.rep.report.flags.some((f) => /unknown couple "Guillermo & Witnee"/.test(f)), 'unknown couple flagged');
  ok(r.rep.report.flags.some((f) => /Week 3: incomplete/.test(f)), 'week with unknown name not written');
}

// ---- 5. Season 34 regression: guest judges, absent judge, multi-dance weeks, team/bonus tables.
{
  console.log('Season 34 regression (guest judges / multi-dance)');
  const wt = readFileSync('tests/fixtures/season34.wikitext', 'utf8');
  const castSrc = wt.match(/\{\|[^\n]*\n\|\+Cast of[\s\S]*?\n\|\}/)[0];
  const cast = parseTable(castSrc).rows.map((r) => ({ amateur: r[0].text, pro: r[2].text }));
  const season = { season: 34, couples: cast.map((c, i) => ({ id: `c${i}`, amateur: { id: `a${i}`, name: c.amateur }, pro: { id: `p${i}`, name: c.pro } })) };
  const d = tmp(); writeFileSync(join(d, 'season.json'), JSON.stringify(season));
  writeFileSync(join(d, 'scores.json'), JSON.stringify({ weeks: [] }));
  const r = run(d, ['--wikitext-file', 'tests/fixtures/season34.wikitext', '--allow-partial']);
  const rep = r.rep;
  ok(cast.length >= 14, `cast parsed (${cast.length} couples)`);
  ok(rep.report.flags.some((f) => /Week 1: permanent judge\(s\) absent/.test(f)), 'week 1 (only 2 judges) flagged, not written');
  ok(!rep.report.flags.some((f) => /unknown couple|ambiguous/.test(f)), 'every couple label mapped ' + rep.report.flags.filter((f) => /unknown|ambiguous/.test(f)).join(' | '));
  const w5 = rep.proposals.find((p) => p.week === 5);
  ok(w5 && w5.guests.join() === 'Kym Johnson', 'week 5 guest judge detected (Kym Johnson)');
  // independent cross-check against the article's own "Scoring chart" table
  const chartSrc = wt.match(/\{\|[^\n]*\n\|\+''Dancing with the Stars'' \(season 34\) - Weekly scores[\s\S]*?\n\|\}/)?.[0]
    || wt.slice(wt.indexOf('== Scoring chart ==')).match(/\{\|[\s\S]*?\n\|\}/)[0];
  const chart = parseTable(chartSrc);
  // week labels come from the chart's 2nd header row (S34 has combined columns such as "1+2")
  const labelRow = chartSrc.split('\n|-\n')[1].split('\n').filter((l) => l.startsWith('!')).map((l) => l.slice(1).replace(/\{\{efn[^}]*\}\}/g, '').trim());
  const colFor = (week) => { const i = labelRow.indexOf(String(week)); return i < 0 ? -1 : i + 2; };
  let checked = 0, mismatched = [];
  for (const p of rep.proposals) {
    for (const res of p.results) {
      const c = season.couples.find((x) => x.id === res.coupleId);
      const row = chart.rows.find((rr) => {
        const lab = norm(rr[0]?.text || ''); return lab.startsWith(norm(c.amateur.name.split(' ')[0])) && lab.endsWith(norm(c.pro.name.split(' ')[0]));
      });
      const col = colFor(p.week); const cell = col > 0 ? row?.[col]?.text : null; if (!cell || !/^\d+/.test(cell)) continue;
      const chartTotal = Number(cell.match(/^\d+/)[0]);
      const expected = chartTotal - res._guest.reduce((a, b) => a + b, 0);
      checked += 1; if (expected !== res.score) mismatched.push(`wk${p.week} ${c.amateur.name}: ${res.score} vs chart ${chartTotal}`);
    }
  }
  ok(checked > 40 && mismatched.length === 0, `S34 permanent-judge totals agree with scoring chart minus guest (${checked} checked, ${mismatched.length} mismatches ${mismatched.slice(0, 3).join('; ')})`);
  ok(rep.report.flags.some((f) => /judged dances; multiDancePolicy="flag"/.test(f)), 'multi-dance weeks flagged under default policy');
  const allScores = rep.proposals.flatMap((p) => p.results.map((x) => x.score));
  ok(allScores.every((s) => s >= 3 && s <= 30), 'every written score within 3-30 after dropping guests');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
