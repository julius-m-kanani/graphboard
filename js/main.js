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

// Expose the current workspace state to the save/submit flow.
window.__serializeState = () => serializeState(state);

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateHistory();

async function boot() {
  const profile = await getProfile();
  if (profile) {
    showDashboard(profile);
  } else {
    showAuthView();
  }
  bindDashboardActions(route);
  attachAuthHandlers(route);
}

function route(profile) {
  if (profile) {
    showDashboard(profile);
  } else {
    showAuthView();
  }
}

boot();
