# Staging

This repo (`ZacheryTaylor/dwts-draft-staging`) is a working copy of `ZacheryTaylor/dwts-draft`. Review changes here before promoting them to live.

How staging is kept apart from live data:
- **Separate data copy.** `data/*.json` here is a snapshot of live taken 2026-10-02 (live commit 85e786d). The site always fetches `./data/...` relative to the page it's served from, so it reads this repo's copy. `js/env.js` refuses to load a data URL under `/dwts-draft/data/`.
- **Separate browser storage.** Both sites share the `zacherytaylor.github.io` origin. Staging stores its draft state in `dwts-draft-v3::staging` and never touches live's `dwts-draft-v3`.
- **Workflows can't reach live.** The schedule in `auto-score.yml` only runs when `github.repository == 'ZacheryTaylor/dwts-draft'`. Manual runs use this repo's own `GITHUB_TOKEN`, which can only push here.
- **Visible badge.** A "Staging preview" badge and a blue top stripe show on staging and localhost only.
