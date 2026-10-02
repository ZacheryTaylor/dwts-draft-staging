// Proves, from the backed-up data, for every week cut-off (after week 1, 2, 3 ...):
//  (a) Points and Alive from js/scoring.js are bit-for-bit identical to the ORIGINAL live app.js;
//  (b) the rankings comparator is unchanged (original comparator fed the same values gives the same order);
//  (c) the new Max Possible equals an independent brute-force best case (every subset of surviving couples);
//  (d) prints old vs new Max Possible.
// Usage: node tests/verify-scoring.mjs <original app.js> <data dir>
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Scoring = require('../js/scoring.js');

const [origApp = 'tests/fixtures/original-app.js', dataDir = 'data', schedPath] = process.argv.slice(2);
const season = JSON.parse(readFileSync(`${dataDir}/season.json`, 'utf8'));
const scoresAll = JSON.parse(readFileSync(`${dataDir}/scores.json`, 'utf8'));
const league = JSON.parse(readFileSync(`${dataDir}/league.json`, 'utf8'));
const sp = schedPath || (existsSync(`${dataDir}/elimination-schedule.json`) ? `${dataDir}/elimination-schedule.json` : 'data/elimination-schedule.json');
const schedule = JSON.parse(readFileSync(sp, 'utf8'));

const src = readFileSync(origApp, 'utf8').replace(/\ninit\(\);\s*$/, '\n');
const ctx = vm.createContext({ document: {}, localStorage: { getItem: () => null, setItem() {} }, console });
vm.runInContext(src, ctx);
const setOrig = (sc) => { ctx.__s = season; ctx.__w = sc; ctx.__l = league; vm.runInContext('season = __s; scores = __w; league = __l;', ctx); };
const orig = (expr) => vm.runInContext(expr, ctx);

// independent best case: try every subset of the team's alive couples with size <= cap
function bruteMax(sc, teamId) {
  const eliminated = new Set(sc.weeks.flatMap((w) => w.results.filter((r) => r.eliminated).map((r) => r.coupleId)));
  const coupleOf = Object.fromEntries(season.couples.flatMap((c) => [[c.amateur.id, c.id], [c.pro.id, c.id]]));
  const held = {};
  league.picks.filter((p) => p.teamId === teamId).forEach((p) => { const c = coupleOf[p.dancerId]; if (!eliminated.has(c)) held[c] = (held[c] || 0) + 1; });
  const ids = Object.keys(held); const aliveNow = season.couples.filter((c) => !eliminated.has(c.id)).length;
  const latest = Math.max(0, ...sc.weeks.map((w) => w.week));
  let extra = 0;
  for (let w = latest + 1; w <= season.roundValues.length; w += 1) {
    const row = schedule.weeks.find((x) => x.week === w); const cap = Math.min(row ? row.couplesCompeting : aliveNow, aliveNow);
    let best = 0;
    for (let mask = 0; mask < (1 << ids.length); mask += 1) {
      const chosen = ids.filter((_, i) => mask & (1 << i)); if (chosen.length > cap) continue;
      best = Math.max(best, chosen.reduce((s, c) => s + held[c], 0));
    }
    extra += season.roundValues[w - 1] * best;
  }
  return extra;
}

const weeks = [...new Set(scoresAll.weeks.map((w) => w.week))].sort((a, b) => a - b);
let compared = 0; let mismatches = 0; const table = [];
const cmpFactory = (key, dir) => { const d = dir === 'asc' ? 1 : -1; return (a, b) => { const l = a[key], r = b[key]; if (l === r) return b.points - a.points || b.mpp - a.mpp; return l > r ? d : -d; }; };
for (const cutoff of weeks) {
  const sc = { ...scoresAll, weeks: scoresAll.weeks.filter((w) => w.week <= cutoff) };
  setOrig(sc);
  const mine = Scoring.create({ season, scores: sc, league, schedule });
  const o = league.teams.map((t) => ({ id: t.id, name: t.name, points: orig(`scoreForTeam(${JSON.stringify(t.id)})`), oldMpp: orig(`maxPossible(${JSON.stringify(t.id)})`), alive: orig(`teamPicks(${JSON.stringify(t.id)}).filter(p => isAlive(p.coupleId)).length`) }));
  for (const t of o) {
    compared += 4;
    const pts = mine.scoreForTeam(t.id); const alive = mine.teamPicks(t.id).filter((p) => mine.isAlive(p.coupleId)).length;
    if (!Object.is(pts, t.points)) { mismatches += 1; console.log('MISMATCH points', cutoff, t.name, pts, t.points); }
    if (alive !== t.alive) { mismatches += 1; console.log('MISMATCH alive', cutoff, t.name); }
    if (!Object.is(mine.maxPossibleLegacy(t.id), t.oldMpp)) { mismatches += 1; console.log('MISMATCH legacy mpp', cutoff, t.name); }
    t.mpp = mine.maxPossible(t.id);
    const brute = t.points + bruteMax(sc, t.id);
    if (Math.abs(brute - t.mpp) > 1e-9) { mismatches += 1; console.log('MISMATCH new mpp vs brute force', cutoff, t.name, t.mpp, brute); }
  }
  for (const key of ['points', 'alive', 'mpp']) for (const dir of ['desc', 'asc']) {
    const expectOrder = [...o].sort(cmpFactory(key, dir)).map((t) => t.id);
    const got = mine.rankings({ key, dir }).map((t) => t.id);
    compared += 1; if (expectOrder.join() !== got.join()) { mismatches += 1; console.log('MISMATCH order', cutoff, key, dir); }
  }
  const ranked = [...o].sort(cmpFactory('points', 'desc'));
  const ties = ranked.filter((t, i) => i && Object.is(t.points, ranked[i - 1].points)).map((t) => t.name);
  table.push({ cutoff, ties, rows: ranked.map((t, i) => `${i + 1}. ${t.name.padEnd(28)} ${t.points.toFixed(2).padStart(7)}  alive ${t.alive}/8  MPP old ${t.oldMpp.toFixed(2).padStart(8)} -> new ${t.mpp.toFixed(2).padStart(8)}`) });
  for (const w of sc.weeks) for (const r of w.results) {
    compared += 1;
    const a = orig(`coupleScorePoints(${r.score}, season.roundValues[${w.week - 1}] || 0)`);
    const b = Scoring.coupleScorePoints(r.score, mine.weekValue(w.week));
    if (!Object.is(a, b)) { mismatches += 1; console.log('MISMATCH couple', w.week, r.coupleId, a, b); }
  }
}
for (const t of table) { console.log(`\nStandings through week ${t.cutoff}${t.ties.length ? ` (points tie broken by MPP: ${t.ties.join(', ')})` : ''}:`); t.rows.forEach((l) => console.log('  ' + l)); }
console.log(`\n${compared} values compared (points/alive/legacy MPP bit-for-bit vs original app; new MPP vs brute force; sort orders), ${mismatches} mismatches`);
process.exit(mismatches ? 1 : 0);
