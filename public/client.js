// ============================================================================
//  THE RESISTANCE — Client
//  Toute la logique de jeu réside côté serveur : ce fichier ne fait que
//  refléter l'état reçu (roomUpdate) et transmettre les actions du joueur.
// ============================================================================

const socket = io();

// ---------------------------------------------------------------------------
//  Références DOM
// ---------------------------------------------------------------------------
const el = (id) => document.getElementById(id);

const screens = {
  home: el('screen-home'),
  lobby: el('screen-lobby'),
  game: el('screen-game'),
  end: el('screen-end'),
};

const dom = {
  inputName: el('input-name'),
  inputCode: el('input-code'),
  btnCreate: el('btn-create'),
  btnJoin: el('btn-join'),

  lobbyCode: el('lobby-code'),
  lobbyPlayerList: el('lobby-player-list'),
  lobbyStatus: el('lobby-status'),
  btnStartGame: el('btn-start-game'),
  hostOnlyMsg: el('host-only-msg'),
  btnCopyCode: el('btn-copy-code'),
  btnLeaveLobby: el('btn-leave-lobby'),

  gameCode: el('game-code'),
  missionTrack: el('mission-track'),
  gamePlayerList: el('game-player-list'),
  myRoleBox: el('my-role-box'),
  myRoleBadge: el('my-role-badge'),
  myRoleMates: el('my-role-mates'),
  mainPanel: el('main-panel'),

  btnToggleLog: el('btn-toggle-log'),
  btnCloseLog: el('btn-close-log'),
  logDrawer: el('log-drawer'),
  logContent: el('log-content'),

  endCard: el('end-card'),
  endCardFlag: el('end-card-flag'),
  endTitle: el('end-title'),
  endReason: el('end-reason'),
  endRecap: el('end-recap'),
  btnBackLobby: el('btn-back-lobby'),
  endHostHint: el('end-host-hint'),

  roleModalOverlay: el('role-modal-overlay'),
  roleModalTitle: el('role-modal-title'),
  roleModalDesc: el('role-modal-desc'),
  roleModalMates: el('role-modal-mates'),
  btnCloseRoleModal: el('btn-close-role-modal'),

  toast: el('toast'),
};

// ---------------------------------------------------------------------------
//  État local (UI uniquement — la vérité vient du serveur)
// ---------------------------------------------------------------------------
let latestState = null;
let selectedTeam = [];
let roleModalShown = false;
let lastLoggedCount = 0;

function showScreen(name) {
  Object.entries(screens).forEach(([key, node]) => {
    node.dataset.active = key === name ? 'true' : 'false';
  });
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.dataset.visible = 'true';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { dom.toast.dataset.visible = 'false'; }, 3200);
}

// ---------------------------------------------------------------------------
//  ÉCRAN ACCUEIL
// ---------------------------------------------------------------------------
dom.btnCreate.addEventListener('click', () => {
  const name = dom.inputName.value.trim();
  if (!name) return showToast('Entrez un pseudo avant de continuer.');
  socket.emit('createRoom', { name });
});

dom.btnJoin.addEventListener('click', () => {
  const name = dom.inputName.value.trim();
  const code = dom.inputCode.value.trim();
  if (!name) return showToast('Entrez un pseudo avant de continuer.');
  if (code.length !== 4) return showToast('Le code de la Room contient 4 lettres.');
  socket.emit('joinRoom', { name, code });
});

dom.inputCode.addEventListener('input', () => {
  dom.inputCode.value = dom.inputCode.value.toUpperCase().replace(/[^A-Z]/g, '');
});

[dom.inputName, dom.inputCode].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (dom.inputCode.value.trim()) dom.btnJoin.click();
      else dom.btnCreate.click();
    }
  });
});

// ---------------------------------------------------------------------------
//  LOBBY
// ---------------------------------------------------------------------------
dom.btnStartGame.addEventListener('click', () => socket.emit('startGame'));

dom.btnCopyCode.addEventListener('click', () => {
  if (!latestState) return;
  navigator.clipboard?.writeText(latestState.code).then(() => showToast('Code copié !'));
});

dom.btnLeaveLobby.addEventListener('click', () => window.location.reload());

// ---------------------------------------------------------------------------
//  JOURNAL
// ---------------------------------------------------------------------------
dom.btnToggleLog.addEventListener('click', () => {
  dom.logDrawer.dataset.open = dom.logDrawer.dataset.open === 'true' ? 'false' : 'true';
});
dom.btnCloseLog.addEventListener('click', () => { dom.logDrawer.dataset.open = 'false'; });

// ---------------------------------------------------------------------------
//  MODALE DE RÔLE
// ---------------------------------------------------------------------------
dom.btnCloseRoleModal.addEventListener('click', () => {
  dom.roleModalOverlay.dataset.open = 'false';
});

