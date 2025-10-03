// public/client.js (debug)
const socket = io();
console.log('[client] script loaded');

window.addEventListener('error', function (ev) {
  console.error('[window error]', ev.message, ev.filename, ev.lineno, ev.error);
});

let currentRoom = null;
let assignedDrawOwner = null;
let assignedGuessOwner = null;
let currentServerPhase = null;

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

// quick prompts load
fetch('/prompts.json').then(r => r.json()).then(j => { prompts = j; console.log('[client] prompts loaded', prompts); }).catch(e => { console.warn('[client] prompts load fail', e); prompts = ['ghost']; });

function showPhase(phase) {
  currentServerPhase = phase;
  console.log('[client] showPhase', phase);
  phaseBanner.textContent = phase.toUpperCase();
  [writer, drawer, guesser, reveal].forEach(el => el.classList.add('hidden'));
  if (phase === 'writing') writer.classList.remove('hidden');
  if (phase === 'drawing') drawer.classList.remove('hidden');
  if (phase === 'guessing') guesser.classList.remove('hidden');
  if (phase === 'reveal') reveal.classList.remove('hidden');
}

// canvas scaling
function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pw = Math.floor(w * ratio);
  const ph = Math.floor(h * ratio);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// helpers
function cssToCanvas(x, y) {
  const rect = canvas.getBoundingClientRect();
  return [(x - rect.left) * (canvas.width / rect.width), (y - rect.top) * (canvas.height / rect.height)];
}

canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); startStroke(e); });
canvas.addEventListener('pointermove', e => moveStroke(e));
canvas.addEventListener('pointerup', e => { canvas.releasePointerCapture(e.pointerId); endStroke(); });
canvas.addEventListener('pointercancel', () => endStroke());

function startStroke(e) {
  if (!assignedDrawOwner) {
    // not allowed
    return;
  }
  currentStroke = { color: (colorPicker && colorPicker.value) || '#fff', size: (brushSize && +brushSize.value) || 6, points: [] };
  strokes.push(currentStroke);
  addPoint(e);
  redraw();
}
function moveStroke(e) { if (!currentStroke) return; addPoint(e); redraw(); }
function endStroke() { currentStroke = null; }
function addPoint(e) { const p = cssToCanvas(e.clientX, e.clientY); if (currentStroke) currentStroke.points.push(p); }

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    ctx.beginPath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = s.size * (window.devicePixelRatio || 1);
    ctx.strokeStyle = s.color;
    for (let i = 0; i < s.points.length; i++) {
      const [x, y] = s.points[i];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// UI actions
createBtn.onclick = () => {
  const name = nameInput.value || 'Player';
  const settings = { maxRounds: parseInt(roundsInput.value) || 3, secondsPerTurn: parseInt(secondsInput.value) || 60, mode: modeSelect.value || 'classic' };
  console.log('[client] emit createRoom', settings);
  socket.emit('createRoom', settings, res => {
    console.log('[client] createRoom cb', res);
    if (res && res.ok) {
      socket.emit('joinRoom', { roomId: res.roomId, name }, r => {
        console.log('[client] joinRoom cb', r);
        if (r && r.ok) { currentRoom = r.room.id; updateRoomUI(r.room); }
        else alert('Join failed: ' + (r && r.err));
      });
    } else {
      alert('Create failed: ' + (res && res.err));
    }
  });
};

joinBtn.onclick = () => {
  const name = nameInput.value || 'Player';
  const rid = joinRoomId.value.trim();
  if (!rid) return alert('Enter room code');
  console.log('[client] emit joinRoom', rid, name);
  socket.emit('joinRoom', { roomId: rid, name }, r => {
    console.log('[client] joinRoom cb', r);
    if (!r || !r.ok) return alert(r && r.err ? r.err : 'Join failed');
    currentRoom = r.room.id; updateRoomUI(r.room);
  });
};

startBtn.onclick = () => {
  const settings = { maxRounds: parseInt(roundsInput.value) || 3, secondsPerTurn: parseInt(secondsInput.value) || 60, mode: modeSelect.value || 'classic' };
  console.log('[client] emit startGame', currentRoom, settings);
  socket.emit('startGame', { roomId: currentRoom, settings }, r => {
    console.log('[client] startGame cb', r);
    if (!r || !r.ok) alert(r && r.err ? r.err : 'Start failed');
  });
};

// socket events
socket.on('connect', () => console.log('[socket] connect', socket.id));
socket.on('disconnect', () => console.log('[socket] disconnect'));
socket.on('roomUpdate', room => { console.log('[socket] roomUpdate', room); updateRoomUI(room); });
socket.on('gameStarted', d => { console.log('[socket] gameStarted', d); showPhase(d.phase); });
socket.on('phaseChange', d => { console.log('[socket] phaseChange', d); showPhase(d.phase); assignedDrawOwner = null; assignedGuessOwner = null; strokes = []; redraw(); updateDrawerUI(); });
socket.on('drawFor', d => { console.log('[socket] drawFor', d); assignedDrawOwner = d.targetId; document.getElementById('drawPrompt').textContent = 'Нарисуйте: ' + d.prompt; showPhase('drawing'); strokes = []; redraw(); updateDrawerUI(); });
socket.on('guessFor', d => { console.log('[socket] guessFor', d); assignedGuessOwner = d.targetId; showPhase('guessing'); });
socket.on('revealData', h => { console.log('[socket] revealData', h); showRevealSequential(h); showPhase('reveal'); });
socket.on('timerStart', d => { console.log('[socket] timerStart', d); startLocalTimer(d.phase, d.seconds); });
socket.on('timerTick', d => { console.log('[socket] timerTick', d); if (d.phase === currentServerPhase) phaseBanner.textContent = 'Time: ' + d.remaining + ' sec'; });
socket.on('playerSubmitted', p => { console.log('[socket] playerSubmitted', p); });
socket.on('gameEnded', () => { console.log('[socket] gameEnded'); showPhase('reveal'); document.getElementById('revealList').innerHTML = '<div class=\"revealEntry\">Game finished</div>'; });

submitPrompt.onclick = () => {
  const text = promptInput.value.trim() || ('Halloween: ' + (prompts[Math.floor(Math.random() * prompts.length)] || 'ghost'));
  console.log('[client] submitPrompt', text);
  socket.emit('submitPrompt', { roomId: currentRoom, prompt: text }, r => { console.log('[client] submitPrompt cb', r); if (!r || !r.ok) alert(r && r.err ? r.err : 'Error'); else showPhase('waiting'); });
};

document.getElementById('submitDraw').onclick = () => {
  console.log('[client] submitDraw', assignedDrawOwner, 'strokes count', strokes.length);
  if (!assignedDrawOwner) return alert('You are not assigned to draw');
  socket.emit('drawingData', { roomId: currentRoom, targetId: assignedDrawOwner, strokes }, r => {
    console.log('[client] drawingData cb', r);
    if (!r || !r.ok) alert(r && r.err ? r.err : 'Error'); else { assignedDrawOwner = null; showPhase('waiting'); strokes = []; redraw(); updateDrawerUI(); }
  });
};

document.getElementById('submitGuess').onclick = () => {
  const g = document.getElementById('guessInput').value.trim();
  console.log('[client] submitGuess', assignedGuessOwner, g);
  if (!assignedGuessOwner) return alert('You are not assigned to guess');
  socket.emit('submitGuess', { roomId: currentRoom, targetId: assignedGuessOwner, guess: g }, r => {
    console.log('[client] submitGuess cb', r);
    if (!r || !r.ok) alert(r && r.err ? r.err : 'Error'); else { assignedGuessOwner = null; showPhase('waiting'); }
  });
};

function updateRoomUI(room) {
  if (!room) return;
  currentRoom = room.id;
  roomInfo.textContent = 'Room: ' + room.id + ' - Phase: ' + (room.phase || 'waiting');
  playersList.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li'); li.textContent = p.name + (p.id === room.host ? ' (host)' : ''); playersList.appendChild(li);
  }
  const isHost = room.host === socket.id;
  startBtn.disabled = !(isHost && room.players.length >= 2);
  updateDrawerUI();
}

