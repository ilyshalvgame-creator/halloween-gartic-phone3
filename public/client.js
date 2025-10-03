const socket = io();
let currentRoom = null;
let myName = '';
let assignedDrawTarget = null;
let assignedGuessTarget = null;
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

let prompts = [];
fetch('/prompts.json').then(r=>r.json()).then(j=>prompts=j).catch(()=>{prompts=['приведение']});

function showPhase(phase) {
  currentServerPhase = phase;
  phaseBanner.textContent = phase.toUpperCase();
  [writer, drawer, guesser, reveal].forEach(el=>el.classList.add('hidden'));
  if (phase === 'writing') writer.classList.remove('hidden');
  if (phase === 'drawing') drawer.classList.remove('hidden');
  if (phase === 'guessing') guesser.classList.remove('hidden');
  if (phase === 'reveal') reveal.classList.remove('hidden');
}

// Canvas scaling to match CSS size
function resizeCanvasToDisplaySize(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawAll();
  }
}
window.addEventListener('resize', ()=>resizeCanvasToDisplaySize(canvas));
resizeCanvasToDisplaySize(canvas);

// map pointer to canvas pixel coords
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  return [x, y];
}

// Create / Join
createBtn.onclick = ()=>{
  myName = nameInput.value || 'Player';
  const settings = { maxRounds: parseInt(roundsInput.value)||3, secondsPerTurn: parseInt(secondsInput.value)||60, mode: modeSelect.value||'classic' };
  socket.emit('createRoom', settings, (res)=>{
    if (res && res.ok) socket.emit('joinRoom', {roomId: res.roomId, name: myName}, (r)=>{ if (r.ok) { currentRoom = r.room.id; updateRoomUI(r.room); } });
    else alert('Error creating room');
  });
};

joinBtn.onclick = ()=>{
  myName = nameInput.value || 'Player';
  const rid = joinRoomId.value.trim();
  if (!rid) return alert('Enter room code');
  socket.emit('joinRoom', {roomId: rid, name: myName}, (r)=>{
    if (!r.ok) return alert(r.err || 'Join failed');
    currentRoom = r.room.id; updateRoomUI(r.room);
  });
};

startBtn.onclick = ()=>{
  if (!currentRoom) return alert('Create or join a room first');
  const settings = { maxRounds: parseInt(roundsInput.value)||3, secondsPerTurn: parseInt(secondsInput.value)||60, mode: modeSelect.value||'classic' };
  socket.emit('startGame', {roomId: currentRoom, settings}, (r)=>{ if (!r.ok) alert(r.err || 'Start failed'); });
};

socket.on('roomUpdate', room => updateRoomUI(room));
socket.on('gameStarted', ({phase, round, seconds})=>{ showPhase(phase); });
socket.on('phaseChange', ({phase, seconds, round})=>{ showPhase(phase); assignedDrawTarget=null; assignedGuessTarget=null; clearCanvas(); });
socket.on('drawFor', ({targetId, prompt, seconds})=>{
  assignedDrawTarget = (targetId === socket.id) ? targetId : null;
  document.getElementById('drawPrompt').textContent = 'Нарисуйте: ' + prompt;
  showPhase('drawing');
  clearCanvas();
  updateDrawerUI();
});
socket.on('guessFor', ({targetId, drawing})=>{
  assignedGuessTarget = (targetId === socket.id) ? targetId : null;
  showPhase('guessing');
});
socket.on('revealData', (history)=>{ showRevealSequential(history); showPhase('reveal'); });
socket.on('timerStart', ({phase, seconds})=>{ startLocalTimer(phase, seconds); });
socket.on('timerTick', ({phase, remaining})=>{ if (phase === currentServerPhase) document.getElementById('phaseBanner').textContent = 'Время: ' + remaining + ' сек'; });
socket.on('gameEnded', ()=>{ showPhase('reveal'); const el = document.getElementById('revealList'); el.innerHTML = '<div class="revealEntry">Игра завершена. Спасибо за игру!</div>'; phaseBanner.textContent = 'Игра окончена'; startBtn.disabled = true; });

// Submit prompt
submitPrompt.onclick = ()=>{
  if (!currentRoom) return alert('Not in a room');
  const p = promptInput.value.trim() || ('Halloween: ' + (prompts[Math.floor(Math.random()*prompts.length)]||'ghost'));
  socket.emit('submitPrompt', {roomId: currentRoom, prompt: p}, (r)=>{ if (!r.ok) alert(r.err || 'Error'); else showPhase('waiting'); });
};

randomPromptBtn.onclick = ()=>{ promptInput.value = prompts[Math.floor(Math.random()*prompts.length)]; };

// Drawing - pointer events
canvas.addEventListener('pointerdown', (e)=>{ canvas.setPointerCapture(e.pointerId); drawingStart(e); });
canvas.addEventListener('pointermove', (e)=>{ drawingMove(e); });
canvas.addEventListener('pointerup', (e)=>{ canvas.releasePointerCapture(e.pointerId); drawingEnd(); });
canvas.addEventListener('pointercancel', ()=>drawingEnd());

