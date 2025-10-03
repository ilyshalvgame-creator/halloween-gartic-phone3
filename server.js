// public/client.js
// Improved client logic:
// - correct drawFor handling
// - timer ticks scoped by phase
// - canvas scaling with devicePixelRatio and CSS transform
// - drawing allowed only for assigned drawer
// - sequential reveal display
// - no em-dashes in text

const socket = io();
let currentRoom = null;
let myName = '';
let assignedDrawOwner = null;   // owner id for which this client was assigned to draw (set when server emits drawFor to this socket)
let assignedGuessOwner = null;  // owner id to guess (set when server emits guessFor to this socket)
let currentServerPhase = null;

// UI refs
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const joinRoomId = document.getElementById('joinRoomId');
const roomInfo = document.getElementById('roomInfo');
const playersList = document.getElementById('playersList');
const phaseBanner = document.getElementById('phaseBanner');
const writer = document.getElementById('writer');
const drawer = document.getElementById('drawer');
const guesser = document.getElementById('guesser');
const reveal = document.getElementById('reveal');
const promptInput = document.getElementById('promptInput');
const submitPrompt = document.getElementById('submitPrompt');
const randomPromptBtn = document.getElementById('randomPrompt');
const roundsInput = document.getElementById('roundsInput');
const secondsInput = document.getElementById('secondsInput');
const modeSelect = document.getElementById('modeSelect');
const drawerNotice = document.getElementById('drawerNotice');

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const brushSize = document.getElementById('brushSize');

let strokes = [];
let currentStroke = null;

let prompts = [];
fetch('/prompts.json').then(r => r.json()).then(j => prompts = j).catch(() => { prompts = ['ghost']; });

// Utilities - show phase
function showPhase(phase) {
  currentServerPhase = phase;
  phaseBanner.textContent = phase.toUpperCase();
  [writer, drawer, guesser, reveal].forEach(el => el.classList.add('hidden'));
  if (phase === 'writing') writer.classList.remove('hidden');
  if (phase === 'drawing') drawer.classList.remove('hidden');
  if (phase === 'guessing') guesser.classList.remove('hidden');
  if (phase === 'reveal') reveal.classList.remove('hidden');
}

// Canvas scaling for crisp drawing and correct coordinate mapping
function resizeCanvasToDisplaySize() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pw = Math.floor(width * ratio);
  const ph = Math.floor(height * ratio);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    // scale drawing operations so CSS coordinates map to canvas pixel coords
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redrawAll();
  }
}
window.addEventListener('resize', resizeCanvasToDisplaySize);
resizeCanvasToDisplaySize();

function cssToCanvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  // convert CSS client coords to canvas pixel space (taking canvas.width/rect.width ratio)
  const x = (clientX - rect.left) * (canvas.width / rect.width);
  const y = (clientY - rect.top) * (canvas.height / rect.height);
  return [x, y];
}

// Drawing handlers
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); startStroke(e); });
canvas.addEventListener('pointermove', e => moveStroke(e));
canvas.addEventListener('pointerup', e => { canvas.releasePointerCapture(e.pointerId); endStroke(); });
canvas.addEventListener('pointercancel', () => endStroke());

function startStroke(e) {
  // only allow the assigned drawer (server emits drawFor only to that socket)
  if (!assignedDrawOwner) {
    // do not spam alerts; show notice instead
    return;
  }
  const color = (colorPicker && colorPicker.value) || '#ffffff';
  const size = (brushSize && +brushSize.value) || 6;
  currentStroke = { color, size, points: [] };
  strokes.push(currentStroke);
  addPointFromEvent(e);
  redrawAll();
}

function moveStroke(e) {
  if (!currentStroke) return;
  addPointFromEvent(e);
  redrawAll();
}

function endStroke() {
  currentStroke = null;
}

function addPointFromEvent(e) {
  const [x, y] = cssToCanvasCoords(e.clientX, e.clientY);
  if (currentStroke) currentStroke.points.push([x, y]);
}

