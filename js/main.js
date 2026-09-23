import './draw.js';
import './construction.js';
import './history.js';
import './input.js';
import { resizeCanvas } from './draw.js';
import { updateHistory } from './history.js';
import { state, loadState, render, $, showToast, initTheme } from './core.js';
import { supabase, getProfile } from './supabase.js';
import { showAuthView, attachAuthHandlers } from './auth.js';
import { showDashboard, bindDashboardActions } from './dashboard.js';
import { serializeState, deserializeState } from './serialize.js';
import { recordVideo } from './recorder.js';

window.__serializeState = () => serializeState(state);

window.addEventListener('resize', resizeCanvas);
initTheme();
resizeCanvas();
updateHistory();

document.getElementById('save-session-button')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(serializeState(state), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = `${$('.document-name input').value.trim() || 'graphboard'}-session.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast('Session saved to your device');
});
document.getElementById('open-session-button')?.addEventListener('click', () => {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = deserializeState(JSON.parse(reader.result));
        loadState(loaded);
        updateHistory();
        render();
        showToast('Session loaded');
      } catch (err) { showToast('Could not load that session'); }
    };
    reader.readAsText(file);
  };
  input.click();
});
document.getElementById('record-video-button')?.addEventListener('click', recordVideo);

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out after ' + ms + 'ms')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function boot() {
  const classroomBtn = document.getElementById('classroom-button');
  if (classroomBtn) {
    classroomBtn.addEventListener('click', async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user) {
          const profile = await withTimeout(getProfile(), 6000);
          if (profile) {
            showDashboard(profile);
          } else {
            showAuthView();
          }
        } else {
          showAuthView();
        }
      } catch (e) {
        console.error('classroom check failed:', e);
        showAuthView();
      }
    });
  }

  bindDashboardActions(route);
  attachAuthHandlers(route);

  try {
    await withTimeout(getProfile(), 6000);
  } catch (e) {
    console.error('getProfile failed:', e);
  }
}

function route(profile) {
  if (profile) {
    showDashboard(profile);
  } else {
    showAuthView();
  }
}

boot();