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
  const after = JSON.parse(readFileSync(join(d, 'scores.json'), 'utf8'));
  ok(JSON.stringify(after.weeks.map((w) => w.results)) === JSON.stringify(JSON.parse(before).weeks.map((w) => w.results)), 'every score/elimination unchanged');
  ok(r.rep.report.applied.every((a) => /added name/.test(a)) && after.weeks.every((w) => w.name), 'only possible change: week names backfilled (' + r.rep.report.applied.length + ' added; ' + after.weeks.map((w) => w.week + '=' + w.name).join(', ') + ')');
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
  ok(JSON.parse(readFileSync(join(d, 'scores.json'), 'utf8')).weeks.find((w) => w.week === 2).results.find((x) => x.coupleId === 'carson').score === 13, 'existing score kept (13, not overwritten)');
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
  const season = { season: 34, roundValues: [10, 12, 14, 16, 18, 20, 23, 26, 29, 32, 36], couples: cast.map((c, i) => ({ id: `c${i}`, amateur: { id: `a${i}`, name: c.amateur }, pro: { id: `p${i}`, name: c.pro } })) };
  const d = tmp(); writeFileSync(join(d, 'season.json'), JSON.stringify(season));
  writeFileSync(join(d, 'scores.json'), JSON.stringify({ weeks: [] }));
  const r = run(d, ['--wikitext-file', 'tests/fixtures/season34.wikitext', '--allow-partial']);
  const rep = r.rep;
  ok(cast.length >= 14, `cast parsed (${cast.length} couples)`);
  const w1 = rep.proposals.find((p) => p.week === 1);
  ok(w1 && w1.scaled && rep.report.info.some((i) => /Week 1: permanent judge absent/.test(i)), 'week 1 (Carrie Ann absent) scaled x30/20 instead of skipped');
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
      const col = colFor(p.week); const cell = col > 0 ? row?.[col]?.text : null; if (!cell || !/^\d+/.test(cell) || res._raw.length !== 1) continue;
      const chartTotal = Number(cell.match(/^\d+/)[0]);
      const expected = (chartTotal - res._guest.reduce((a, b) => a + b, 0)) * (p.scaled ? 30 / 20 : 1);
      checked += 1; if (expected !== res.score) mismatched.push(`wk${p.week} ${c.amateur.name}: ${res.score} vs chart ${chartTotal}`);
    }
  }
  ok(checked > 40 && mismatched.length === 0, `S34 permanent-judge totals agree with scoring chart minus guest (${checked} checked, ${mismatched.length} mismatches ${mismatched.slice(0, 3).join('; ')})`);
  const w10 = rep.proposals.find((p) => p.week === 10);
  ok(w10 && w10.results.every((r) => r._raw.length === 2) && rep.report.info.some((i) => /Week 10: .* averaged 2 dances/.test(i)), 'week 10 (two dances) averaged');
  const elaine = w10.results.find((r) => season.couples.find((c) => c.id === r.coupleId).amateur.name.startsWith('Elaine'));
  ok(elaine.score === 28.5, `S34 wk10 Elaine & Alan: (27 + 30) / 2 = 28.5 (got ${elaine?.score})`);
  ok(rep.proposals.some((p) => p.week === 11) && rep.report.flags.length === 0, `finale (3 dances) averaged; 0 flags for the whole S34 season ${rep.report.flags.join(' | ')}`);
  ok(rep.proposals.some((p) => p.week === 7) && rep.report.info.some((i) => /Week 7: .* bonus \d+ ignored/.test(i)), 'week 7 marathon bonus rows ignored, dance scores still used');
  ok(rep.proposals.some((p) => p.week === 9) && rep.report.info.some((i) => /Week 9: ignored non-couple table/.test(i)), 'week 9 team/relay table ignored');
  const allScores = rep.proposals.flatMap((p) => p.results.map((x) => x.score));
  ok(allScores.every((s) => s >= 3 && s <= 30), 'every written score within 3-30 after dropping guests');
}