// ---------------------------------------------------------------------------
//  FIN DE PARTIE
// ---------------------------------------------------------------------------
dom.btnBackLobby.addEventListener('click', () => socket.emit('backToLobby'));

// ---------------------------------------------------------------------------
//  SOCKET — RÉCEPTION DE L'ÉTAT
// ---------------------------------------------------------------------------
socket.on('errorMessage', (msg) => showToast(msg));

socket.on('roomUpdate', (state) => {
  const previousState = latestState;
  latestState = state;

  if (state.state === 'LOBBY') {
    roleModalShown = false;
    lastLoggedCount = state.resultLog.length;
    renderLobby(state);
    showScreen('lobby');
  } else if (state.state === 'GAME_OVER') {
    renderEnd(state);
    showScreen('end');
  } else {
    renderGame(state, previousState);
    showScreen('game');
  }
});

// ============================================================================
//  RENDU — LOBBY
// ============================================================================
function renderLobby(state) {
  dom.lobbyCode.textContent = state.code;

  dom.lobbyPlayerList.innerHTML = state.players.map((p) => `
    <li>
      <span class="dot ${p.connected ? '' : 'dot--off'}"></span>
      <span>${escapeHtml(p.name)}</span>
      ${p.isHost ? '<span class="tag tag--host">Hôte</span>' : ''}
      ${p.id === state.myId ? '<span class="tag tag--you">Vous</span>' : ''}
    </li>
  `).join('');

  const count = state.players.length;
  if (count < 5) {
    dom.lobbyStatus.textContent = `${count} agent(s) connecté(s) — minimum 5 requis.`;
  } else if (count > 10) {
    dom.lobbyStatus.textContent = `${count} agents connectés — maximum 10.`;
  } else {
    dom.lobbyStatus.textContent = `${count} agents connectés — prêt à lancer l'opération.`;
  }

  const isHost = state.myId === state.hostId;
  dom.btnStartGame.style.display = isHost ? 'block' : 'none';
  dom.hostOnlyMsg.style.display = isHost ? 'none' : 'block';
  dom.btnStartGame.disabled = !(count >= 5 && count <= 10);
}

// ============================================================================
//  RENDU — PARTIE
// ============================================================================
function renderGame(state, previousState) {
  dom.gameCode.textContent = state.code;
  renderMissionTrack(state);
  renderRoster(state);
  renderMyRole(state);
  renderMainPanel(state);
  renderLog(state);
  maybeShowRoleModal(state, previousState);

  if (state.state === 'TEAM_SELECT') {
    // reset la sélection à chaque nouvelle proposition
    if (!previousState || previousState.proposalNumber !== state.proposalNumber || previousState.round !== state.round || previousState.state !== 'TEAM_SELECT') {
      selectedTeam = [];
    }
  }
}

function renderMissionTrack(state) {
  const pips = state.missionSizes.map((size, idx) => {
    const roundNum = idx + 1;
    const history = state.missionHistory[idx];
    let status = 'pending';
    if (history) status = history.result;
    else if (roundNum === state.round) status = 'current';

    const needsTwo = state.failsNeeded[idx] === 2;
    return `
      <div class="mission-pip" data-status="${status}" title="Mission ${roundNum} — ${size} agent(s)">
        ${size}
        ${needsTwo ? '<span class="double-fail-marker">2 échecs</span>' : ''}
      </div>
    `;
  }).join('');
  dom.missionTrack.innerHTML = pips;
}

function renderRoster(state) {
  const showTeamTag = ['TEAM_VOTE', 'MISSION', 'MISSION_RESULT'].includes(state.state);
  dom.gamePlayerList.innerHTML = state.players.map((p) => `
    <li data-leader="${p.id === state.leaderId}">
      <span class="dot ${p.connected ? '' : 'dot--off'}"></span>
      <span>${escapeHtml(p.name)}</span>
      ${p.id === state.leaderId ? '<span class="tag tag--leader">Leader</span>' : ''}
      ${showTeamTag && state.currentTeam.includes(p.id) ? '<span class="tag tag--onmission">Mission</span>' : ''}
      ${p.id === state.myId ? '<span class="tag tag--you">Vous</span>' : ''}
    </li>
  `).join('');
}

function renderMyRole(state) {
  if (!state.myRole) {
    dom.myRoleBadge.textContent = '—';
    dom.myRoleMates.textContent = '';
    return;
  }
  dom.myRoleBadge.dataset.role = state.myRole;
  dom.myRoleBadge.textContent = state.myRole === 'spy' ? 'ESPION' : 'RÉSISTANT';
  dom.myRoleMates.textContent = state.myRole === 'spy' && state.spyMates.length
    ? `Co-espion(s) : ${state.spyMates.join(', ')}`
    : '';
}