function updateDrawerUI() {
  if (currentServerPhase === 'drawing') {
    drawer.classList.remove('hidden');
    if (assignedDrawOwner) { drawerNotice.style.display = 'none'; enableDrawingControls(true); }
    else { drawerNotice.style.display = 'block'; enableDrawingControls(false); }
  } else drawer.classList.add('hidden');
}

function enableDrawingControls(enabled) {
  document.getElementById('brushSize').disabled = !enabled;
  document.getElementById('colorPicker').disabled = !enabled;
  document.getElementById('undoBtn').disabled = !enabled;
  document.getElementById('clearBtn').disabled = !enabled;
  document.getElementById('submitDraw').disabled = !enabled;
}

function showRevealSequential(history) {
  const el = document.getElementById('revealList');
  el.innerHTML = '';
  let delay = 0;
  const step = 1200;
  for (const entry of history) {
    const cont = document.createElement('div');
    cont.className = 'revealEntry';
    el.appendChild(cont);
    const p = document.createElement('div'); p.textContent = 'Start: ' + (entry.sequence[0] ? entry.sequence[0].data : '(empty)'); cont.appendChild(p);
    let inner = step;
    for (const s of entry.sequence.slice(1)) {
      setTimeout(() => {
        if (s.type === 'drawing') {
          const c = document.createElement('canvas'); c.width = 600; c.height = 320; c.style.width = '100%';
          const cctx = c.getContext('2d');
          for (const st of s.data) {
            cctx.beginPath(); cctx.lineJoin='round'; cctx.lineCap='round'; cctx.lineWidth = st.size; cctx.strokeStyle = st.color;
            for (let i=0;i<st.points.length;i++) { const [x,y]=st.points[i]; if (i===0) cctx.moveTo(x,y); else cctx.lineTo(x,y); } cctx.stroke();
          }
          cont.appendChild(c);
        } else if (s.type === 'guess') {
          const g = document.createElement('div'); g.textContent = 'Guess: ' + s.data; cont.appendChild(g);
        }
      }, delay + inner);
      inner += step;
    }
    delay += inner + 300;
  }
}

function startLocalTimer(phase, seconds) {
  if (window._timerId) clearInterval(window._timerId);
  let rem = seconds;
  if (phase === currentServerPhase) phaseBanner.textContent = 'Time: ' + rem + ' sec';
  window._timerId = setInterval(() => {
    rem--;
    if (phase === currentServerPhase) phaseBanner.textContent = 'Time: ' + rem + ' sec';
    if (rem <= 0) clearInterval(window._timerId);
  }, 1000);
}

showPhase('waiting');
