import './draw.js';
import './construction.js';
import './history.js';
import './input.js';
import { resizeCanvas } from './draw.js';
import { updateHistory } from './history.js';
import { state } from './core.js';
import { supabase, getProfile } from './supabase.js';
import { showAuthView, attachAuthHandlers } from './auth.js';
import { showDashboard, bindDashboardActions } from './dashboard.js';
import { serializeState } from './serialize.js';

window.__serializeState = () => serializeState(state);

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateHistory();

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
    const profile = await withTimeout(getProfile(), 6000);
    if (profile) {
      showDashboard(profile);
    }
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