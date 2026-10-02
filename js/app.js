/* Draft the Stars — app. Scoring lives in js/scoring.js (verbatim rules). */
const ENV = window.DTS_ENV || { isStaging: false, storageKey: 'dwts-draft-v3', dataUrl: (f) => `data/${f}` };
const STORAGE_KEY = ENV.storageKey;
const RESET_CODE = '0000';
const LOCK_CODE = '0000';

let season;
let scores;
let league;
let activeView = 'rankings';
let playerFilter = 'all';
let rankSort = { key: 'points', dir: 'desc' };
let selectedWeek = null; // null = latest
let openTeams = new Set();
let lastLoadedAt = null;

const VIEWS = ['rankings', 'draft', 'scores', 'league'];
const $ = (id) => document.getElementById(id);
const S = DTSScoring.create({ get season() { return season; }, get scores() { return scores; }, get league() { return league; } });

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safe(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- league state (unchanged behaviour) ---------- */
function freshLeague() {
  return { name: '', teams: [], picks: [], started: false, paused: false, completed: false, locked: false };
}

function loadLeague() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || freshLeague();
    if (typeof data.locked !== 'boolean') data.locked = Boolean(data.completed);
    if (data.completed) data.locked = true;
    return data;
  } catch {
    return freshLeague();
  }
}

function saveLeague() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(league));
}