// ---- 6. Simulated arrival of weeks 4-5 (absent judge, two dances, guest judge, withdrawal, bonus rows).
{
  console.log('Simulated weeks 4-5 (tests/fixtures/season35-sim-weeks4-5.wikitext)');
  const expected = JSON.parse(readFileSync('tests/fixtures/season35-sim-expected.json', 'utf8'));
  const d = tmp(); ['season.json', 'scores.json', 'league.json'].forEach((f) => copyFileSync(join('data', f), join(d, f)));
  const orig = JSON.parse(readFileSync('data/scores.json', 'utf8'));
  const r = run(d, ['--wikitext-file', 'tests/fixtures/season35-sim-weeks4-5.wikitext']);
  const out = JSON.parse(readFileSync(join(d, 'scores.json'), 'utf8'));
  ok(r.code === 0 && r.rep.report.conflicts.length === 0 && r.rep.report.flags.length === 0, 'exit 0, no conflicts, no flags');
  for (const wk of [4, 5]) {
    const w = out.weeks.find((x) => x.week === wk);
    ok(w && w.name === { 4: 'Mariah Carey Night', 5: 'Super Bowl Night' }[wk] && w.label === w.name && w.maxScore === 30, `week ${wk} created automatically with name "${w?.name}"`);
    const got = Object.fromEntries(w.results.map((x) => [x.coupleId, { score: x.score, eliminated: x.eliminated }]));
    ok(JSON.stringify(Object.keys(got).sort()) === JSON.stringify(Object.keys(expected[wk]).sort()) && Object.entries(expected[wk]).every(([k, v]) => got[k].score === v.score && got[k].eliminated === v.eliminated), `week ${wk} scores/eliminations equal hand-derived expectations`);
  }
  ok(out.weeks.find((x) => x.week === 4).results.find((x) => x.coupleId === 'pashkov').score === 25.5, 'absent judge: 17 x 30/20 = 25.5');
  ok(out.weeks.find((x) => x.week === 5).results.find((x) => x.coupleId === 'pashkov').score === 28.5, 'two dances, guest dropped: (27 + 30) / 2 = 28.5');
  ok(out.weeks.find((x) => x.week === 5).results.find((x) => x.coupleId === 'burgess').eliminated === true, 'withdrawal counted as elimination');
  ok(out.weeks.map((w) => w.week).join() === '5,4,3,2,1', 'weeks kept newest-first');
  const same13 = [1, 2, 3].every((n) => { const a = orig.weeks.find((w) => w.week === n); const b = out.weeks.find((w) => w.week === n); return JSON.stringify(a.results) === JSON.stringify(b.results) && a.label === b.label && a.maxScore === b.maxScore && b.name; });
  ok(same13, 'weeks 1-3: results/label/maxScore byte-identical, only "name" added');
  ok(typeof out.updatedAt === 'string' && !Number.isNaN(Date.parse(out.updatedAt)), 'updatedAt stamped');
  const again = run(d, ['--wikitext-file', 'tests/fixtures/season35-sim-weeks4-5.wikitext']);
  ok(again.rep.report.applied.length === 0 && /No changes to write/.test(again.out), 'second run is a clean no-op (idempotent)');
  const v = execFileSync('node', ['tests/verify-scoring.mjs', 'tests/fixtures/original-app.js', d], { encoding: 'utf8' });
  ok(/0 mismatches/.test(v), 'original app vs scoring.js on simulated weeks 1-5: ' + v.trim().split('\n').pop());
  const gap = readFileSync('tests/fixtures/season35-sim-weeks4-5.wikitext', 'utf8').replace('| 14 (7, 7)\n| Jazz\n| "[[Emotions', '|\n| Jazz\n| "[[Emotions');
  const d2 = tmp(); ['season.json', 'scores.json'].forEach((f) => copyFileSync(join('data', f), join(d2, f))); writeFileSync(join(d2, 'w.txt'), gap);
  const g = run(d2, ['--wikitext-file', join(d2, 'w.txt')]);
  const gout = JSON.parse(readFileSync(join(d2, 'scores.json'), 'utf8'));
  ok(!gout.weeks.some((w) => w.week >= 4) && g.rep.report.flags.some((f) => /week 4 is missing, so week 5 was not created/.test(f)), 'incomplete week 4 -> week 5 not created (no gaps)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