function redrawAll() {
  // clear in canvas pixel space
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    ctx.beginPath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // stroke.size is in CSS pixels, multiply by devicePixelRatio inside ctx.setTransform already, but keep thickness consistent:
    ctx.lineWidth = s.size * (window.devicePixelRatio || 1);
    ctx.strokeStyle = s.color;
    for (let i = 0; i < s.points.length; i++) {
      const [x, y] = s.points[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Controls - create / join / start
createBtn.onclick = () => {
  myName = nameInput.value || 'Player';
  const settings = { maxRounds: parseInt(roundsInput.value) || 3, secondsPerTurn: parseInt(secondsInput.value) || 60, mode: modeSelect.value || 'classic' };
  socket.emit('createRoom', settings, res => {
    if (res && res.ok) {
      socket.emit('joinRoom', { roomId: res.roomId, name: myName }, r => {
        if (r && r.ok) {
          currentRoom = r.room.id;
          updateRoomUI(r.room);
        } else {
          alert(r && r.err ? r.err : 'Join failed');
        }
      });
    } else {
      alert('Room creation failed');
    }
  });
};

joinBtn.onclick = () => {
  myName = nameInput.value || 'Player';
  const rid = joinRoomId.value.trim();
  if (!rid) return alert('Enter room code');
  socket.emit('joinRoom', { roomId: rid, name: myName }, r => {
    if (!r || !r.ok) return alert(r && r.err ? r.err : 'Join failed');
    currentRoom = r.room.id;
    updateRoomUI(r.room);
  });
};

startBtn.onclick = () => {
  if (!currentRoom) return alert('Create or join a room first');
  const settings = { maxRounds: parseInt(roundsInput.value) || 3, secondsPerTurn: parseInt(secondsInput.value) || 60, mode: modeSelect.value || 'classic' };
  socket.emit('startGame', { roomId: currentRoom, settings }, r => {
    if (!r || !r.ok) alert(r && r.err ? r.err : 'Start failed');
  });
};

// events from server
socket.on('roomUpdate', room => updateRoomUI(room));
socket.on('gameStarted', ({ phase, round, seconds }) => {
  showPhase(phase);
});
socket.on('phaseChange', ({ phase, seconds, round }) => {
  showPhase(phase);
  assignedDrawOwner = null;
  assignedGuessOwner = null;
  strokes = [];
  redrawAll();
  updateDrawerUI();
});
socket.on('drawFor', ({ targetId, prompt, seconds }) => {
  // server sends drawFor only to the drawer socket - so if we receive it, we are the drawer
  assignedDrawOwner = targetId;
  document.getElementById('drawPrompt').textContent = 'Нарисуйте: ' + prompt;
  showPhase('drawing');
  strokes = [];
  redrawAll();
  updateDrawerUI();
});
socket.on('guessFor', ({ targetId, drawing }) => {
  // server sends guessFor only to assigned guesser
  assignedGuessOwner = targetId;
  showPhase('guessing');
});
socket.on('revealData', history => {
  showRevealSequential(history);
  showPhase('reveal');
});
socket.on('timerStart', ({ phase, seconds }) => {
  startLocalTimer(phase, seconds);
});
socket.on('timerTick', ({ phase, remaining }) => {
  if (phase === currentServerPhase) {
    phaseBanner.textContent = 'Время: ' + remaining + ' сек';
  }
});
socket.on('playerSubmitted', info => {
  // optional UI hook - could highlight progress
});
socket.on('gameEnded', () => {
  showPhase('reveal');
  const el = document.getElementById('revealList');
  el.innerHTML = '<div class="revealEntry">Игра завершена. Спасибо за игру!</div>';
  phaseBanner.textContent = 'Игра окончена';
  startBtn.disabled = true;
});

// submit prompt
submitPrompt.onclick = () => {
  if (!currentRoom) return alert('Not in a room');
  const text = promptInput.value.trim() || ('Halloween: ' + (prompts[Math.floor(Math.random() * prompts.length)] || 'ghost'));
  socket.emit('submitPrompt', { roomId: currentRoom, prompt: text }, r => {
    if (!r || !r.ok) alert(r && r.err ? r.err : 'Error');
    else showPhase('waiting');
  });
};
randomPromptBtn.onclick = () => { promptInput.value = prompts[Math.floor(Math.random() * prompts.length)]; };

// submit drawing
document.getElementById('submitDraw').onclick = () => {
  if (!currentRoom) return alert('Not in a room');
  if (!assignedDrawOwner) return alert('You are not assigned to draw');
  // send strokes (already in canvas pixel coordinate space)
  socket.emit('drawingData', { roomId: currentRoom, targetId: assignedDrawOwner, strokes }, r => {
    if (!r || !r.ok) alert(r && r.err ? r.err : 'Error sending drawing');
    else {
      assignedDrawOwner = null;
      showPhase('waiting');
      strokes = [];
      redrawAll();
      updateDrawerUI();
    }
  });
};

// submit guess
document.getElementById('submitGuess').onclick = () => {
  const g = document.getElementById('guessInput').value.trim();
  if (!currentRoom) return alert('Not in a room');
  if (!assignedGuessOwner) return alert('You are not assigned to guess');
  socket.emit('submitGuess', { roomId: currentRoom, targetId: assignedGuessOwner, guess: g }, r => {
    if (!r || !r.ok) alert(r && r.err ? r.err : 'Error');
    else {
      assignedGuessOwner = null;
      showPhase('waiting');
    }
  });
};

// UI helpers
function updateRoomUI(room) {
  if (!room) return;
  currentRoom = room.id;
  roomInfo.textContent = 'Room: ' + room.id + ' - Phase: ' + (room.phase || 'waiting');
  playersList.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    li.textContent = p.name + (p.id === room.host ? ' (host)' : '');
    playersList.appendChild(li);
  }
  const isHost = room.host === socket.id;
  startBtn.disabled = !(isHost && room.players.length >= 2);
  updateDrawerUI();
}

function updateDrawerUI() {
  if (currentServerPhase === 'drawing') {
    drawer.classList.remove('hidden');
    if (assignedDrawOwner) {
      // this client is the drawer - allow controls
      drawerNotice.style.display = 'none';
      enableDrawingControls(true);
    } else {
      // not drawer - show notice and disable tools
      drawerNotice.style.display = 'block';
      enableDrawingControls(false);
    }
  } else {
    drawer.classList.add('hidden');
  }
}

function enableDrawingControls(enabled) {
  document.getElementById('brushSize').disabled = !enabled;
  document.getElementById('colorPicker').disabled = !enabled;
  document.getElementById('undoBtn').disabled = !enabled;
  document.getElementById('clearBtn').disabled = !enabled;
  document.getElementById('submitDraw').disabled = !enabled;
}

// undo / clear
document.getElementById('undoBtn').onclick = () => { strokes.pop(); redrawAll(); };
document.getElementById('clearBtn').onclick = () => { strokes = []; redrawAll(); };

// reveal sequential animation
function showRevealSequential(history) {
  const el = document.getElementById('revealList');
  el.innerHTML = '';
  let globalDelay = 0;
  const stepMs = 1200;
  for (const entry of history) {
    const container = document.createElement('div');
    container.className = 'revealEntry';
    el.appendChild(container);

    // show prompt immediately
    const promptDiv = document.createElement('div');
    promptDiv.textContent = 'Start: ' + (entry.sequence[0] ? entry.sequence[0].data : '(empty)');
    container.appendChild(promptDiv);

    let innerDelay = stepMs;
    for (const s of entry.sequence.slice(1)) {
      setTimeout(() => {
        if (s.type === 'drawing') {
          const c = document.createElement('canvas');
          c.width = 600;
          c.height = 320;
          c.style.width = '100%';
          const cctx = c.getContext('2d');
          for (const st of s.data) {
            cctx.beginPath();
            cctx.lineJoin = 'round';
            cctx.lineCap = 'round';
            cctx.lineWidth = st.size;
            cctx.strokeStyle = st.color;
            for (let i = 0; i < st.points.length; i++) {
              const [x, y] = st.points[i];
              if (i === 0) cctx.moveTo(x, y);
              else cctx.lineTo(x, y);
            }
            cctx.stroke();
          }
          container.appendChild(c);
        } else if (s.type === 'guess') {
          const g = document.createElement('div');
          g.textContent = 'Guess: ' + s.data;
          container.appendChild(g);
        }
      }, globalDelay + innerDelay);
      innerDelay += stepMs;
    }
    globalDelay += innerDelay + 400;
  }
}

// local timer that respects server phase
let _localTimerId = null;
function startLocalTimer(phase, seconds) {
  if (_localTimerId) clearInterval(_localTimerId);
  let rem = seconds;
  if (phase === currentServerPhase) phaseBanner.textContent = 'Time: ' + rem + ' sec';
  _localTimerId = setInterval(() => {
    rem--;
    if (phase === currentServerPhase) phaseBanner.textContent = 'Time: ' + rem + ' sec';
    if (rem <= 0) clearInterval(_localTimerId);
  }, 1000);
}

// initial UI
showPhase('waiting');
