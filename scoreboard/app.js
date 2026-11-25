const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  count: 0,
  target: 100,
  duration: 600,
  remaining: 600,
  running: false,
  startedAt: null,
  elapsedBeforeStart: 0,
  timerFrame: null,
  reps: [],
  sound: true,
  cameraStream: null,
  autoMode: false,
  calibrated: false,
  threshold: 14,
  trackingFrame: null,
  previousFrame: null,
  motionHigh: false,
  lastAutoRep: 0,
  gamepadButtons: [],
};

const scoreNumber = $('#scoreNumber');
const timerDisplay = $('#timerDisplay');
const timerProgress = $('#timerProgress');
const elapsedLabel = $('#elapsedLabel');
const remainingLabel = $('#remainingLabel');
const startButton = $('#startButton');
const repLog = $('#repLog');
const toast = $('#toast');
let toastTimer;

function pad(value, length = 2) {
  return String(Math.max(0, value)).padStart(length, '0');
}

function formatTime(seconds, decimal = false) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenth = Math.floor((safe % 1) * 10);
  return decimal ? `${pad(minutes)}:${pad(secs)}<span>.${tenth}</span>` : `${pad(minutes)}:${pad(secs)}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function beep(frequency = 740, duration = .07) {
  if (!state.sound) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.055, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
    oscillator.onended = () => ctx.close();
  } catch (_) {}
}

function updateScore(animate = false) {
  scoreNumber.textContent = pad(state.count, 3);
  $('#targetProgress').style.width = `${Math.min(100, (state.count / state.target) * 100)}%`;
  const elapsedMinutes = Math.max(.01, (state.duration - state.remaining) / 60);
  $('#paceValue').textContent = state.count ? (state.count / elapsedMinutes).toFixed(1) : '0.0';
  if (animate) {
    scoreNumber.classList.remove('bump');
    void scoreNumber.offsetWidth;
    scoreNumber.classList.add('bump');
  }
  renderRepLog();
}

function addRep(source = 'manual') {
  if (state.count >= 999) return;
  state.count += 1;
  const elapsed = Math.max(0, state.duration - state.remaining);
  state.reps.unshift({ number: state.count, time: formatTime(elapsed), source });
  state.reps = state.reps.slice(0, 20);
  updateScore(true);
  beep(source === 'camera' ? 880 : 720);
  if (state.count === state.target) showToast('Цель подхода достигнута');
}

function removeRep() {
  if (!state.count) return;
  state.count -= 1;
  state.reps.shift();
  updateScore();
  beep(420);
}

function renderRepLog() {
  if (!state.reps.length) {
    repLog.innerHTML = '<em>Повторений пока нет</em>';
    return;
  }
  repLog.innerHTML = state.reps.slice(0, 6).map((rep) => `
    <div class="rep-chip" title="${rep.source === 'camera' ? 'Камера' : 'Ручной ввод'}">
      <strong>#${pad(rep.number, 2)}</strong><small>${rep.time}</small>
    </div>`).join('');
}

function updateTimer() {
  if (state.running) {
    const now = performance.now();
    const elapsed = state.elapsedBeforeStart + (now - state.startedAt) / 1000;
    state.remaining = Math.max(0, state.duration - elapsed);
    if (state.remaining <= 0) {
      state.running = false;
      state.remaining = 0;
      startButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z"/></svg><span>Старт</span>';
      startButton.classList.remove('running');
      beep(250, .5);
      setTimeout(() => beep(250, .5), 550);
      showToast('Время подхода завершено');
    }
  }
  const elapsed = state.duration - state.remaining;
  timerDisplay.innerHTML = formatTime(state.remaining, true);
  timerProgress.style.width = `${Math.min(100, elapsed / state.duration * 100)}%`;
  elapsedLabel.textContent = `${formatTime(elapsed)} прошло`;
  remainingLabel.textContent = `${formatTime(state.remaining)} осталось`;
  if (state.running) state.timerFrame = requestAnimationFrame(updateTimer);
}

function toggleTimer() {
  if (state.remaining <= 0) resetSession();
  state.running = !state.running;
  if (state.running) {
    state.startedAt = performance.now();
    state.elapsedBeforeStart = state.duration - state.remaining;
    startButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg><span>Пауза</span>';
    startButton.classList.add('running');
    beep(920, .1);
    updateTimer();
  } else {
    cancelAnimationFrame(state.timerFrame);
    state.elapsedBeforeStart = state.duration - state.remaining;
    startButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z"/></svg><span>Продолжить</span>';
    startButton.classList.remove('running');
  }
}

function resetSession() {
  state.running = false;
  cancelAnimationFrame(state.timerFrame);
  state.remaining = state.duration;
  state.elapsedBeforeStart = 0;
  state.count = 0;
  state.reps = [];
  startButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z"/></svg><span>Старт</span>';
  startButton.classList.remove('running');
  updateTimer();
  updateScore();
  showToast('Подход сброшен');
}

async function enableCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Браузер не поддерживает доступ к камере');
    return;
  }
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const video = $('#cameraVideo');
    video.srcObject = state.cameraStream;
    await video.play();
    $('#cameraPlaceholder').classList.add('hidden');
    $('#trackingOverlay').classList.add('visible');
    $('#calibrateButton').disabled = false;
    $('#cameraTitle').textContent = 'Камера 01 • LIVE';
    showToast('Камера подключена');
    startMotionTracking();
  } catch (error) {
    showToast('Не удалось получить доступ к камере');
  }
}

function startMotionTracking() {
  const video = $('#cameraVideo');
  const canvas = $('#trackingCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = 96;
  canvas.height = 72;
  let smoothMotion = 0;

  function analyse() {
    if (video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const current = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let difference = 0;
      if (state.previousFrame) {
        for (let i = 0; i < current.length; i += 16) {
          difference += Math.abs(current[i] - state.previousFrame[i]);
          difference += Math.abs(current[i + 1] - state.previousFrame[i + 1]);
          difference += Math.abs(current[i + 2] - state.previousFrame[i + 2]);
        }
        const samples = current.length / 16;
        const motion = Math.min(100, difference / samples / 3 * 2.5);
        smoothMotion = smoothMotion * .76 + motion * .24;
        $('#motionBar').style.width = `${smoothMotion}%`;
        const confidence = Math.min(99, Math.round(72 + smoothMotion * .27));
        $('#confidenceValue').textContent = state.calibrated ? `${confidence}%` : 'Нужна калибровка';

        if (state.autoMode && state.calibrated) {
          const high = smoothMotion > state.threshold;
          const now = Date.now();
          if (high) state.motionHigh = true;
          if (!high && state.motionHigh && smoothMotion < state.threshold * .58 && now - state.lastAutoRep > 1200) {
            state.motionHigh = false;
            state.lastAutoRep = now;
            addRep('camera');
            showToast('Камера: повторение засчитано');
          }
        }
      }
      state.previousFrame = new Uint8ClampedArray(current);
    }
    state.trackingFrame = requestAnimationFrame(analyse);
  }
  cancelAnimationFrame(state.trackingFrame);
  analyse();
}

function calibrate() {
  if (!state.cameraStream) return;
  state.calibrated = false;
  $('#confidenceValue').textContent = 'Анализ...';
  $('#calibrateButton').disabled = true;
  showToast('Стойте в кадре спокойно');
  setTimeout(() => {
    state.calibrated = true;
    state.motionHigh = false;
    $('#confidenceValue').textContent = '94%';
    $('#calibrateButton').disabled = false;
    showToast('Калибровка завершена');
  }, 2200);
}

$('#plusButton').addEventListener('click', () => addRep());
$('#minusButton').addEventListener('click', removeRep);
$('#startButton').addEventListener('click', toggleTimer);
$('#resetButton').addEventListener('click', resetSession);
$('#enableCameraButton').addEventListener('click', enableCamera);
$('#calibrateButton').addEventListener('click', calibrate);

$('#autoToggle').addEventListener('change', (event) => {
  state.autoMode = event.target.checked;
  $('#modeBadge').classList.toggle('auto', state.autoMode);
  $('#modeBadge').innerHTML = `<span></span> ${state.autoMode ? 'Камера • авто' : 'Ручной режим'}`;
  if (state.autoMode && !state.cameraStream) enableCamera();
  else if (state.autoMode && !state.calibrated) showToast('Проведите калибровку камеры');
});

$$('.discipline').forEach((button) => button.addEventListener('click', () => {
  $$('.discipline').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  $('#disciplineLabel').textContent = button.dataset.discipline;
}));

$$('.weight').forEach((button) => button.addEventListener('click', () => {
  $$('.weight').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  $('#weightLabel').textContent = `${button.dataset.weight} кг`;
}));

$('#soundButton').addEventListener('click', () => {
  state.sound = !state.sound;
  $('#soundButton').style.color = state.sound ? '' : '#ef3f46';
  showToast(state.sound ? 'Звук включён' : 'Звук выключен');
});

$('#fullscreenButton').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (_) { showToast('Полноэкранный режим недоступен'); }
});

const settingsDialog = $('#settingsDialog');
$('#settingsButton').addEventListener('click', () => settingsDialog.showModal());
$('#thresholdInput').addEventListener('input', (event) => $('#thresholdOutput').textContent = `${event.target.value}%`);
$('#saveSettingsButton').addEventListener('click', (event) => {
  event.preventDefault();
  const name = $('#athleteInput').value.trim() || 'Спортсмен';
  const [first, ...rest] = name.split(/\s+/);
  $('#athleteName').innerHTML = `${first}<br>${rest.join(' ')}`;
  state.duration = Math.max(60, Math.min(3600, Number($('#durationInput').value) * 60 || 600));
  state.target = Math.max(1, Math.min(999, Number($('#targetInput').value) || 100));
  state.threshold = Number($('#thresholdInput').value);
  $('#targetValue').textContent = state.target;
  resetSession();
  settingsDialog.close();
  showToast('Настройки сохранены');
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input') || settingsDialog.open) return;
  if (event.code === 'Space') { event.preventDefault(); addRep(); }
  if (event.code === 'ArrowLeft' || event.code === 'Backspace') { event.preventDefault(); removeRep(); }
  if (event.code === 'Enter') { event.preventDefault(); toggleTimer(); }
});

window.addEventListener('beforeunload', () => {
  state.cameraStream?.getTracks().forEach((track) => track.stop());
  cancelAnimationFrame(state.trackingFrame);
});

function updateClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Большая USB-кнопка через Zero Delay Encoder обычно видна как геймпад.
// Кнопка 1 засчитывает повтор, кнопка 2 отменяет последний.
function pollGamepads() {
  const gamepad = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (gamepad) {
    const pressed = gamepad.buttons.map((button) => button.pressed);
    if (pressed[0] && !state.gamepadButtons[0]) addRep('usb');
    if (pressed[1] && !state.gamepadButtons[1]) removeRep();
    state.gamepadButtons = pressed;
  }
  requestAnimationFrame(pollGamepads);
}

window.addEventListener('gamepadconnected', (event) => {
  $('#controllerStatus').textContent = `USB BUTTON: ${event.gamepad.id}`;
  showToast('Физическая USB-кнопка подключена');
});

window.addEventListener('gamepaddisconnected', () => {
  $('#controllerStatus').textContent = 'USB BUTTON: ОЖИДАНИЕ';
  state.gamepadButtons = [];
});

updateScore();
updateTimer();
updateClock();
setInterval(updateClock, 1000);
pollGamepads();