function renderLog(state) {
  dom.logContent.innerHTML = state.resultLog.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  if (state.resultLog.length > lastLoggedCount) {
    dom.logContent.scrollTop = dom.logContent.scrollHeight;
  }
  lastLoggedCount = state.resultLog.length;
}

function renderMainPanel(state) {
  switch (state.state) {
    case 'TEAM_SELECT': return renderTeamSelect(state);
    case 'TEAM_VOTE': return renderTeamVote(state);
    case 'MISSION': return renderMission(state);
    case 'MISSION_RESULT': return renderMissionResult(state);
    default: dom.mainPanel.innerHTML = '';
  }
}

function renderTeamSelect(state) {
  const requiredSize = state.missionSizes[state.round - 1];
  const isLeader = state.myId === state.leaderId;

  if (!isLeader) {
    const leaderName = state.players.find((p) => p.id === state.leaderId)?.name || '???';
    dom.mainPanel.innerHTML = `
      <h2 class="phase-title">Sélection de l'équipe — Mission ${state.round}</h2>
      <p class="phase-sub">Le Leader <strong>${escapeHtml(leaderName)}</strong> doit choisir ${requiredSize} agent(s) pour cette mission (proposition ${state.proposalNumber}/5).</p>
      <div class="waiting-box"><div class="spinner"></div>En attente de la proposition du Leader…</div>
    `;
    return;
  }

  dom.mainPanel.innerHTML = `
    <h2 class="phase-title">Composez l'équipe — Mission ${state.round}</h2>
    <p class="phase-sub">Sélectionnez exactement <strong>${requiredSize}</strong> agent(s) (proposition ${state.proposalNumber}/5). En cas de 5 rejets consécutifs, les Espions gagnent.</p>
    <div class="team-picker" id="team-picker"></div>
    <div class="action-row">
      <button class="btn btn--primary" id="btn-propose-team" disabled>Proposer l'équipe</button>
    </div>
  `;

  const picker = el('team-picker');
  picker.innerHTML = state.players.map((p) => `
    <button class="team-chip" data-id="${p.id}" data-selected="${selectedTeam.includes(p.id)}">${escapeHtml(p.name)}</button>
  `).join('');

  picker.querySelectorAll('.team-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.id;
      if (selectedTeam.includes(id)) {
        selectedTeam = selectedTeam.filter((x) => x !== id);
      } else {
        if (selectedTeam.length >= requiredSize) return;
        selectedTeam.push(id);
      }
      renderTeamSelect(state);
    });
  });

  const btnPropose = el('btn-propose-team');
  btnPropose.disabled = selectedTeam.length !== requiredSize;
  btnPropose.addEventListener('click', () => {
    socket.emit('proposeTeam', { team: selectedTeam });
  });
}

function renderTeamVote(state) {
  const teamNames = state.currentTeam.map((id) => state.players.find((p) => p.id === id)?.name || '?');
  const leaderName = state.players.find((p) => p.id === state.leaderId)?.name || '???';

  let actionHtml;
  if (state.hasVotedTeam) {
    actionHtml = `<div class="waiting-box"><div class="spinner"></div>Vote enregistré. En attente des autres agents (${state.teamVoteCount}/${state.players.length})…</div>`;
  } else {
    actionHtml = `
      <div class="vote-choice">
        <button class="vote-btn vote-btn--approve" id="btn-vote-yes">✔ POUR</button>
        <button class="vote-btn vote-btn--reject" id="btn-vote-no">✘ CONTRE</button>
      </div>
    `;
  }

  dom.mainPanel.innerHTML = `
    <h2 class="phase-title">Vote d'équipe — Mission ${state.round}</h2>
    <p class="phase-sub">Le Leader <strong>${escapeHtml(leaderName)}</strong> propose : <strong>${teamNames.map(escapeHtml).join(', ')}</strong></p>
    <p class="phase-sub">Proposition ${state.proposalNumber}/5. Une majorité de "Pour" est nécessaire.</p>
    ${actionHtml}
  `;

  if (!state.hasVotedTeam) {
    el('btn-vote-yes').addEventListener('click', () => socket.emit('voteTeam', { vote: true }));
    el('btn-vote-no').addEventListener('click', () => socket.emit('voteTeam', { vote: false }));
  }
}