async function loadPublishedLeague() {
  const response = await fetch(`${ENV.dataUrl('league.json')}?ts=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load the official league roster.');
  return response.json();
}

function askCode(code, reason) {
  const typed = prompt(`Enter code to ${reason}:`);
  if (typed === null) return false;
  if (typed !== code) {
    alert('Incorrect code. Nothing was changed.');
    return false;
  }
  return true;
}

function teamsLocked() { return Boolean(league.locked); }

function lockTeams() {
  if (!askCode(LOCK_CODE, 'lock teams and draft data')) return;
  league.locked = true;
  saveLeague();
  render();
}

function unlockTeams() {
  if (!askCode(LOCK_CODE, 'unlock teams and draft data')) return;
  league.locked = false;
  saveLeague();
  render();
}

const allDancers = () => S.allDancers();
const dancer = (dancerId) => S.dancer(dancerId);
const teamPicks = (teamId) => S.teamPicks(teamId);
const isAlive = (coupleId) => S.isAlive(coupleId);
const scoreForTeam = (teamId) => S.scoreForTeam(teamId);
const maxPossible = (teamId) => S.maxPossible(teamId);
const coupleScorePoints = (score, value) => DTSScoring.coupleScorePoints(score, value);

function copiesPerDancer() { return Number(season.copiesPerDancer || 2); }
function rosterLimit(role) { return Number(season.rosterSize?.[role] || 4); }
function team(teamId) { return league.teams.find((item) => item.id === teamId); }
function countRole(teamId, role) { return teamPicks(teamId).filter((pick) => pick.role === role).length; }
function copiesUsed(dancerId) { return league.picks.filter((pick) => pick.dancerId === dancerId).length; }
function teamAlreadyHas(teamId, dancerId) { return league.picks.some((pick) => pick.teamId === teamId && pick.dancerId === dancerId); }

function draftOrder() {
  const ids = league.teams.map((item) => item.id);
  const total = ids.length * (rosterLimit('amateur') + rosterLimit('pro'));
  const order = [];
  if (!ids.length) return order;
  for (let round = 0; order.length < total; round += 1) {
    const thisRound = round % 2 === 0 ? ids : [...ids].reverse();
    thisRound.forEach((teamId) => { if (order.length < total) order.push(teamId); });
  }
  return order;
}

function onClockId() {
  if (!league.started || league.paused || league.completed || teamsLocked()) return null;
  return draftOrder()[league.picks.length] || null;
}

function onClockTeam() { return team(onClockId()); }

function currentRound() {
  return Math.floor(league.picks.length / Math.max(league.teams.length, 1)) + 1;
}

function canDraft(dancerId) {
  const person = dancer(dancerId);
  const teamId = onClockId();
  if (!person || !teamId) return false;
  if (teamsLocked()) return false;
  if (copiesUsed(dancerId) >= copiesPerDancer()) return false;
  if (teamAlreadyHas(teamId, dancerId)) return false;
  if (countRole(teamId, person.role) >= rosterLimit(person.role)) return false;
  return true;
}

function addTeam() {
  if (league.started || teamsLocked()) return;
  if (league.teams.length >= 8) {
    alert('The included board design has room for up to 8 teams.');
    return;
  }
  league.teams.push({ id: id('team'), name: `Team ${league.teams.length + 1}` });
  saveLeague();
  render();
}

function removeTeam(teamId) {
  if (league.started || teamsLocked()) return;
  league.teams = league.teams.filter((item) => item.id !== teamId);
  saveLeague();
  render();
}

function moveTeam(index, direction) {
  if (league.started || teamsLocked()) return;
  const target = index + direction;
  if (target < 0 || target >= league.teams.length) return;
  [league.teams[index], league.teams[target]] = [league.teams[target], league.teams[index]];
  saveLeague();
  render();
}

function saveSetup() {
  if (league.started || teamsLocked()) return;
  league.name = $('league-name')?.value.trim() || '';
  league.teams.forEach((item) => {
    const field = $(`team-${item.id}`);
    if (field) item.name = field.value.trim();
  });
  saveLeague();
}

function setupComplete() {
  return league.name.length > 0 && league.teams.length >= 2 && league.teams.every((item) => item.name.length > 0);
}

function startDraft() {
  saveSetup();
  if (!setupComplete()) {
    alert('Enter a draft name, add at least two teams, and give every team a name.');
    render();
    return;
  }
  league.started = true;
  league.paused = false;
  league.completed = false;
  league.locked = false;
  saveLeague();
  render();
  showView('draft');
}

function draftCopy(dancerId) {
  if (!canDraft(dancerId)) return;
  const person = dancer(dancerId);
  const clock = onClockTeam();
  const copy = copiesUsed(dancerId) + 1;
  if (!confirm(`Draft ${person.name} (copy ${copy}) to ${clock.name}?`)) return;
  league.picks.push({ id: id('pick'), overall: league.picks.length + 1, round: currentRound(), teamId: clock.id, dancerId, copy });
  if (league.picks.length === draftOrder().length) {
    league.completed = true;
    league.locked = true;
  }
  saveLeague();
  render();
}

function undoPick() {
  if (teamsLocked()) { alert('Teams are locked. Unlock with the code first.'); return; }
  if (!league.picks.length) { alert('No picks have been made yet.'); return; }
  const last = league.picks.at(-1);
  const person = dancer(last.dancerId);
  if (!confirm(`Undo ${person.name}, copy ${last.copy}?`)) return;
  league.picks.pop();
  league.completed = false;
  league.paused = false;
  saveLeague();
  render();
}

function pauseDraft() { if (teamsLocked()) return; league.paused = true; saveLeague(); render(); }
function resumeDraft() { if (teamsLocked()) return; league.paused = false; saveLeague(); render(); }

function resetLeague() {
  const typed = prompt('Enter reset code:');
  if (typed === null) return;
  if (typed !== RESET_CODE) { alert('Incorrect code. Nothing was reset.'); return; }
  if (!confirm('Reset this league? All drafted players will be removed.')) return;
  league = freshLeague();
  saveLeague();
  render();
  showView('league');
}

/* ---------- helpers for display ---------- */
function roleLabel(role) { return role === 'amateur' ? 'Amateur' : 'Pro'; }
function fmt(n) { return Number(n).toFixed(2); }
function sortedWeeks() { return [...(scores.weeks || [])].sort((a, b) => Number(a.week) - Number(b.week)); }
function latestWeekNumber() { return Math.max(0, ...(scores.weeks || []).map((w) => Number(w.week) || 0)); }
function coupleById(coupleId) { return season.couples.find((item) => item.id === coupleId); }
function coupleName(couple) { return couple ? `${couple.amateur.name} & ${couple.pro.name}` : 'Unknown couple'; }
function eliminatedWeek(coupleId) {
  const w = sortedWeeks().find((week) => (week.results || []).some((r) => r.coupleId === coupleId && r.eliminated));
  return w ? Number(w.week) : null;
}

// Previous-week standings, used only for the movement arrows (same scoring module).
function previousRanks() {
  const latest = latestWeekNumber();
  if (latest < 2) return null;
  const prevScores = { ...scores, weeks: (scores.weeks || []).filter((w) => Number(w.week) < latest) };
  const prev = DTSScoring.create({ season, scores: prevScores, league }).rankings({ key: 'points', dir: 'desc' });
  return new Map(prev.map((t, i) => [t.id, i + 1]));
}

function scoringFormatText() {
  const values = (season.roundValues || []).map((v, i) => `<li><span>Week ${i + 1}</span><b>${safe(v)}</b></li>`).join('');
  return `
    <div id="scoring-format" class="card scoring-card hidden">
      <h3>How scoring works</h3>
      <p>Weekly scores are entered from confirmed published Dancing with the Stars judge totals and results.</p>
      <p class="formula"><b>(couple score ÷ 30) × that week’s round value</b></p>
      <p>A perfect 30/30 earns the full round value. The celebrity and professional from the same couple each earn the full result for their own drafted copy; points are not split in half.</p>
      <p>Guest judges are left out so every week is scored by the same three permanent judges (out of 30).</p>
      <ul class="round-values" aria-label="Round values">${values}</ul>
      <p>Max possible assumes every dancer whose couple is still alive scores a perfect 30 for every remaining week.</p>
      <p>Eliminated couples stop scoring after the week they go home.</p>
    </div>`;
}

/* ---------- Draft view ---------- */
function renderBoard() {
  const rounds = Array.from({ length: 8 }, (_, index) => index + 1);
  const teamCount = Math.max(league.teams.length, 1);
  const teamHeaders = league.started
    ? league.teams.map((item) => `<span title="${safe(item.name)}">${safe(item.name)}</span>`).join('')
    : '';
  const columns = league.teams.map((item) => `
    <div class="board-team-column">
      <div class="board-team-name">${safe(item.name)}</div>
      ${rounds.map((round) => {
        const pick = league.picks.find((entry) => entry.teamId === item.id && entry.round === round);
        const person = pick ? dancer(pick.dancerId) : null;
        return `<div class="board-slot ${person?.role || 'empty'} ${person && !isAlive(person.coupleId) ? 'out' : ''}">${person ? `<b>${safe(person.name)}</b><span>${roleLabel(person.role)}</span>` : ''}</div>`;
      }).join('')}
    </div>`).join('');
  return `
    <div class="board-scroll" tabindex="0" aria-label="Draft board (scrolls sideways)">
      <div class="draft-board">
        <img src="1.png" alt="Draft the Stars draft board" class="board-image" width="1500" height="1000" decoding="async">
        ${league.started ? `<div class="board-team-header" style="--team-count:${teamCount}">${teamHeaders}</div>` : ''}
        <div class="board-overlay" style="--team-count:${teamCount}">${columns}</div>
      </div>
    </div>
    <p class="hint mobile-only">Swipe the board sideways to see every team →</p>`;
}

function copyButton(person, copy) {
  const taken = league.picks.some((pick) => pick.dancerId === person.id && pick.copy === copy);
  const clickable = !taken && canDraft(person.id);
  return `<button class="copy-button ${taken ? 'picked' : ''}" data-dancer="${person.id}" data-copy="${copy}" ${clickable ? '' : 'disabled'}>${taken ? 'Picked' : `Draft ${copy}`}</button>`;
}

function dancerHalf(person) {
  const used = copiesUsed(person.id);
  const fullyDrafted = used >= copiesPerDancer();
  return `
    <div class="dancer-half ${person.role} ${fullyDrafted ? 'fully-drafted' : ''}">
      <span class="role-chip">${roleLabel(person.role)}</span>
      <strong>${safe(person.name)}</strong>
      <span class="partner-name">Partner: ${safe(person.partner)}</span>
      <div class="copy-buttons">${copyButton(person, 1)}${copyButton(person, 2)}</div>
      <span class="availability ${fullyDrafted ? 'gone' : used ? 'one-left' : ''}">${fullyDrafted ? 'All copies selected' : used ? '1 copy remaining' : '2 copies available'}</span>
    </div>`;
}

function renderPool() {
  return season.couples.map((couple) => {
    const people = [
      { ...couple.amateur, role: 'amateur', partner: couple.pro.name },
      { ...couple.pro, role: 'pro', partner: couple.amateur.name }
    ].filter((person) => playerFilter === 'all' || playerFilter === person.role);
    if (!people.length) return '';
    const out = !isAlive(couple.id);
    return `
      <article class="couple-bubble ${out ? 'couple-out' : ''}">
        <div class="couple-heading">${safe(couple.amateur.name)} <span>×</span> ${safe(couple.pro.name)}${out ? ' <em class="pill pill-out">Eliminated</em>' : ''}</div>
        <div class="couple-halves ${people.length === 1 ? 'single' : ''}">${people.map(dancerHalf).join('')}</div>
      </article>`;
  }).join('');
}

function lockButtons() {
  return teamsLocked() ? '<button id="unlock-teams" class="ghost">🔒 Unlock teams</button>' : '<button id="lock-teams" class="ghost">🔓 Lock teams</button>';
}

function bindLockButtons() {
  document.querySelectorAll('#lock-teams').forEach((b) => { b.onclick = lockTeams; });
  document.querySelectorAll('#unlock-teams').forEach((b) => { b.onclick = unlockTeams; });
}

function renderDraft() {
  const clock = onClockTeam();
  const pickNumber = league.picks.length + 1;
  const total = draftOrder().length;
  const status = league.completed
    ? teamsLocked() ? 'Draft complete · teams locked' : 'Draft complete'
    : league.paused ? 'Draft paused' : league.started ? `On the clock: ${clock?.name || ''}` : 'Draft has not started';
  const progress = total ? Math.round((league.picks.length / total) * 100) : 0;

  $('view-draft').innerHTML = `
    <div class="card draft-status-card">
      <div class="draft-status-text">
        <p class="eyebrow">${league.started ? `Pick ${Math.min(pickNumber, total || pickNumber)} · Round ${Math.min(currentRound(), 8)}` : 'Commissioner draft room'}</p>
        <h2>${safe(status)}</h2>
        <p class="muted">${league.started && clock
          ? `${safe(clock.name)}: ${countRole(clock.id, 'amateur')}/4 amateurs · ${countRole(clock.id, 'pro')}/4 pros`
          : teamsLocked() ? 'Teams and pick data are locked. Use the code to unlock.' : 'Set up the league, set the order, then start the snake draft.'}</p>
        ${total ? `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${league.picks.length}" aria-label="Draft progress"><span style="width:${progress}%"></span></div><p class="hint">${league.picks.length} of ${total} picks made</p>` : ''}
      </div>
      <div class="draft-toolbar">
        ${!league.started && !teamsLocked() ? `<button class="primary" id="start-from-draft" ${setupComplete() ? '' : 'disabled'}>Start Draft</button>` : ''}
        ${league.started && !league.completed && !league.paused && !teamsLocked() ? '<button id="pause-draft">Pause</button>' : ''}
        ${league.paused && !teamsLocked() ? '<button class="primary" id="resume-draft">Resume</button>' : ''}
        ${league.started && league.picks.length && !teamsLocked() ? '<button class="oops" id="undo-pick">OOPS · Undo last pick</button>' : ''}
        ${lockButtons()}
        <button class="reset" id="reset-league">Reset league</button>
      </div>
    </div>
    ${renderBoard()}
    <div class="card pool-header">
      <div>
        <h2>Available dancers</h2>
        <p class="muted">Click Draft 1 or Draft 2 for the dancer copy being selected. A picked button greys out; both picks grey out the entire dancer half.</p>
      </div>
      <label>Show
        <select id="player-filter">
          <option value="all">All dancers</option>
          <option value="amateur">Amateurs</option>
          <option value="pro">Pros</option>
        </select>
      </label>
    </div>
    <div class="couple-grid">${renderPool()}</div>`;

  $('player-filter').value = playerFilter;
  $('player-filter').onchange = (event) => { playerFilter = event.target.value; renderDraft(); };
  if ($('start-from-draft')) $('start-from-draft').onclick = startDraft;
  if ($('pause-draft')) $('pause-draft').onclick = pauseDraft;
  if ($('resume-draft')) $('resume-draft').onclick = resumeDraft;
  if ($('undo-pick')) $('undo-pick').onclick = undoPick;
  $('reset-league').onclick = resetLeague;
  bindLockButtons();
  $('view-draft').querySelectorAll('[data-dancer]').forEach((button) => {
    button.onclick = () => draftCopy(button.dataset.dancer);
  });
}

/* ---------- League setup ---------- */
function downloadBackup() {
  const payload = { exportedAt: new Date().toISOString(), environment: ENV.name, league, scores, season };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `draft-the-stars-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  toast('Backup downloaded');
}

function renderLeague() {
  const locked = league.started || teamsLocked();
  $('view-league').innerHTML = `
    <div class="card">
      <p class="eyebrow">Before the draft</p>
      <h2>League setup</h2>
      <label>Draft name
        <input id="league-name" value="${safe(league.name)}" placeholder="Example: Girls' DWTS Draft" ${locked ? 'disabled' : ''}>
      </label>
      <p class="muted">The draft name is shown at the top of Rankings.${teamsLocked() ? ' Teams are locked until the lock code is entered.' : ''}</p>
      <h3>First-round order</h3>
      <p class="muted">Top to bottom is Round 1. The order reverses automatically in every following round.</p>
      <div class="team-setup-list">
        ${league.teams.map((item, index) => `
          <div class="team-setup-row">
            <span class="order-number">${index + 1}</span>
            <input id="team-${item.id}" value="${safe(item.name)}" aria-label="Team ${index + 1} name" ${locked ? 'disabled' : ''}>
            <button data-up="${index}" aria-label="Move up" ${locked || index === 0 ? 'disabled' : ''}>↑</button>
            <button data-down="${index}" aria-label="Move down" ${locked || index === league.teams.length - 1 ? 'disabled' : ''}>↓</button>
            <button data-remove="${item.id}" ${locked ? 'disabled' : ''}>Remove</button>
          </div>`).join('')}
      </div>
      <div class="row">
        <button id="save-setup" ${locked ? 'disabled' : ''}>Save setup</button>
        <button id="add-team" ${locked || league.teams.length >= 8 ? 'disabled' : ''}>Add team</button>
        <button class="primary" id="start-draft" ${locked ? 'disabled' : ''}>Start Draft</button>
        ${lockButtons()}
      </div>
    </div>
    <div class="card tools-card">
      <p class="eyebrow">Tools</p>
      <h3>Keep a copy</h3>
      <p class="muted">Download everything this page is showing — league, rosters, weekly scores and the season — as one JSON file. Nothing is uploaded anywhere.</p>
      <div class="row"><button id="download-backup">Download backup (.json)</button></div>
    </div>`;

  $('save-setup').onclick = () => { saveSetup(); render(); toast('Setup saved'); };
  $('add-team').onclick = addTeam;
  $('start-draft').onclick = startDraft;
  $('download-backup').onclick = downloadBackup;
  bindLockButtons();
  $('view-league').querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => moveTeam(Number(b.dataset.up), -1); });
  $('view-league').querySelectorAll('[data-down]').forEach((b) => { b.onclick = () => moveTeam(Number(b.dataset.down), 1); });
  $('view-league').querySelectorAll('[data-remove]').forEach((b) => { b.onclick = () => removeTeam(b.dataset.remove); });
}

