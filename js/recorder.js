import { canvas, paperWrap, state, render, showToast } from './core.js';
import { serializeState, deserializeState } from './serialize.js';
import { loadState } from './core.js';

let recording = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function pickMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const t of candidates) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* try next */ } }
  return '';
}

function framesFor(a) {
  if ((a.type === 'pencil' || a.type === 'compass') && a.points && a.points.length > 2) {
    const n = a.points.length, step = Math.max(2, Math.ceil(n / 80)), frames = [];
    for (let i = step; i <= n; i += step) frames.push({ ...a, points: a.points.slice(0, i) });
    if (frames[frames.length - 1].points.length !== n) frames.push(a);
    return frames;
  }
  return [a];
}

function setControls(disabled) {
  const button = document.getElementById('record-video-button');
  if (button) { button.disabled = disabled; button.textContent = disabled ? 'Recording…' : 'Record video'; }
  ['undo-button', 'redo-button', 'clear-button', 'save-session-button', 'open-session-button', 'export-button'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
  canvas.style.pointerEvents = disabled ? 'none' : '';
  paperWrap.style.cursor = disabled ? 'wait' : '';
}

export async function recordVideo() {
  if (recording) { showToast('Already recording'); return; }
  if (!state.actions.length) { showToast('Nothing to record yet'); return; }
  if (!window.MediaRecorder || !canvas.captureStream) { showToast('Video recording is not supported in this browser'); return; }

  recording = true;
  setControls(true);
  showToast('Recording your session…');

  const saved = serializeState(state);
  const replay = deserializeState(saved);
  const mime = pickMimeType();
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const finished = new Promise(resolve => { recorder.onstop = resolve; });

  try {
    recorder.start(100);
    state.drawing = null; state.drag = null; state.divider = null;
    state.compassAnchor = null; state.compassCarryRadius = null; state.construction = null;
    state.actions = []; state.redo = [];
    render();
    await sleep(400);

    for (const a of replay.actions) {
      const frames = framesFor(a);
      for (const f of frames) { state.actions.push(f); render(); await sleep(45); }
      await sleep(220);
    }
    await sleep(900);
  } finally {
    recorder.stop();
  }

  await finished;

  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `${document.querySelector('.document-name input')?.value.trim() || 'graphboard'}-session.webm`;
  a.href = url; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  loadState(deserializeState(saved));
  render();
  setControls(false);
  recording = false;
  showToast(`Recorded ${saved.actions.length} marks as a video`);
}
