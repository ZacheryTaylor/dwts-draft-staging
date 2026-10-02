/*
 * Draft the Stars scoring rules. These are a verbatim port of the formulas in the
 * original js/app.js (coupleScorePoints, isAlive, scoreForTeam, maxPossible and the
 * rankings comparator). Order of floating-point operations is preserved on purpose
 * so results are bit-for-bit identical. Do not "simplify" without re-running
 * tests/verify-scoring.mjs.
 */
(function (root) {
  function coupleScorePoints(score, weekValue) {
    return (Number(score) / 30) * Number(weekValue);
  }

  function create(ctx) {
    // ctx: { season, scores, league } (getters allowed so live refreshes are seen)
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
    function maxPossible(teamId) {
      const latestWeek = Math.max(0, ...(W().weeks || []).map((week) => Number(week.week) || 0));
      let total = scoreForTeam(teamId);
      teamPicks(teamId)
        .filter((pick) => isAlive(pick.coupleId))
        .forEach(() => {
          S().roundValues.slice(latestWeek).forEach((value) => { total += value; });
        });
      return total;
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
    return { allDancers, dancer, teamPicks, isAlive, scoreForTeam, maxPossible, rankings, weekValue, pickWeekPoints, coupleScorePoints };
  }

  const api = { coupleScorePoints, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DTSScoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