/* ---------- Rankings ---------- */
function sortMark(key) {
  if (rankSort.key !== key) return '';
  return rankSort.dir === 'desc' ? ' ▾' : ' ▴';
}

function setRankSort(key) {
  if (rankSort.key === key) rankSort.dir = rankSort.dir === 'desc' ? 'asc' : 'desc';
  else { rankSort.key = key; rankSort.dir = 'desc'; }
  renderRankings();
}

function movement(prev, teamId, now) {
  if (!prev || rankSort.key !== 'points' || rankSort.dir !== 'desc') return '';
  const before = prev.get(teamId);
  if (!before || before === now) return '<span class="move same" title="No change since last week">–</span>';
  const diff = before - now;
  return diff > 0
    ? `<span class="move up" title="Up ${diff} since last week">▲${diff}</span>`
    : `<span class="move down" title="Down ${-diff} since last week">▼${-diff}</span>`;
}

function teamDetail(item) {
  const weeks = sortedWeeks();
  const rows = item.picks.map((pick) => {
    const per = weeks.map((w) => S.pickWeekPoints(pick, w));
    const total = per.reduce((a, b) => a + b, 0);
    const out = eliminatedWeek(pick.coupleId);
    return `<tr class="${out ? 'is-out' : ''}">
      <th scope="row"><span class="roster-chip ${pick.role} ${isAlive(pick.coupleId) ? '' : 'eliminated'}">${safe(pick.name)}</span><small>${roleLabel(pick.role)} · with ${safe(pick.partner)}${out ? ` · out wk ${out}` : ''}</small></th>
      ${per.map((p) => `<td class="num">${p ? fmt(p) : '—'}</td>`).join('')}
      <td class="num strong">${fmt(total)}</td></tr>`;
  }).join('');
  return `<div class="team-detail"><div class="table-scroll"><table class="detail-table">
    <thead><tr><th>Dancer</th>${weeks.map((w) => `<th class="num">Wk ${w.week}</th>`).join('')}<th class="num">Total</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="hint">Per-dancer totals are shown for reference; the team total above is the official figure.</p></div>`;
}

