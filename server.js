// ============================================================================
//  THE RESISTANCE — Serveur Node.js / Express / Socket.io
//  Toute la logique de jeu (rôles, votes, missions) vit ici, côté serveur.
//  Le client ne reçoit JAMAIS d'informations qu'il n'est pas censé connaître.
// ============================================================================

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------------------------
//  CONFIGURATION DES MISSIONS SELON LE NOMBRE DE JOUEURS
//  missions: taille d'équipe requise pour chaque manche (1 à 5)
//  failsNeeded: nombre d'échecs nécessaires pour faire échouer la mission
//  spies: nombre d'espions dans la partie
// ----------------------------------------------------------------------------
const GAME_CONFIG = {
  5:  { spies: 2, missions: [2, 3, 2, 3, 3], failsNeeded: [1, 1, 1, 1, 1] },
  6:  { spies: 2, missions: [2, 3, 4, 3, 4], failsNeeded: [1, 1, 1, 1, 1] },
  7:  { spies: 3, missions: [2, 3, 3, 4, 4], failsNeeded: [1, 1, 1, 2, 1] },
  8:  { spies: 3, missions: [3, 4, 4, 5, 5], failsNeeded: [1, 1, 1, 2, 1] },
  9:  { spies: 3, missions: [3, 4, 4, 5, 5], failsNeeded: [1, 1, 1, 2, 1] },
  10: { spies: 4, missions: [3, 4, 4, 5, 5], failsNeeded: [1, 1, 1, 2, 1] },
};

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;
const MAX_REJECTED_PROPOSALS = 5;

// ----------------------------------------------------------------------------
//  ÉTAT EN MÉMOIRE : { code: room }
// ----------------------------------------------------------------------------
const rooms = new Map();

function generateRoomCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocketId, hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId: hostSocketId,
    players: [{ id: hostSocketId, name: hostName, connected: true }],
    state: 'LOBBY', // LOBBY | TEAM_SELECT | TEAM_VOTE | MISSION | MISSION_RESULT | GAME_OVER
    roles: {},          // socketId -> 'resistance' | 'spy'
    leaderIndex: 0,
    round: 1,           // 1..5
    proposalNumber: 1,  // 1..5 (nb de propositions dans la manche en cours)
    currentTeam: [],
    teamVotes: {},       // socketId -> true/false
    missionVotes: {},    // socketId -> 'success'/'fail'
    missionHistory: [],  // [{ round, team:[names], result:'success'/'fail', fails, approvedBy, rejectedProposals }]
    resultLog: [],       // journal texte affiché à tous
    winner: null,        // 'resistance' | 'spy'
    winReason: '',
  };
  rooms.set(code, room);
  return room;
}

function getPlayer(room, socketId) {
  return room.players.find((p) => p.id === socketId);
}

function publicPlayerList(room) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isHost: p.id === room.hostId,
    isLeader: room.players[room.leaderIndex] && room.players[room.leaderIndex].id === p.id,
  }));
}

/**
 * Construit un instantané de l'état de la partie, adapté à un joueur précis
 * (masque les rôles des autres, sauf pour les espions qui voient leurs alliés).
 */
function buildStateForPlayer(room, socketId) {
  const me = getPlayer(room, socketId);
  const myRole = room.roles[socketId] || null;

  let spyMates = [];
  if (myRole === 'spy') {
    spyMates = room.players
      .filter((p) => room.roles[p.id] === 'spy' && p.id !== socketId)
      .map((p) => p.name);
  }

  const config = GAME_CONFIG[room.players.length] || null;

  return {
    code: room.code,
    state: room.state,
    players: publicPlayerList(room),
    hostId: room.hostId,
    myId: socketId,
    myRole,
    spyMates,
    round: room.round,
    proposalNumber: room.proposalNumber,
    missionSizes: config ? config.missions : [],
    failsNeeded: config ? config.failsNeeded : [],
    totalSpies: config ? config.spies : null,
    currentTeam: room.currentTeam,
    leaderId: room.players[room.leaderIndex] ? room.players[room.leaderIndex].id : null,
    teamVoteCount: Object.keys(room.teamVotes).length,
    missionVoteCount: Object.keys(room.missionVotes).length,
    hasVotedTeam: Object.prototype.hasOwnProperty.call(room.teamVotes, socketId),
    hasVotedMission: Object.prototype.hasOwnProperty.call(room.missionVotes, socketId),
    missionHistory: room.missionHistory,
    resultLog: room.resultLog,
    winner: room.winner,
    winReason: room.winReason,
    isOnMission: room.currentTeam.includes(socketId),
  };
}

/** Envoie à chaque joueur de la room son propre instantané d'état. */
function broadcastRoom(room) {
  room.players.forEach((p) => {
    io.to(p.id).emit('roomUpdate', buildStateForPlayer(room, p.id));
  });
}

function log(room, message) {
  room.resultLog.push(message);
  if (room.resultLog.length > 200) room.resultLog.shift();
}

