const STORAGE_KEY = 'dwts-draft-v3';
const RESET_CODE = '0000';
const LOCK_CODE = '0000';

let season;
let scores;
let league;
let activeView = 'rankings';
let playerFilter = 'all';
let rankSort = { key: 'points', dir: 'desc' };

const $ = (id) => document.getElementById(id);

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safe(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function freshLeague() {
  return {
    name: '',
    teams: [],
    picks: [],
    started: false,
    paused: false,
    completed: false,
    locked: false
  };
}

function loadLeague() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || freshLeague();
    if (typeof data.locked !== 'boolean') {
      data.locked = Boolean(data.completed);
    }
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
  const response = await fetch(`data/league.json?ts=${Date.now()}`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('Unable to load the official league roster.');
  }

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

function teamsLocked() {
  return Boolean(league.locked);
}

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

function allDancers() {
  return season.couples.flatMap((couple) => [
    {
      ...couple.amateur,
      coupleId: couple.id,
      partner: couple.pro.name,
      role: 'amateur'
    },
    {
      ...couple.pro,
      coupleId: couple.id,
      partner: couple.amateur.name,
      role: 'pro'
    }
  ]);
}

function dancer(dancerId) {
  return allDancers().find((person) => person.id === dancerId);
}

function copiesPerDancer() {
  return Number(season.copiesPerDancer || 2);
}

function rosterLimit(role) {
  return Number(season.rosterSize?.[role] || 4);
}

function team(teamId) {
  return league.teams.find((item) => item.id === teamId);
}

function teamPicks(teamId) {
  return league.picks
    .filter((pick) => pick.teamId === teamId)
    .map((pick) => ({ ...pick, ...dancer(pick.dancerId) }));
}

function countRole(teamId, role) {
  return teamPicks(teamId).filter((pick) => pick.role === role).length;
}

function copiesUsed(dancerId) {
  return league.picks.filter((pick) => pick.dancerId === dancerId).length;
}

function teamAlreadyHas(teamId, dancerId) {
  return league.picks.some(
    (pick) => pick.teamId === teamId && pick.dancerId === dancerId
  );
}

function draftOrder() {
  const ids = league.teams.map((item) => item.id);
  const total = ids.length * (rosterLimit('amateur') + rosterLimit('pro'));
  const order = [];

  if (!ids.length) return order;

  for (let round = 0; order.length < total; round += 1) {
    const thisRound = round % 2 === 0 ? ids : [...ids].reverse();

    thisRound.forEach((teamId) => {
      if (order.length < total) order.push(teamId);
    });
  }

  return order;
}

function onClockId() {
  if (!league.started || league.paused || league.completed || teamsLocked()) {
    return null;
  }
  return draftOrder()[league.picks.length] || null;
}

function onClockTeam() {
  return team(onClockId());
}

function currentRound() {
  return Math.floor(
    league.picks.length / Math.max(league.teams.length, 1)
  ) + 1;
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

  league.teams.push({
    id: id('team'),
    name: `Team ${league.teams.length + 1}`
  });

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

  [league.teams[index], league.teams[target]] = [
    league.teams[target],
    league.teams[index]
  ];

  saveLeague();
  render();
}

function saveSetup() {
  if (league.started || teamsLocked()) return;

  league.name = $('league-name')?.value.trim() || '';

  league.teams.forEach((item) => {
    const field = $(`team-${item.id}`);

    if (field) {
      item.name = field.value.trim();
    }
  });

  saveLeague();
}

function setupComplete() {
  return (
    league.name.length > 0 &&
    league.teams.length >= 2 &&
    league.teams.every((item) => item.name.length > 0)
  );
}

function startDraft() {
  saveSetup();

  if (!setupComplete()) {
    alert(
      'Enter a draft name, add at least two teams, and give every team a name.'
    );
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

  if (!confirm(`Draft ${person.name} (copy ${copy}) to ${clock.name}?`)) {
    return;
  }

  league.picks.push({
    id: id('pick'),
    overall: league.picks.length + 1,
    round: currentRound(),
    teamId: clock.id,
    dancerId,
    copy
  });

  if (league.picks.length === draftOrder().length) {
    league.completed = true;
    league.locked = true;
  }

  saveLeague();
  render();
}

function undoPick() {
  if (teamsLocked()) {
    alert('Teams are locked. Unlock with the code first.');
    return;
  }

  if (!league.picks.length) {
    alert('No picks have been made yet.');
    return;
  }

  const last = league.picks.at(-1);
  const person = dancer(last.dancerId);

  if (!confirm(`Undo ${person.name}, copy ${last.copy}?`)) return;

  league.picks.pop();
  league.completed = false;
  league.paused = false;

  saveLeague();
  render();
}

function pauseDraft() {
  if (teamsLocked()) return;
  league.paused = true;
  saveLeague();
  render();
}

function resumeDraft() {
  if (teamsLocked()) return;
  league.paused = false;
  saveLeague();
  render();
}

function resetLeague() {
  const typed = prompt('Enter reset code:');

  if (typed === null) return;

  if (typed !== RESET_CODE) {
    alert('Incorrect code. Nothing was reset.');
    return;
  }

  if (!confirm('Reset this league? All drafted players will be removed.')) {
    return;
  }

  league = freshLeague();

  saveLeague();
  render();
  showView('league');
}

function coupleScorePoints(score, weekValue) {
  return (Number(score) / 30) * Number(weekValue);
}

function isAlive(coupleId) {
  return !(scores.weeks || []).some((week) =>
    (week.results || []).some(
      (result) => result.coupleId === coupleId && result.eliminated
    )
  );
}

function scoreForTeam(teamId) {
  return (scores.weeks || []).reduce((total, week) => {
    const value = season.roundValues?.[week.week - 1] || 0;

    return total + teamPicks(teamId).reduce((sum, pick) => {
      const result = (week.results || []).find(
        (item) => item.coupleId === pick.coupleId
      );

      return sum + (result ? coupleScorePoints(result.score, value) : 0);
    }, 0);
  }, 0);
}

function maxPossible(teamId) {
  const latestWeek = Math.max(
    0,
    ...(scores.weeks || []).map((week) => Number(week.week) || 0)
  );

  let total = scoreForTeam(teamId);

  teamPicks(teamId)
    .filter((pick) => isAlive(pick.coupleId))
    .forEach(() => {
      season.roundValues
        .slice(latestWeek)
        .forEach((value) => {
          total += value;
        });
    });

  return total;
}

function roleLabel(role) {
  return role === 'amateur' ? 'Amateur' : 'Pro';
}

function scoringFormatText() {
  const values = (season.roundValues || []).join(', ');
  return `
    <div id="scoring-format" class="card hidden">
      <h3>How scoring works</h3>
      <p>Weekly scores are entered from confirmed published Dancing with the Stars judge totals and results.</p>
      <p>Each drafted dancer earns:</p>
      <p><b>(couple score ÷ 30) × that week’s round value</b></p>
      <p>A perfect 30/30 earns the full round value. The celebrity and professional from the same couple each earn the full result for their own drafted copy; points are not split in half.</p>
      <p>Round values: ${safe(values)}</p>
      <p>Max possible assumes every dancer whose couple is still alive scores a perfect 30 for every remaining week.</p>
      <p>Eliminated couples stop scoring after the week they go home.</p>
    </div>
  `;
}

function renderBoard() {
  const rounds = Array.from({ length: 8 }, (_, index) => index + 1);
  const teamCount = Math.max(league.teams.length, 1);

  const teamHeaders = league.started
    ? league.teams.map((item) => `
        <span title="${safe(item.name)}">${safe(item.name)}</span>
      `).join('')
    : '';

  const columns = league.teams.map((item) => `
    <div class="board-team-column">
      <div class="board-team-name">${safe(item.name)}</div>
      ${rounds.map((round) => {
        const pick = league.picks.find(
          (entry) => entry.teamId === item.id && entry.round === round
        );

        const person = pick ? dancer(pick.dancerId) : null;

        return `
          <div class="board-slot ${person?.role || 'empty'}">
            ${
              person
                ? `<b>${safe(person.name)}</b><span>${roleLabel(person.role)}</span>`
                : ''
            }
          </div>
        `;
      }).join('')}
    </div>
  `).join('');

  return `
    <div class="board-scroll">
      <div class="draft-board">
        <img
          src="1.png"
          alt="Draft the Stars draft board"
          class="board-image"
        >

        ${
          league.started
            ? `
              <div
                class="board-team-header"
                style="--team-count:${teamCount}"
              >
                ${teamHeaders}
              </div>
            `
            : ''
        }

        <div
          class="board-overlay"
          style="--team-count:${teamCount}"
        >
          ${columns}
        </div>
      </div>
    </div>
  `;
}

function copyButton(person, copy) {
  const taken = league.picks.some(
    (pick) => pick.dancerId === person.id && pick.copy === copy
  );

  const clickable = !taken && canDraft(person.id);

  return `
    <button
      class="copy-button ${taken ? 'picked' : ''}"
      data-dancer="${person.id}"
      data-copy="${copy}"
      ${clickable ? '' : 'disabled'}
    >
      ${taken ? 'Picked' : `Draft ${copy}`}
    </button>
  `;
}

function dancerHalf(person) {
  const used = copiesUsed(person.id);
  const fullyDrafted = used >= copiesPerDancer();

  return `
    <div class="dancer-half ${person.role} ${fullyDrafted ? 'fully-drafted' : ''}">
      <span class="role-chip">${roleLabel(person.role)}</span>
      <strong>${safe(person.name)}</strong>
      <span class="partner-name">Partner: ${safe(person.partner)}</span>

      <div class="copy-buttons">
        ${copyButton(person, 1)}
        ${copyButton(person, 2)}
      </div>

      <span class="availability ${fullyDrafted ? 'gone' : used ? 'one-left' : ''}">
        ${
          fullyDrafted
            ? 'All copies selected'
            : used
              ? '1 copy remaining'
              : '2 copies available'
        }
      </span>
    </div>
  `;
}

function renderPool() {
  return season.couples.map((couple) => {
    const people = [
      {
        ...couple.amateur,
        role: 'amateur',
        partner: couple.pro.name
      },
      {
        ...couple.pro,
        role: 'pro',
        partner: couple.amateur.name
      }
    ].filter(
      (person) => playerFilter === 'all' || playerFilter === person.role
    );

    if (!people.length) return '';

    return `
      <article class="couple-bubble">
        <div class="couple-heading">
          ${safe(couple.amateur.name)}
          <span>×</span>
          ${safe(couple.pro.name)}
        </div>

        <div class="couple-halves">
          ${people.map(dancerHalf).join('')}
        </div>
      </article>
    `;
  }).join('');
}

function lockButtons() {
  return `
    ${
      teamsLocked()
        ? '<button id="unlock-teams">Unlock teams</button>'
        : '<button id="lock-teams">Lock teams</button>'
    }
  `;
}

function bindLockButtons() {
  if ($('lock-teams')) $('lock-teams').onclick = lockTeams;
  if ($('unlock-teams')) $('unlock-teams').onclick = unlockTeams;
}

function renderDraft() {
  const clock = onClockTeam();
  const pickNumber = league.picks.length + 1;

  const status = league.completed
    ? teamsLocked()
      ? 'Draft complete · teams locked'
      : 'Draft complete'
    : league.paused
      ? 'Draft paused'
      : league.started
        ? `On the clock: ${clock?.name || ''}`
        : 'Draft has not started';

  $('view-draft').innerHTML = `
    <div class="card draft-status-card">
      <div>
        <p class="eyebrow">
          ${
            league.started
              ? `Pick ${pickNumber} · Round ${currentRound()}`
              : 'Commissioner draft room'
          }
        </p>

        <h2>${safe(status)}</h2>

        <p class="muted">
          ${
            league.started && clock
              ? `${clock.name}: ${countRole(clock.id, 'amateur')}/4 amateurs · ${countRole(clock.id, 'pro')}/4 pros`
              : teamsLocked()
                ? 'Teams and pick data are locked. Use the code to unlock.'
                : 'Set up the league, set the order, then start the snake draft.'
          }
        </p>
      </div>

      <div class="draft-toolbar">
        ${
          !league.started && !teamsLocked()
            ? `
              <button
                class="primary"
                id="start-from-draft"
                ${setupComplete() ? '' : 'disabled'}
              >
                Start Draft
              </button>
            `
            : ''
        }

        ${
          league.started && !league.completed && !league.paused && !teamsLocked()
            ? '<button id="pause-draft">Pause</button>'
            : ''
        }

        ${
          league.paused && !teamsLocked()
            ? '<button class="primary" id="resume-draft">Resume</button>'
            : ''
        }

        ${
          league.started && league.picks.length && !teamsLocked()
            ? '<button class="oops" id="undo-pick">OOPS · Undo last pick</button>'
            : ''
        }

        ${lockButtons()}
        <button class="reset" id="reset-league">Reset league</button>
      </div>
    </div>

    ${renderBoard()}

    <div class="card pool-header">
      <div>
        <h2>Available dancers</h2>
        <p class="muted">
          Click Draft 1 or Draft 2 for the dancer copy being selected. A picked
          button greys out; both picks grey out the entire dancer half.
        </p>
      </div>

      <label>
        Show
        <select id="player-filter">
          <option value="all">All dancers</option>
          <option value="amateur">Amateurs</option>
          <option value="pro">Pros</option>
        </select>
      </label>
    </div>

    <div class="couple-grid">
      ${renderPool()}
    </div>
  `;

  $('player-filter').value = playerFilter;

  $('player-filter').onchange = (event) => {
    playerFilter = event.target.value;
    renderDraft();
  };

  if ($('start-from-draft')) {
    $('start-from-draft').onclick = startDraft;
  }

  if ($('pause-draft')) {
    $('pause-draft').onclick = pauseDraft;
  }

  if ($('resume-draft')) {
    $('resume-draft').onclick = resumeDraft;
  }

  if ($('undo-pick')) {
    $('undo-pick').onclick = undoPick;
  }

  $('reset-league').onclick = resetLeague;
  bindLockButtons();

  $('view-draft')
    .querySelectorAll('[data-dancer]')
    .forEach((button) => {
      button.onclick = () => draftCopy(button.dataset.dancer);
    });
}

function renderLeague() {
  const locked = league.started || teamsLocked();

  $('view-league').innerHTML = `
    <div class="card">
      <p class="eyebrow">Before the draft</p>

      <h2>League setup</h2>

      <label>
        Draft name
        <input
          id="league-name"
          value="${safe(league.name)}"
          placeholder="Example: Girls' DWTS Draft"
          ${locked ? 'disabled' : ''}
        >
      </label>

      <p class="muted">
        The draft name is shown at the top of Rankings.
        ${teamsLocked() ? ' Teams are locked until the lock code is entered.' : ''}
      </p>

      <h3>First-round order</h3>

      <p class="muted">
        Top to bottom is Round 1. The order reverses automatically in every
        following round.
      </p>

      <div class="team-setup-list">
        ${league.teams.map((item, index) => `
          <div class="team-setup-row">
            <span class="order-number">${index + 1}</span>

            <input
              id="team-${item.id}"
              value="${safe(item.name)}"
              ${locked ? 'disabled' : ''}
            >

            <button
              data-up="${index}"
              ${locked || index === 0 ? 'disabled' : ''}
            >
              ↑
            </button>

            <button
              data-down="${index}"
              ${locked || index === league.teams.length - 1 ? 'disabled' : ''}
            >
              ↓
            </button>

            <button
              data-remove="${item.id}"
              ${locked ? 'disabled' : ''}
            >
              Remove
            </button>
          </div>
        `).join('')}
      </div>

      <div class="row">
        <button id="save-setup" ${locked ? 'disabled' : ''}>
          Save setup
        </button>

        <button
          id="add-team"
          ${locked || league.teams.length >= 8 ? 'disabled' : ''}
        >
          Add team
        </button>

        <button
          class="primary"
          id="start-draft"
          ${locked ? 'disabled' : ''}
        >
          Start Draft
        </button>

        ${lockButtons()}
      </div>
    </div>
  `;

  $('save-setup').onclick = () => {
    saveSetup();
    render();
  };

  $('add-team').onclick = addTeam;
  $('start-draft').onclick = startDraft;
  bindLockButtons();

  $('view-league')
    .querySelectorAll('[data-up]')
    .forEach((button) => {
      button.onclick = () => {
        moveTeam(Number(button.dataset.up), -1);
      };
    });

  $('view-league')
    .querySelectorAll('[data-down]')
    .forEach((button) => {
      button.onclick = () => {
        moveTeam(Number(button.dataset.down), 1);
      };
    });

  $('view-league')
    .querySelectorAll('[data-remove]')
    .forEach((button) => {
      button.onclick = () => {
        removeTeam(button.dataset.remove);
      };
    });
}

function sortMark(key) {
  if (rankSort.key !== key) return '';
  return rankSort.dir === 'desc' ? ' ▾' : ' ▴';
}

function setRankSort(key) {
  if (rankSort.key === key) {
    rankSort.dir = rankSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    rankSort.key = key;
    rankSort.dir = 'desc';
  }
  renderRankings();
}

function renderRankings() {
  const direction = rankSort.dir === 'asc' ? 1 : -1;

  const teams = league.teams
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

  $('view-rankings').innerHTML = `
    <div class="card">
      <p class="eyebrow">${safe(league.name || 'Untitled draft')}</p>

      <h2>Rankings</h2>

      <p class="muted">
        Results and rosters for this saved draft.
        <button type="button" id="toggle-scoring">How scoring works</button>
      </p>

      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th><button type="button" class="sort-head" data-sort="points">Points${sortMark('points')}</button></th>
              <th><button type="button" class="sort-head" data-sort="alive">Alive${sortMark('alive')}</button></th>
              <th><button type="button" class="sort-head" data-sort="mpp">Max possible${sortMark('mpp')}</button></th>
              <th>Roster</th>
            </tr>
          </thead>

          <tbody>
            ${teams.map((item, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${safe(item.name)}</td>
                <td>${item.points.toFixed(2)}</td>
                <td>${item.alive}/${item.picks.length}</td>
                <td>${item.mpp.toFixed(2)}</td>
                <td>
                  ${
                    item.picks
                      .map(
                        (pick) => `
                          <span class="roster-chip ${pick.role} ${isAlive(pick.coupleId) ? '' : 'eliminated'}">
                            ${safe(pick.name)}
                          </span>
                        `
                      )
                      .join('') || '—'
                  }
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${scoringFormatText()}
  `;

  $('toggle-scoring').onclick = () => {
    $('scoring-format')?.classList.toggle('hidden');
  };

  $('view-rankings').querySelectorAll('[data-sort]').forEach((button) => {
    button.onclick = () => setRankSort(button.dataset.sort);
  });
}

async function refreshOracleScores(silent) {
  try {
    const response = await fetch(`data/scores.json?ts=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Unable to load published weekly scores.');
    }

    const next = await response.json();
    const before = JSON.stringify(scores);
    const after = JSON.stringify(next);
    scores = next;

    if (!silent || before !== after) render();
  } catch {
    if (!silent) alert('Could not load the published weekly scores yet.');
  }
}

function renderScores() {
  const weeks = scores.weeks || [];
  const source = scores.source || 'confirmed published weekly results';

  $('view-scores').innerHTML = `
    <div class="card">
      <h2>Weekly scores</h2>

      <p class="muted">
        Each dancer earns (couple score ÷ 30) × that round’s value.
        Scores are loaded from the published weekly results file (${safe(source)}).
      </p>

      <div class="row">
        <button id="refresh-scores">Refresh published scores</button>
      </div>

      ${
        weeks.length
          ? weeks.map((week) => `
              <h3>Week ${week.week}</h3>

              <table>
                <tbody>
                  ${week.results.map((result) => {
                    const couple = season.couples.find(
                      (item) => item.id === result.coupleId
                    );
                    const value = season.roundValues?.[week.week - 1] || 0;
                    const pts = coupleScorePoints(result.score, value);

                    return `
                      <tr>
                        <td>
                          ${safe(couple?.amateur.name)}
                          /
                          ${safe(couple?.pro.name)}
                        </td>
                        <td>${result.score}/30</td>
                        <td>${pts.toFixed(2)} pts</td>
                        <td>${result.eliminated ? 'Eliminated' : 'Safe'}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `).join('')
          : '<p>No results have been published yet. Update data/scores.json after each episode, then refresh this page.</p>'
      }
    </div>
  `;

  $('refresh-scores').onclick = () => refreshOracleScores(false);
}

function showView(view) {
  activeView = view;

  ['rankings', 'draft', 'scores', 'league'].forEach((name) => {
    $(`view-${name}`).classList.toggle('hidden', name !== view);

    document
      .querySelector(`[data-view="${name}"]`)
      ?.classList.toggle('active', name === view);
  });
}

function render() {
  renderLeague();
  renderDraft();
  renderRankings();
  renderScores();
  showView(activeView);
}

async function init() {
  [season, scores] = await Promise.all([
    fetch('data/season.json').then((response) => response.json()),
    fetch('data/scores.json')
      .then((response) => response.json())
      .catch(() => ({ weeks: [] }))
  ]);

  try {
    league = await loadPublishedLeague();
  } catch (error) {
    console.warn(
      'Official league file was unavailable. Loading this browser’s local draft instead.',
      error
    );
    league = loadLeague();
  }

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.onclick = () => showView(button.dataset.view);
  });

  render();
  setInterval(() => refreshOracleScores(true), 60000);
}

init();
