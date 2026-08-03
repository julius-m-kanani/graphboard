import { $, state, render } from './core.js';
import { advanceConstruction } from './construction.js';

export function updateHistory() { $('#undo-button').disabled = !state.actions.length; $('#redo-button').disabled = !state.redo.length; $('#object-count').textContent = state.actions.length ? `${state.actions.length} ${state.actions.length === 1 ? 'mark' : 'marks'} on page` : 'Blank page'; }
export function commit(a) { if (!a) return; state.actions.push(a); state.redo = []; advanceConstruction(a); updateHistory(); render(); }
export function undo() { const a = state.actions.pop(); if (a) { state.redo.push(a); updateHistory(); render(); } }
export function redo() { const a = state.redo.pop(); if (a) { state.actions.push(a); updateHistory(); render(); } }