// ----------------------------------------------------------------------------
//  DÉMARRAGE DE PARTIE : attribution des rôles
// ----------------------------------------------------------------------------
function startGame(room) {
  const config = GAME_CONFIG[room.players.length];
  const shuffled = [...room.players].sort(() => Math.random() - 0.5);
  const spies = shuffled.slice(0, config.spies);

  room.roles = {};
  room.players.forEach((p) => {
    room.roles[p.id] = spies.some((s) => s.id === p.id) ? 'spy' : 'resistance';
  });

  room.state = 'TEAM_SELECT';
  room.leaderIndex = Math.floor(Math.random() * room.players.length);
  room.round = 1;
  room.proposalNumber = 1;
  room.currentTeam = [];
  room.teamVotes = {};
  room.missionVotes = {};
  room.missionHistory = [];
  room.resultLog = [];
  room.winner = null;
  room.winReason = '';

  log(room, `La partie commence avec ${room.players.length} joueurs (${config.spies} espion(s) infiltré(s)).`);
  log(room, `${room.players[room.leaderIndex].name} est désigné(e) Leader de la manche 1.`);
}

function nextLeader(room) {
  room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
}

function currentMissionSize(room) {
  const config = GAME_CONFIG[room.players.length];
  return config.missions[room.round - 1];
}

function currentFailsNeeded(room) {
  const config = GAME_CONFIG[room.players.length];
  return config.failsNeeded[room.round - 1];
}

// ----------------------------------------------------------------------------
//  VOTE D'ÉQUIPE
// ----------------------------------------------------------------------------
function resolveTeamVote(room) {
  const approvals = Object.values(room.teamVotes).filter((v) => v === true).length;
  const total = room.players.length;
  const approved = approvals > total / 2;

  const detail = room.players.map((p) => `${p.name}: ${room.teamVotes[p.id] ? 'POUR' : 'CONTRE'}`).join(', ');
  log(room, `Vote d'équipe (proposition ${room.proposalNumber}/${MAX_REJECTED_PROPOSALS}) — ${detail}`);

  if (approved) {
    log(room, `Équipe APPROUVÉE (${approvals}/${total}). La mission ${room.round} commence.`);
    room.state = 'MISSION';
    room.missionVotes = {};
  } else {
    log(room, `Équipe REJETÉE (${approvals}/${total}).`);
    if (room.proposalNumber >= MAX_REJECTED_PROPOSALS) {
      room.winner = 'spy';
      room.winReason = `5 propositions d'équipe consécutives ont été rejetées lors de la manche ${room.round}.`;
      room.state = 'GAME_OVER';
      log(room, `Les Espions remportent la partie : ${room.winReason}`);
    } else {
      room.proposalNumber += 1;
      room.currentTeam = [];
      room.teamVotes = {};
      nextLeader(room);
      room.state = 'TEAM_SELECT';
      log(room, `${room.players[room.leaderIndex].name} devient le nouveau Leader.`);
    }
  }
}

// ----------------------------------------------------------------------------
//  RÉSOLUTION DE MISSION
// ----------------------------------------------------------------------------
function resolveMission(room) {
  const votes = Object.values(room.missionVotes);
  const fails = votes.filter((v) => v === 'fail').length;
  const needed = currentFailsNeeded(room);
  const missionFailed = fails >= needed;

  const teamNames = room.currentTeam.map((id) => getPlayer(room, id).name);

  room.missionHistory.push({
    round: room.round,
    team: teamNames,
    result: missionFailed ? 'fail' : 'success',
    fails,
    size: room.currentTeam.length,
  });

  log(
    room,
    missionFailed
      ? `Mission ${room.round} ÉCHOUÉE (${fails} échec${fails > 1 ? 's' : ''} sur ${votes.length} votes).`
      : `Mission ${room.round} RÉUSSIE (${fails} échec${fails > 1 ? 's' : ''} sur ${votes.length} votes).`
  );

  const successCount = room.missionHistory.filter((m) => m.result === 'success').length;
  const failCount = room.missionHistory.filter((m) => m.result === 'fail').length;

  if (successCount >= 3) {
    room.winner = 'resistance';
    room.winReason = 'La Résistance a fait réussir 3 missions.';
    room.state = 'GAME_OVER';
    log(room, `La Résistance remporte la partie : ${room.winReason}`);
    return;
  }
  if (failCount >= 3) {
    room.winner = 'spy';
    room.winReason = 'Les Espions ont fait échouer 3 missions.';
    room.state = 'GAME_OVER';
    log(room, `Les Espions remportent la partie : ${room.winReason}`);
    return;
  }

  // Manche suivante
  room.state = 'MISSION_RESULT';
}

function advanceToNextRound(room) {
  room.round += 1;
  room.proposalNumber = 1;
  room.currentTeam = [];
  room.teamVotes = {};
  room.missionVotes = {};
  nextLeader(room);
  room.state = 'TEAM_SELECT';
  log(room, `${room.players[room.leaderIndex].name} est désigné(e) Leader de la manche ${room.round}.`);
}

