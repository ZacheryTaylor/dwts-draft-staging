/*
 * Draft the Stars scoring rules. These are a verbatim port of the formulas in the
 * original js/app.js (coupleScorePoints, isAlive, scoreForTeam and the rankings
 * comparator). maxPossible was deliberately redefined on 2026-10-02 (see below); the
 * original is kept as maxPossibleLegacy. Order of floating-point operations is preserved on purpose
 * so results are bit-for-bit identical. Do not "simplify" without re-running
 * tests/verify-scoring.mjs.
 */
(function (root) {
  function coupleScorePoints(score, weekValue) {
    return (Number(score) / 30) * Number(weekValue);
  }

  function create(ctx) {
    // ctx: { season, scores, league, schedule? } (getters allowed so live refreshes are seen)
    const S = () => ctx.season;
    const W = () => ctx.scores;
    const L = () => ctx.league;

    function allDancers() {
      return S().couples.flatMap((couple) => [
        { ...couple.amateur, coupleId: couple.id, partner: couple.pro.name, role: 'amateur' },
        { ...couple.pro, coupleId: couple.id, partner: couple.amateur.name, role: 'pro' }
      ]);
    }
    function dancer(dancerId) {
      return allDancers().find((person) => person.id === dancerId);
    }
    function teamPicks(teamId) {
      return L().picks
        .filter((pick) => pick.teamId === teamId)
        .map((pick) => ({ ...pick, ...dancer(pick.dancerId) }));
    }
    function isAlive(coupleId) {
      return !(W().weeks || []).some((week) =>
        (week.results || []).some((result) => result.coupleId === coupleId && result.eliminated)
      );
    }
    function weekValue(week) {
      return S().roundValues?.[week - 1] || 0;
    }
    function scoreForTeam(teamId) {
      return (W().weeks || []).reduce((total, week) => {
        const value = S().roundValues?.[week.week - 1] || 0;
        return total + teamPicks(teamId).reduce((sum, pick) => {
          const result = (week.results || []).find((item) => item.coupleId === pick.coupleId);
          return sum + (result ? coupleScorePoints(result.score, value) : 0);
        }, 0);
      }, 0);
    }
    // ORIGINAL formula (kept for comparison/tests): every alive pick scores a perfect 30
    // in every remaining week, ignoring that couples are eliminated each week.
    function maxPossibleLegacy(teamId) {
      const latestWeek = Math.max(0, ...(W().weeks || []).map((week) => Number(week.week) || 0));
      let total = scoreForTeam(teamId);
      teamPicks(teamId)
        .filter((pick) => isAlive(pick.coupleId))
        .forEach(() => {
          S().roundValues.slice(latestWeek).forEach((value) => { total += value; });
        });
      return total;
    }

    // NEW (Zach, 2026-10-02): true best case given how many couples are still dancing each week.
    // For each remaining week w:  cap_w = min(couples competing in week w (schedule), couples alive now)
    //   best_w = sum of copies held on the team's top-k alive couples (most copies first), k = min(team's alive couples, cap_w)
    //   week max = (30/30) x roundValue_w x best_w
    // MPP = current points + sum of week max. Each drafted copy scores separately.
    function aliveCouplesNow() {
      return S().couples.filter((c) => isAlive(c.id)).length;
    }
    function couplesCompeting(week) {
      const row = (ctx.schedule?.weeks || []).find((w) => Number(w.week) === Number(week));
      const alive = aliveCouplesNow();
      return row ? Math.min(Number(row.couplesCompeting), alive) : alive;
    }
    function aliveCopiesByCouple(teamId) {
      const counts = new Map();
      teamPicks(teamId).filter((pick) => isAlive(pick.coupleId)).forEach((pick) => {
        counts.set(pick.coupleId, (counts.get(pick.coupleId) || 0) + 1);
      });
      return [...counts.entries()].map(([coupleId, copies]) => ({ coupleId, copies })).sort((a, b) => b.copies - a.copies || a.coupleId.localeCompare(b.coupleId));
    }
    function maxPossibleBreakdown(teamId) {
      const latestWeek = Math.max(0, ...(W().weeks || []).map((week) => Number(week.week) || 0));
      const held = aliveCopiesByCouple(teamId);
      const weeks = (S().roundValues || []).map((value, i) => ({ week: i + 1, value })).filter((w) => w.week > latestWeek).map((w) => {
        const cap = couplesCompeting(w.week);
        const k = Math.min(held.length, cap);
        const copies = held.slice(0, k).reduce((s, h) => s + h.copies, 0);
        return { ...w, cap, couplesCounted: k, copies, max: (30 / 30) * w.value * copies };
      });
      const points = scoreForTeam(teamId);
      return { points, held, weeks, total: weeks.reduce((t, w) => t + w.max, points) };
    }
    function maxPossible(teamId) {
      return maxPossibleBreakdown(teamId).total;
    }
    function rankings(rankSort = { key: 'points', dir: 'desc' }) {
      const direction = rankSort.dir === 'asc' ? 1 : -1;
      return L().teams
        .map((item) => {
          const picks = teamPicks(item.id);
          return {
            ...item,
            picks,
            points: scoreForTeam(item.id),
            alive: picks.filter((pick) => isAlive(pick.coupleId)).length,
            mpp: maxPossible(item.id)
          };
        })
        .sort((a, b) => {
          const left = a[rankSort.key];
          const right = b[rankSort.key];
          if (left === right) return b.points - a.points || b.mpp - a.mpp;
          return left > right ? direction : -direction;
        });
    }
    // Display-only helper (new): a pick's points in one week, same formula.
    function pickWeekPoints(pick, week) {
      const result = (week.results || []).find((item) => item.coupleId === pick.coupleId);
      return result ? coupleScorePoints(result.score, weekValue(week.week)) : 0;
    }
    return { allDancers, dancer, teamPicks, isAlive, scoreForTeam, maxPossible, maxPossibleLegacy, maxPossibleBreakdown, couplesCompeting, rankings, weekValue, pickWeekPoints, coupleScorePoints };
  }

  const api = { coupleScorePoints, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DTSScoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