function renderMission(state) {
  const teamNames = state.currentTeam.map((id) => state.players.find((p) => p.id === id)?.name || '?');

  let actionHtml;
  if (!state.isOnMission) {
    actionHtml = `<div class="waiting-box"><div class="spinner"></div>Les agents en mission votent secrètement…</div>`;
  } else if (state.hasVotedMission) {
    actionHtml = `<div class="waiting-box"><div class="spinner"></div>Vote transmis. En attente des autres agents en mission (${state.missionVoteCount}/${state.currentTeam.length})…</div>`;
  } else if (state.myRole === 'spy') {
    actionHtml = `
      <div class="vote-choice">
        <button class="vote-btn vote-btn--success" id="btn-mission-success">SUCCÈS</button>
        <button class="vote-btn vote-btn--fail" id="btn-mission-fail">ÉCHEC</button>
      </div>
    `;
  } else {
    actionHtml = `
      <div class="vote-choice">
        <button class="vote-btn vote-btn--success" id="btn-mission-success">SUCCÈS</button>
      </div>
      <p class="hint">En tant que Résistant, vous ne pouvez voter que SUCCÈS.</p>
    `;
  }

  dom.mainPanel.innerHTML = `
    <h2 class="phase-title">Mission ${state.round} en cours</h2>
    <p class="phase-sub">Équipe engagée : <strong>${teamNames.map(escapeHtml).join(', ')}</strong></p>
    ${actionHtml}
  `;

  if (state.isOnMission && !state.hasVotedMission) {
    el('btn-mission-success').addEventListener('click', () => socket.emit('voteMission', { vote: 'success' }));
    const failBtn = el('btn-mission-fail');
    if (failBtn) failBtn.addEventListener('click', () => socket.emit('voteMission', { vote: 'fail' }));
  }
}

function renderMissionResult(state) {
  const last = state.missionHistory[state.missionHistory.length - 1];
  const isHost = state.myId === state.hostId;
  const successCount = state.missionHistory.filter((m) => m.result === 'success').length;
  const failCount = state.missionHistory.filter((m) => m.result === 'fail').length;

  dom.mainPanel.innerHTML = `
    <h2 class="phase-title">Résultat de la Mission ${last.round}</h2>
    <div class="result-banner ${last.result === 'success' ? 'result-banner--success' : 'result-banner--fail'}">
      ${last.result === 'success' ? 'MISSION RÉUSSIE' : 'MISSION ÉCHOUÉE'} — ${last.fails} échec(s) sur ${last.size} votes
    </div>
    <div class="mission-team-recap">${last.team.map((n) => `<span>${escapeHtml(n)}</span>`).join('')}</div>
    <p class="phase-sub">Score actuel — Résistance : ${successCount} / 3 &nbsp;|&nbsp; Espions : ${failCount} / 3</p>
    ${isHost
      ? `<div class="action-row"><button class="btn btn--primary" id="btn-continue">Passer à la manche suivante</button></div>`
      : `<div class="waiting-box">En attente de l'hôte pour continuer…</div>`}
  `;

  if (isHost) {
    el('btn-continue').addEventListener('click', () => socket.emit('continueAfterMission'));
  }
}

// ============================================================================
//  RENDU — FIN DE PARTIE
// ============================================================================
function renderEnd(state) {
  dom.endCard.dataset.winner = state.winner;
  dom.endCardFlag.textContent = state.winner === 'resistance' ? 'VICTOIRE DE LA RÉSISTANCE' : 'VICTOIRE DES ESPIONS';
  dom.endTitle.textContent = state.winner === 'resistance' ? 'La Résistance a gagné' : 'Les Espions ont gagné';
  dom.endReason.textContent = state.winReason;

  dom.endRecap.innerHTML = state.missionHistory.map((m) => `
    <div class="end-recap__row">
      <b>M${m.round}</b>
      <span>${m.result === 'success' ? '✔ Réussie' : '✘ Échouée'}</span>
      <span>— ${escapeHtml(m.team.join(', '))}</span>
    </div>
  `).join('');

  const isHost = state.myId === state.hostId;
  dom.btnBackLobby.style.display = isHost ? 'inline-block' : 'none';
  dom.endHostHint.style.display = isHost ? 'none' : 'block';
}

// ============================================================================
//  MODALE DE RÔLE
// ============================================================================
function maybeShowRoleModal(state, previousState) {
  const justStarted = previousState && previousState.state === 'LOBBY' && state.state !== 'LOBBY';
  if ((justStarted || !roleModalShown) && state.myRole) {
    roleModalShown = true;
    dom.roleModalTitle.dataset.role = state.myRole;
    dom.roleModalTitle.textContent = state.myRole === 'spy' ? 'VOUS ÊTES ESPION' : 'VOUS ÊTES RÉSISTANT';
    dom.roleModalDesc.textContent = state.myRole === 'spy'
      ? `Votre mission : saboter secrètement les opérations sans être démasqué. Vous pouvez voter ÉCHEC lors des missions.`
      : `Votre mission : identifier les espions infiltrés et faire réussir 3 missions. Vous ne pouvez voter que SUCCÈS lors des missions.`;
    dom.roleModalMates.textContent = state.myRole === 'spy' && state.spyMates.length
      ? `Vos co-espions : ${state.spyMates.join(', ')}`
      : '';
    dom.roleModalOverlay.dataset.open = 'true';
  }
}

// ============================================================================
//  UTILITAIRES
// ============================================================================
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