// ----------------------------------------------------------------------------
//  NETTOYAGE DES ROOMS VIDES
// ----------------------------------------------------------------------------
function cleanupRoomIfEmpty(room) {
  const anyoneConnected = room.players.some((p) => p.connected);
  if (!anyoneConnected) {
    rooms.delete(room.code);
  }
}

// ============================================================================
//  SOCKET.IO — GESTION DES ÉVÉNEMENTS
// ============================================================================
io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const cleanName = String(name || '').trim().slice(0, 20);
    if (!cleanName) return socket.emit('errorMessage', 'Merci d\'entrer un pseudo.');

    const room = createRoom(socket.id, cleanName);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ name, code }) => {
    const cleanName = String(name || '').trim().slice(0, 20);
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanName) return socket.emit('errorMessage', 'Merci d\'entrer un pseudo.');

    const room = rooms.get(cleanCode);
    if (!room) return socket.emit('errorMessage', 'Cette Room n\'existe pas.');
    if (room.state !== 'LOBBY') return socket.emit('errorMessage', 'La partie a déjà commencé.');
    if (room.players.length >= MAX_PLAYERS) return socket.emit('errorMessage', 'La Room est complète (10 max).');
    if (room.players.some((p) => p.name.toLowerCase() === cleanName.toLowerCase() && p.connected)) {
      return socket.emit('errorMessage', 'Ce pseudo est déjà pris dans cette Room.');
    }

    room.players.push({ id: socket.id, name: cleanName, connected: true });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    log(room, `${cleanName} a rejoint la Room.`);
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.id !== room.hostId) return socket.emit('errorMessage', 'Seul l\'hôte peut lancer la partie.');
    if (room.state !== 'LOBBY') return;
    if (room.players.length < MIN_PLAYERS) {
      return socket.emit('errorMessage', `Il faut au moins ${MIN_PLAYERS} joueurs pour commencer.`);
    }
    if (room.players.length > MAX_PLAYERS) {
      return socket.emit('errorMessage', `Maximum ${MAX_PLAYERS} joueurs.`);
    }
    startGame(room);
    broadcastRoom(room);
  });

  socket.on('proposeTeam', ({ team }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'TEAM_SELECT') return;
    const leader = room.players[room.leaderIndex];
    if (!leader || leader.id !== socket.id) return socket.emit('errorMessage', 'Vous n\'êtes pas le Leader.');

    const requiredSize = currentMissionSize(room);
    const uniqueTeam = [...new Set(team || [])].filter((id) => room.players.some((p) => p.id === id));
    if (uniqueTeam.length !== requiredSize) {
      return socket.emit('errorMessage', `L'équipe doit contenir exactement ${requiredSize} joueur(s).`);
    }

    room.currentTeam = uniqueTeam;
    room.teamVotes = {};
    room.state = 'TEAM_VOTE';
    const teamNames = uniqueTeam.map((id) => getPlayer(room, id).name).join(', ');
    log(room, `${leader.name} propose l'équipe : ${teamNames}.`);
    broadcastRoom(room);
  });

  socket.on('voteTeam', ({ vote }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'TEAM_VOTE') return;
    if (!getPlayer(room, socket.id)) return;

    room.teamVotes[socket.id] = !!vote;
    broadcastRoom(room);

    if (Object.keys(room.teamVotes).length === room.players.length) {
      resolveTeamVote(room);
      broadcastRoom(room);
    }
  });

  socket.on('voteMission', ({ vote }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'MISSION') return;
    if (!room.currentTeam.includes(socket.id)) return;

    const role = room.roles[socket.id];
    let value = vote === 'fail' ? 'fail' : 'success';
    if (role === 'resistance') value = 'success'; // un Résistant ne peut voter que Succès

    room.missionVotes[socket.id] = value;
    broadcastRoom(room);

    if (Object.keys(room.missionVotes).length === room.currentTeam.length) {
      resolveMission(room);
      broadcastRoom(room);
    }
  });

  socket.on('continueAfterMission', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'MISSION_RESULT') return;
    if (socket.id !== room.hostId) return;
    advanceToNextRound(room);
    broadcastRoom(room);
  });

  socket.on('backToLobby', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    room.state = 'LOBBY';
    room.roles = {};
    room.round = 1;
    room.proposalNumber = 1;
    room.currentTeam = [];
    room.teamVotes = {};
    room.missionVotes = {};
    room.missionHistory = [];
    room.resultLog = [];
    room.winner = null;
    room.winReason = '';
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;

    if (room.state === 'LOBBY') {
      // En lobby, on retire simplement le joueur
      room.players = room.players.filter((p) => p.id !== socket.id);
      if (room.hostId === socket.id && room.players.length > 0) {
        room.hostId = room.players[0].id;
      }
      log(room, `${player.name} a quitté la Room.`);
    } else {
      // En partie, on le marque déconnecté pour ne pas casser les index/rôles
      player.connected = false;
      log(room, `${player.name} s'est déconnecté(e).`);
    }

    cleanupRoomIfEmpty(room);
    if (rooms.has(room.code)) broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Serveur "The Resistance" démarré sur le port ${PORT}`);
});
