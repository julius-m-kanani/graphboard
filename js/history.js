import { $, state, render } from './core.js';
import { advanceConstruction } from './construction.js';

export function updateHistory() { $('#undo-button').disabled = !state.actions.length; $('#redo-button').disabled = !state.redo.length; $('#object-count').textContent = state.actions.length ? `${state.actions.length} ${state.actions.length === 1 ? 'mark' : 'marks'} on page` : 'Blank page'; }
// The exercise-builder preview is read-only: no marks may be added or
// removed while it is active (the canvas guard in input.js blocks most input,
// this covers keyboard undo/redo and any other commit path).
export function commit(a) { if (!a || window.__builderReadOnly) return; state.actions.push(a); state.redo = []; advanceConstruction(a); updateHistory(); render(); }
export function undo() { if (window.__builderReadOnly) return; const a = state.actions.pop(); if (a) { state.redo.push(a); updateHistory(); render(); } }
export function redo() { if (window.__builderReadOnly) return; const a = state.redo.pop(); if (a) { state.actions.push(a); updateHistory(); render(); } }
