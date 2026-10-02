# DWTS Draft — Draft the Stars

A Dancing with the Stars fantasy draft and scoring site. Search and share it as **DWTS Draft**.

- Live: https://zacherytaylor.github.io/dwts-draft/ (repo `ZacheryTaylor/dwts-draft`)
- Staging: https://zacherytaylor.github.io/dwts-draft-staging/ (repo `ZacheryTaylor/dwts-draft-staging`). Changes are made and checked there first. See [STAGING.md](STAGING.md).

## Rules

- Draft pros and amateurs separately
- Two copies of each dancer in the pool
- A team may take both partners from a couple
- A team may never own two copies of the same person
- Rosters are 4 pros + 4 amateurs, snake draft (order reverses every round), up to 8 teams

## Scoring (unchanged; code in `js/scoring.js`)

`points = (coupleScore / 30) * roundValue`, the same as `(coupleScore / 2 / 15) * roundValue`

- `coupleScore` is the couple's judges' total for the week, out of 30 (3 permanent judges × 10). Guest judges are left out.
- Rules Zach decided on 2026-10-02 (applied by auto-scoring when it builds `coupleScore`; the formula itself is unchanged):
  - **Two or more dances in a week:** average the couple's per-dance totals (permanent judges only, each out of 30). A perfect week still earns the full round value.
  - **A permanent judge is absent:** scale the two-judge total to 30 (`total × 30 / 20`).
  - **Bonus points and team dances** are left out.
  - **Withdrawals** count as eliminations.
- Week values: 10, 12, 14, 16, 18, 20, 23, 26, 29, 32, 36 (`data/season.json` → `roundValues`, week N uses entry N)
- Each drafted copy earns the full points. The celebrity and the pro from one couple are not split.
- A team's points are the sum over every published week and every pick.
- A couple counts as alive until any week marks it `eliminated: true`. It still scores in the week it goes home.
- **Max possible (MPP)** = current points + for every alive pick, the sum of all round values after the latest published week (a perfect 30 every remaining week).
- Rankings sort by Points (default, high to low). You can also sort by Alive or Max possible. Ties fall back to Points, then MPP.
- `tests/verify-scoring.mjs` proves bit-for-bit that `js/scoring.js` matches the original app for every week.

## Data

| File | What |
| --- | --- |
| `data/league.json` | League name, teams, the 64 draft picks, and the locked flag. This is the official roster: the site loads it first. |
| `data/scores.json` | `updatedAt`, `weeks[]`: `{ week, name?, label, maxScore: 30, results: [{ coupleId, score, eliminated }] }`, newest week first. `name` (optional, new) is the theme from the source, e.g. "Yacht Rock Night"; the site shows "Week 3: Yacht Rock Night" and falls back to `label`. Older readers simply ignore it. |
| `data/season.json` | Couples (amateur and pro ids and names), round values, roster sizes |
| `data/auto-score-log.json` | Audit log written by auto-scoring (provenance, applied changes, conflicts) |
| browser localStorage | A fallback only, used when `league.json` can't load. The key is `dwts-draft-v3` on live and `dwts-draft-v3::staging` on staging. |

## Auto scoring

`.github/workflows/auto-score.yml` runs `scripts/auto-score.mjs` every 30 minutes from Tuesday 8 PM to Wednesday 3:30 AM CT, with follow-up runs on Wednesday and Thursday. Scheduled runs only happen on the live repo. On staging the schedule is turned off, but a manual dispatch still works there.

1. It reads the Wikipedia season article (MediaWiki API, wikitext) and records the revision ID it used.
2. For each "Week N" table it reads every judge's score. It uses the judge order line for that week, which names any guest judge.
3. It keeps only the permanent judges (`config/auto-score.json`): Carrie Ann Inaba, Derek Hough and Bruno Tonioli. That gives a total out of 30.
4. It matches couple labels like "Julia & Ezra" or "Conner L. & Adele" to `season.json` IDs by celebrity and pro first names. Unknown or ambiguous names are **flagged, never guessed**.
5. It validates the data: each judge score is 1–10, the number of judge scores matches the judges listed, the listed total equals the sum, all 3 permanent judges are present, and the week is complete.
6. It merges the results. It adds new weeks and couples. It only flips `eliminated` from false to true. A score that differs from an existing one is **never overwritten**. The diff is logged and the job fails with exit code 2. Use `--accept-changes` to apply it on purpose.

**New weeks are created automatically** the first time their scores arrive. They get the next week number (no gaps), the theme name from the Wikipedia heading, `maxScore: 30`, and the round value from `season.json` (week N uses `roundValues[N-1]`; a week with no round value is flagged). Existing weeks without a `name` get one added, and nothing else in them changes.

**Refresh, end to end:** the Action commits `data/scores.json`, stamps `updatedAt`, and asks Pages to rebuild (about 1 minute). Every data fetch on the site is cache-busted (`?ts=…`, `cache: 'no-store'`). The open page checks for new scores every 60 seconds and whenever the tab comes back into view, re-renders in place, and shows a toast. The header shows **Last updated** (the time the data changed) and when it last checked, plus a ↻ Refresh button.

Options: `--dry-run`, `--wikitext-file <file>` (offline), `--only-week N`, `--allow-partial`, `--accept-changes`.
Bonus points (marathons, dance-offs) and team dances are never counted. Policies live in `config/auto-score.json` (`multiDancePolicy: average`, `absentJudgePolicy: scale`).
