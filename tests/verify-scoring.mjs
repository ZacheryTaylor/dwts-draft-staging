// Proves the staging scoring module reproduces the ORIGINAL live app.js exactly,
// for every week cut-off (cumulative after week 1, 2, 3 ...), from the backed-up data.
// Usage: node tests/verify-scoring.mjs <original app.js> <data dir>
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Scoring = require('../js/scoring.js');

const [origApp = 'tests/fixtures/original-app.js', dataDir = 'data'] = process.argv.slice(2);
const season = JSON.parse(readFileSync(`${dataDir}/season.json`, 'utf8'));
const scoresAll = JSON.parse(readFileSync(`${dataDir}/scores.json`, 'utf8'));
const league = JSON.parse(readFileSync(`${dataDir}/league.json`, 'utf8'));

// Load the original app.js in a sandbox (strip the init() call; stub the DOM).
const src = readFileSync(origApp, 'utf8').replace(/\ninit\(\);\s*$/, '\n');
const ctx = vm.createContext({ document: {}, localStorage: { getItem: () => null, setItem() {} }, console });
vm.runInContext(src, ctx);
const setOrig = (sc) => { ctx.__s = season; ctx.__w = sc; ctx.__l = league; vm.runInContext('season = __s; scores = __w; league = __l;', ctx); };
const orig = (expr) => vm.runInContext(expr, ctx);

const weeks = [...new Set(scoresAll.weeks.map((w) => w.week))].sort((a, b) => a - b);
let compared = 0; let mismatches = 0; const table = [];
for (const cutoff of weeks) {
  const sc = { ...scoresAll, weeks: scoresAll.weeks.filter((w) => w.week <= cutoff) };
  setOrig(sc);
  const mine = Scoring.create({ season, scores: sc, league });
  for (const sortKey of ['points', 'alive', 'mpp']) for (const dir of ['desc', 'asc']) {
    const o = league.teams.map((t) => ({ id: t.id, name: t.name, points: orig(`scoreForTeam(${JSON.stringify(t.id)})`), mpp: orig(`maxPossible(${JSON.stringify(t.id)})`), alive: orig(`teamPicks(${JSON.stringify(t.id)}).filter(p => isAlive(p.coupleId)).length`) }));
    const dirN = dir === 'asc' ? 1 : -1;
    o.sort((a, b) => { const l = a[sortKey], r = b[sortKey]; if (l === r) return b.points - a.points || b.mpp - a.mpp; return l > r ? dirN : -dirN; });
    const n = mine.rankings({ key: sortKey, dir });
    o.forEach((t, i) => {
      compared += 1;
      const same = n[i].id === t.id && Object.is(n[i].points, t.points) && Object.is(n[i].mpp, t.mpp) && n[i].alive === t.alive;
      if (!same) { mismatches += 1; console.log('MISMATCH', cutoff, sortKey, dir, i, t, n[i]); }
    });
    if (sortKey === 'points' && dir === 'desc') table.push({ throughWeek: cutoff, ranking: o.map((t, i) => `${i + 1}. ${t.name} ${t.points.toFixed(2)} (MPP ${t.mpp.toFixed(2)}, alive ${t.alive}/8)`) });
  }
  // per-couple weekly points
  for (const w of sc.weeks) for (const r of w.results) {
    compared += 1;
    const a = orig(`coupleScorePoints(${r.score}, season.roundValues[${w.week - 1}] || 0)`);
    const b = Scoring.coupleScorePoints(r.score, mine.weekValue(w.week));
    if (!Object.is(a, b)) { mismatches += 1; console.log('MISMATCH couple', w.week, r.coupleId, a, b); }
  }
}
for (const t of table) { console.log(`\nStandings through week ${t.throughWeek}:`); t.ranking.forEach((l) => console.log('  ' + l)); }
console.log(`\n${compared} values compared bit-for-bit (Object.is), ${mismatches} mismatches`);
process.exit(mismatches ? 1 : 0);