function renderRankings() {
  const teams = S.rankings(rankSort);
  const prev = previousRanks();
  const latest = latestWeekNumber();
  const latestWeek = (scores.weeks || []).find((w) => Number(w.week) === latest);
  const weekPts = (item) => (latestWeek ? item.picks.reduce((s, p) => s + S.pickWeekPoints(p, latestWeek), 0) : 0);
  const podium = S.rankings({ key: 'points', dir: 'desc' }).slice(0, 3);
  const lead = podium[0]?.points || 0;
  const bestWeek = latestWeek ? [...teams].sort((a, b) => weekPts(b) - weekPts(a))[0] : null;

  $('view-rankings').innerHTML = `
    <div class="card hero-card">
      <div class="hero-head">
        <div>
          <p class="eyebrow">${safe(league.name || 'Untitled draft')}</p>
          <h2>Rankings</h2>
          <p class="muted">Results and rosters for this saved draft${latest ? ` · through week ${latest}${latestWeek?.label ? ` (${safe(latestWeek.label)})` : ''}` : ''}.</p>
        </div>
        <div class="hero-actions">
          <button type="button" id="toggle-scoring" class="ghost" aria-expanded="false" aria-controls="scoring-format">How scoring works</button>
        </div>
      </div>
      ${podium.length ? `<ol class="podium">${podium.map((t, i) => `
        <li class="podium-${i + 1}">
          <span class="medal" aria-hidden="true">${['✦', '✧', '✶'][i]}</span>
          <span class="podium-rank">${i + 1}</span>
          <span class="podium-name">${safe(t.name)}</span>
          <span class="podium-pts">${fmt(t.points)} <small>pts</small></span>
          <span class="podium-gap">${i === 0 ? 'Leader' : `${fmt(lead - t.points)} behind`}</span>
        </li>`).join('')}</ol>` : ''}
      ${bestWeek && weekPts(bestWeek) > 0 ? `<p class="spotlight">✨ Top team in week ${latest}: <b>${safe(bestWeek.name)}</b> with ${fmt(weekPts(bestWeek))} pts</p>` : ''}
    </div>
    ${scoringFormatText()}
    <div class="card">
      <div class="sort-chips" role="group" aria-label="Sort rankings">
        <span class="hint">Sort by</span>
        ${[['points', 'Points'], ['alive', 'Alive'], ['mpp', 'Max possible']].map(([k, l]) => `<button type="button" class="chip ${rankSort.key === k ? 'active' : ''}" data-sort="${k}" aria-pressed="${rankSort.key === k}">${l}${sortMark(k)}</button>`).join('')}
      </div>
      <div class="table-scroll">
        <table class="rank-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th><button type="button" class="sort-head" data-sort="points">Points${sortMark('points')}</button></th>
              ${latestWeek ? `<th class="hide-sm">Wk ${latest}</th>` : ''}
              <th><button type="button" class="sort-head" data-sort="alive">Alive${sortMark('alive')}</button></th>
              <th><button type="button" class="sort-head" data-sort="mpp">Max possible${sortMark('mpp')}</button></th>
              <th>Roster</th>
            </tr>
          </thead>
          <tbody>
            ${teams.map((item, index) => `
              <tr class="team-row ${openTeams.has(item.id) ? 'open' : ''}" data-team="${item.id}">
                <td class="rank-cell"><span class="rank-num">${index + 1}</span>${movement(prev, item.id, index + 1)}</td>
                <td class="team-cell"><button type="button" class="team-toggle" data-toggle-team="${item.id}" aria-expanded="${openTeams.has(item.id)}">${safe(item.name)}<span class="chev" aria-hidden="true">›</span></button></td>
                <td class="num strong" data-label="Points">${item.points.toFixed(2)}</td>
                ${latestWeek ? `<td class="num hide-sm" data-label="Wk ${latest}">+${fmt(weekPts(item))}</td>` : ''}
                <td class="num" data-label="Alive"><span class="alive-meter" style="--alive:${item.picks.length ? item.alive / item.picks.length : 0}">${item.alive}/${item.picks.length}</span></td>
                <td class="num" data-label="Max possible">${item.mpp.toFixed(2)}</td>
                <td class="roster-cell">${item.picks.map((pick) => `<span class="roster-chip ${pick.role} ${isAlive(pick.coupleId) ? '' : 'eliminated'}">${safe(pick.name)}</span>`).join('') || '—'}</td>
              </tr>
              ${openTeams.has(item.id) ? `<tr class="detail-row"><td colspan="${latestWeek ? 7 : 6}">${teamDetail(item)}</td></tr>` : ''}`).join('')}
          </tbody>
        </table>
      </div>
      <p class="hint">Tap a team for its week-by-week breakdown. Grey chips are eliminated dancers. ${prev ? 'Arrows show movement since last week.' : ''}</p>
    </div>`;

  $('toggle-scoring').onclick = (e) => {
    const panel = $('scoring-format');
    panel?.classList.toggle('hidden');
    e.currentTarget.setAttribute('aria-expanded', String(!panel?.classList.contains('hidden')));
  };
  $('view-rankings').querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => setRankSort(b.dataset.sort); });
  $('view-rankings').querySelectorAll('[data-toggle-team]').forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.toggleTeam;
      if (openTeams.has(t)) openTeams.delete(t); else openTeams.add(t);
      renderRankings();
    };
  });
}

