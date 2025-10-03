const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function makeRoom(hostSocketId, opts={}) {
  const id = uuidv4().slice(0,6);
  rooms[id] = {
    id,
    host: hostSocketId,
    players: {},
    order: [],
    phase: 'waiting',
    round: 0,
    maxRounds: opts.maxRounds || 3,
    secondsPerTurn: opts.secondsPerTurn || 60,
    mode: opts.mode || 'classic',
    history: [],
    timers: {}
  };
  return rooms[id];
}

function roomSummary(room) {
  return {
    id: room.id,
    host: room.host,
    players: Object.values(room.players).map(p=>({id:p.id,name:p.name})),
    phase: room.phase,
    round: room.round,
    maxRounds: room.maxRounds,
    secondsPerTurn: room.secondsPerTurn,
    mode: room.mode
  };
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('createRoom', (opts, cb) => {
    const room = makeRoom(socket.id, opts||{});
    cb && cb({ok:true, roomId: room.id});
  });

  socket.on('joinRoom', ({roomId, name}, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ok:false, err:'Room not found'});
    if (room.players[socket.id]) return cb && cb({ok:false, err:'Already in room'});
    const player = {id: socket.id, name: name || 'Player'};
    room.players[socket.id] = player;
    room.order.push(socket.id);
    socket.join(roomId);
    io.to(roomId).emit('roomUpdate', roomSummary(room));
    cb && cb({ok:true, room: roomSummary(room)});
  });

  socket.on('leaveRoom', ({roomId}, cb) => {
    leaveRoom(socket, roomId);
    cb && cb({ok:true});
  });

  socket.on('startGame', ({roomId, settings}, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ok:false});
    if (socket.id !== room.host) return cb && cb({ok:false, err:'Only host can start the game'});
    const playerCount = Object.keys(room.players).length;
    if (playerCount < 2) return cb && cb({ok:false, err:'At least 2 players required'});
    if (settings) {
      room.maxRounds = Math.max(1, parseInt(settings.maxRounds)||3);
      room.secondsPerTurn = Math.max(10, parseInt(settings.secondsPerTurn)||60);
      room.mode = settings.mode || room.mode;
    }
    room.phase = 'writing';
    room.round = 1;
    room.history = [];
    io.to(roomId).emit('gameStarted', {phase: room.phase, round: room.round, seconds: room.secondsPerTurn});
    startPhaseTimer(roomId, 'writing');
    cb && cb({ok:true});
  });

  socket.on('submitPrompt', ({roomId, prompt}, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ok:false, err:'Room not found'});
    if (room.phase !== 'writing') return cb && cb({ok:false, err:'Not in writing phase'});
    if (room.history.find(h=>h.owner===socket.id)) return cb && cb({ok:false, err:'You already submitted a prompt'});
    room.history.push({owner: socket.id, sequence:[{type:'prompt', data: prompt}]});
    io.to(roomId).emit('playerSubmitted', {playerId: socket.id, kind:'prompt'});
    cb && cb({ok:true});
    if (room.history.length === Object.keys(room.players).length) moveToDrawing(roomId);
  });

  socket.on('drawingData', ({roomId, targetId, strokes}, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ok:false});
    if (room.phase !== 'drawing') return cb && cb({ok:false, err:'Not in drawing phase'});
    const expectedDrawer = getDrawerForOwner(room, targetId);
    if (expectedDrawer !== socket.id) return cb && cb({ok:false, err:'Not assigned to draw for this player'});
    const entry = room.history.find(h=>h.owner===targetId);
    if (!entry) return cb && cb({ok:false, err:'Entry not found'});
    entry.sequence.push({type:'drawing', owner: socket.id, data: strokes});
    io.to(roomId).emit('playerSubmitted', {playerId: socket.id, kind:'drawing'});
    cb && cb({ok:true});
    const allDrawings = room.history.filter(h=>h.sequence.some(s=>s.type==='drawing')).length;
    if (allDrawings === Object.keys(room.players).length) moveToGuessing(roomId);
  });

  socket.on('submitGuess', ({roomId, targetId, guess}, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ok:false});
    if (room.phase !== 'guessing') return cb && cb({ok:false, err:'Not in guessing phase'});
    const expectedGuesser = getGuesserForOwner(room, targetId);
    if (expectedGuesser !== socket.id) return cb && cb({ok:false, err:'Not assigned to guess for this drawing'});
    const entry = room.history.find(h=>h.owner===targetId);
    if (!entry) return cb && cb({ok:false});
    entry.sequence.push({type:'guess', owner: socket.id, data: guess});
    io.to(roomId).emit('playerSubmitted', {playerId: socket.id, kind:'guess'});
    cb && cb({ok:true});
    const allGuesses = room.history.filter(h=>h.sequence.some(s=>s.type==='guess')).length;
    if (allGuesses === Object.keys(room.players).length) moveToReveal(roomId);
  });

  socket.on('disconnect', () => {
    for (const rid of Object.keys(rooms)) leaveRoom(socket, rid);
  });

  function leaveRoom(socket, roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[socket.id]) {
      delete room.players[socket.id];
      room.order = room.order.filter(id=>id!==socket.id);
      io.to(roomId).emit('roomUpdate', roomSummary(room));
      if (Object.keys(room.players).length === 0) {
        clearPhaseTimer(room);
        delete rooms[roomId];
      } else {
        if (room.host === socket.id) {
          room.host = room.order[0] || null;
          io.to(roomId).emit('roomUpdate', roomSummary(room));
        }
      }
    }
  }

  function getDrawerForOwner(room, ownerId) {
    const idx = room.order.indexOf(ownerId);
    if (idx === -1) return null;
    return room.order[(idx+1) % room.order.length];
  }
  function getGuesserForOwner(room, ownerId) {
    const idx = room.order.indexOf(ownerId);
    if (idx === -1) return null;
    return room.order[(idx+2) % room.order.length];
  }

  function startPhaseTimer(roomId, phase) {
    const room = rooms[roomId];
    if (!room) return;
    clearPhaseTimer(room);
    const seconds = room.secondsPerTurn;
    room.timers.phase = { phase, remaining: seconds };
    io.to(roomId).emit('timerStart', {phase, seconds});
    room.timers.interval = setInterval(()=>{
      room.timers.phase.remaining--;
      io.to(roomId).emit('timerTick', {phase, remaining: room.timers.phase.remaining});
      if (room.timers.phase.remaining <= 0) {
        clearPhaseTimer(room);
        if (phase === 'writing') moveToDrawing(roomId);
        else if (phase === 'drawing') moveToGuessing(roomId);
        else if (phase === 'guessing') moveToReveal(roomId);
      }
    }, 1000);
  }

  function clearPhaseTimer(room) {
    if (!room || !room.timers) return;
    if (room.timers.interval) clearInterval(room.timers.interval);
    room.timers = {};
  }

  function moveToDrawing(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    clearPhaseTimer(room);
    room.phase = 'drawing';
    for (const pid of room.order) {
      if (!room.history.find(h=>h.owner===pid)) {
        room.history.push({owner: pid, sequence:[{type:'prompt', data:'(no answer)'}]});
      }
    }
    io.to(roomId).emit('phaseChange', {phase:'drawing', seconds: room.secondsPerTurn});
    for (const ownerEntry of room.history) {
      const owner = ownerEntry.owner;
      const drawer = getDrawerForOwner(room, owner);
      io.to(drawer).emit('drawFor', {targetId: owner, prompt: ownerEntry.sequence[0].data, seconds: room.secondsPerTurn});
    }
    startPhaseTimer(roomId, 'drawing');
  }

  function moveToGuessing(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    clearPhaseTimer(room);
    room.phase = 'guessing';
    io.to(roomId).emit('phaseChange', {phase:'guessing', seconds: room.secondsPerTurn});
    for (const ownerEntry of room.history) {
      const owner = ownerEntry.owner;
      const guesser = getGuesserForOwner(room, owner);
      io.to(guesser).emit('guessFor', {targetId: owner, drawing: ownerEntry.sequence.find(s=>s.type==='drawing')});
    }
    startPhaseTimer(roomId, 'guessing');
  }

  function moveToReveal(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    clearPhaseTimer(room);
    room.phase = 'reveal';
    io.to(roomId).emit('phaseChange', {phase:'reveal'});
    io.to(roomId).emit('revealData', room.history);
    // wait longer so clients have time for sequential reveal animation
    setTimeout(()=>{
      room.round++;
      if (room.round > room.maxRounds) {
        room.phase = 'finished';
        io.to(roomId).emit('gameEnded');
      } else {
        room.history = [];
        room.phase = 'writing';
        io.to(roomId).emit('phaseChange', {phase:'writing', round: room.round, seconds: room.secondsPerTurn});
        startPhaseTimer(roomId, 'writing');
      }
    }, 8000);
  }

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log('Server running on', PORT));