function drawingStart(e) {
  if (!assignedDrawTarget) return alert('You are not assigned to draw now.');
  currentStroke = { color: colorPicker.value||'#fff', size: +brushSize.value||6, points: [] };
  strokes.push(currentStroke);
  addPoint(e);
}
function drawingMove(e) { if (!currentStroke) return; addPoint(e); drawAll(); }
function drawingEnd() { currentStroke = null; }

function addPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  if (currentStroke) currentStroke.points.push([x,y]);
}

function drawAll() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for (const s of strokes) {
    ctx.beginPath();
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.lineWidth = s.size * (window.devicePixelRatio || 1);
    ctx.strokeStyle = s.color;
    for (let i=0;i<s.points.length;i++) {
      const [x,y] = s.points[i];
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
}

function clearCanvas() { strokes = []; ctx.clearRect(0,0,canvas.width,canvas.height); drawAll(); }
document.getElementById('undoBtn').onclick = ()=>{ strokes.pop(); drawAll(); };
document.getElementById('clearBtn').onclick = ()=>{ clearCanvas(); };

document.getElementById('submitDraw').onclick = ()=>{
  if (!currentRoom) return alert('Not in a room');
  if (!assignedDrawTarget) return alert('You are not assigned to draw');
  socket.emit('drawingData', {roomId: currentRoom, targetId: assignedDrawTarget, strokes}, (r)=>{
    if (!r.ok) alert(r.err || 'Error sending drawing'); else { assignedDrawTarget = null; showPhase('waiting'); clearCanvas(); }
  });
};

document.getElementById('submitGuess').onclick = ()=>{
  const g = document.getElementById('guessInput').value.trim();
  if (!currentRoom) return alert('Not in a room');
  if (!assignedGuessTarget) return alert('You are not assigned to guess');
  socket.emit('submitGuess', {roomId: currentRoom, targetId: assignedGuessTarget, guess: g}, (r)=>{ if (!r.ok) alert(r.err || 'Error'); else { assignedGuessTarget = null; showPhase('waiting'); } });
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
    if (assignedDrawTarget && assignedDrawTarget === socket.id) {
      drawerNotice.style.display = 'none';
      enableDrawingControls(true);
    } else {
      drawerNotice.style.display = 'block';
      enableDrawingControls(false);
    }
  }
}

function enableDrawingControls(enabled) {
  document.getElementById('brushSize').disabled = !enabled;
  document.getElementById('colorPicker').disabled = !enabled;
  document.getElementById('undoBtn').disabled = !enabled;
  document.getElementById('clearBtn').disabled = !enabled;
  document.getElementById('submitDraw').disabled = !enabled;
}

// reveal sequential animation
function showRevealSequential(history) {
  const el = document.getElementById('revealList');
  el.innerHTML = '';
  let delay = 0;
  const perStep = 1400;
  for (const item of history) {
    const container = document.createElement('div');
    container.className = 'revealEntry';
    el.appendChild(container);
    const promptDiv = document.createElement('div');
    promptDiv.textContent = 'Start: ' + (item.sequence[0] ? item.sequence[0].data : '(empty)');
    container.appendChild(promptDiv);
    let stepDelay = perStep;
    for (const s of item.sequence.slice(1)) {
      setTimeout(()=>{
        if (s.type === 'drawing') {
          const c = document.createElement('canvas'); c.width=600; c.height=320; c.style.width='100%'; const cctx=c.getContext('2d');
          for (const st of s.data) {
            cctx.lineJoin='round'; cctx.lineCap='round'; cctx.lineWidth = st.size; cctx.strokeStyle = st.color; cctx.beginPath();
            for (let i=0;i<st.points.length;i++){ const [x,y]=st.points[i]; if (i===0) cctx.moveTo(x,y); else cctx.lineTo(x,y);} cctx.stroke();
          }
          container.appendChild(c);
        } else if (s.type === 'guess') {
          const g = document.createElement('div'); g.textContent = 'Guess: ' + s.data; container.appendChild(g);
        }
      }, delay + stepDelay);
      stepDelay += perStep;
    }
    delay += stepDelay + 500;
  }
}

function startLocalTimer(phase, seconds) {
  if (window._localTimerId) clearInterval(window._localTimerId);
  let rem = seconds;
  if (phase === currentServerPhase) document.getElementById('phaseBanner').textContent = 'Time: ' + rem + ' sec';
  window._localTimerId = setInterval(()=>{
    rem--;
    if (phase === currentServerPhase) document.getElementById('phaseBanner').textContent = 'Time: ' + rem + ' sec';
    if (rem <= 0) clearInterval(window._localTimerId);
  }, 1000);
}

showPhase('waiting');