/* ---------- Weekly scores ---------- */
async function refreshOracleScores(silent) {
  try {
    const response = await fetch(`${ENV.dataUrl('scores.json')}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load published weekly scores.');
    const next = await response.json();
    const before = JSON.stringify(scores);
    const after = JSON.stringify(next);
    scores = next;
    lastLoadedAt = new Date();
    if (!silent || before !== after) render();
    if (!silent) toast(before === after ? 'Scores are up to date' : 'New scores loaded');
    else if (before !== after) toast('New scores just came in ✨');
  } catch {
    if (!silent) alert('Could not load the published weekly scores yet.');
  }
}

function ownersOf(coupleId) {
  return league.picks.filter((p) => dancer(p.dancerId)?.coupleId === coupleId).length;
}

function renderScores() {
  const weeks = scores.weeks || [];
  const source = scores.source || 'confirmed published weekly results';
  const asc = sortedWeeks();
  const latest = latestWeekNumber();
  const showWeek = selectedWeek === 'all' ? 'all' : (selectedWeek ?? latest);
  const visible = showWeek === 'all' ? weeks : weeks.filter((w) => Number(w.week) === Number(showWeek));

  $('view-scores').innerHTML = `
    <div class="card">
      <div class="hero-head">
        <div>
          <p class="eyebrow">${weeks.length ? `${weeks.length} week${weeks.length === 1 ? '' : 's'} scored` : 'Season'} ${season.season ? `· Season ${safe(season.season)}` : ''}</p>
          <h2>Weekly scores</h2>
          <p class="muted">Each dancer earns (couple score ÷ 30) × that round’s value. Scores are loaded from the published weekly results file (${safe(source)}).</p>
        </div>
        <div class="hero-actions">
          <button id="refresh-scores" class="ghost">↻ Refresh published scores</button>
          <span class="hint">${scores.updatedAt ? `Updated ${safe(scores.updatedAt)}` : ''}${lastLoadedAt ? ` · checked ${lastLoadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
        </div>
      </div>
      ${weeks.length ? `<div class="week-tabs" role="tablist" aria-label="Choose week">
        ${asc.map((w) => `<button role="tab" data-week="${w.week}" aria-selected="${Number(showWeek) === Number(w.week)}" class="${Number(showWeek) === Number(w.week) ? 'active' : ''}">Week ${w.week}</button>`).join('')}
        <button role="tab" data-week="all" aria-selected="${showWeek === 'all'}" class="${showWeek === 'all' ? 'active' : ''}">All weeks</button>
      </div>` : ''}
      ${weeks.length ? visible.map((week) => {
        const value = season.roundValues?.[week.week - 1] || 0;
        const ranked = [...week.results].sort((a, b) => Number(b.score) - Number(a.score));
        const top = ranked[0]?.score;
        return `
        <section class="week-block">
          <div class="week-head">
            <h3>Week ${week.week}${week.label ? ` <span class="week-label">${safe(week.label)}</span>` : ''}</h3>
            <span class="pill">Round value ${safe(value)}</span>
          </div>
          <table class="score-table">
            <thead><tr><th>Couple</th><th class="num">Score</th><th class="num">Points</th><th>Result</th></tr></thead>
            <tbody>
              ${week.results.map((result) => {
                const couple = coupleById(result.coupleId);
                const pts = coupleScorePoints(result.score, value);
                const owners = ownersOf(result.coupleId);
                return `
                <tr class="${result.eliminated ? 'is-out' : ''}">
                  <td><span class="couple-names">${safe(couple?.amateur.name)} <span class="amp">/</span> ${safe(couple?.pro.name)}</span>
                    <small>${owners ? `${owners} drafted cop${owners === 1 ? 'y' : 'ies'}` : 'Undrafted'}${Number(result.score) === Number(top) ? ' · <b class="gold">Top score</b>' : ''}</small></td>
                  <td class="num"><span class="score-bar" style="--pct:${Math.max(0, Math.min(1, Number(result.score) / 30))}"><b>${result.score}/30</b></span></td>
                  <td class="num strong">${pts.toFixed(2)} pts</td>
                  <td>${result.eliminated ? '<span class="pill pill-out">Eliminated</span>' : '<span class="pill pill-safe">Safe</span>'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </section>`;
      }).join('') : '<p>No results have been published yet. Update data/scores.json after each episode, then refresh this page.</p>'}
    </div>`;

  $('refresh-scores').onclick = () => refreshOracleScores(false);
  $('view-scores').querySelectorAll('[data-week]').forEach((b) => {
    b.onclick = () => { selectedWeek = b.dataset.week === 'all' ? 'all' : Number(b.dataset.week); renderScores(); };
  });
}

/* ---------- shell ---------- */
function showView(view, { updateHash = true } = {}) {
  if (!VIEWS.includes(view)) view = 'rankings';
  activeView = view;
  VIEWS.forEach((name) => {
    $(`view-${name}`).classList.toggle('hidden', name !== view);
    const btn = document.querySelector(`[data-view="${name}"]`);
    btn?.classList.toggle('active', name === view);
    btn?.setAttribute('aria-current', name === view ? 'page' : 'false');
  });
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
}

function render() {
  renderLeague();
  renderDraft();
  renderRankings();
  renderScores();
  showView(activeView, { updateHash: false });
}

function stagingBadge() {
  if (!ENV.isStaging) return;
  document.documentElement.classList.add('is-staging');
  const badge = document.createElement('p');
  badge.className = 'staging-badge';
  badge.setAttribute('role', 'note');
  badge.innerHTML = '<b>Staging preview</b><span>test copy · not the live league</span>';
  document.querySelector('.brand')?.prepend(badge);
  document.title = `[Staging] ${document.title}`;
}

async function init() {
  stagingBadge();
  [season, scores] = await Promise.all([
    fetch(ENV.dataUrl('season.json')).then((response) => response.json()),
    fetch(ENV.dataUrl('scores.json')).then((response) => response.json()).catch(() => ({ weeks: [] }))
  ]);
  lastLoadedAt = new Date();
  try {
    league = await loadPublishedLeague();
  } catch (error) {
    console.warn('Official league file was unavailable. Loading this browser’s local draft instead.', error);
    league = loadLeague();
  }
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.onclick = () => { showView(button.dataset.view); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  });
  const fromHash = location.hash.replace('#', '');
  if (VIEWS.includes(fromHash)) activeView = fromHash;
  window.addEventListener('hashchange', () => showView(location.hash.replace('#', ''), { updateHash: false }));
  render();
  document.body.classList.add('ready');
  setInterval(() => refreshOracleScores(true), 60000);
}

init();
