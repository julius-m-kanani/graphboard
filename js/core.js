export const canvas = document.querySelector('#graph-canvas');
export const paperWrap = document.querySelector('#paper-wrap');
export const ctx = canvas.getContext('2d');
export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];

export const state = {
  tool: 'pencil', color: '#244bb3', scale: 32, origin: { x: 0, y: 0 },
  actions: [], redo: [], drawing: null, pointer: { x: 0, y: 0 },
  showGrid: true, showLabels: true, snapStep: 0.5, paper: 'square',
  dpr: 1, canvasSize: { width: 1, height: 1 }, hovering: false, compassAnchor: null, compassCarryRadius: null, divider: null, construction: null, drag: null
};

export function loadState(data) {
  state.actions = data.actions || [];
  state.redo = [];
  state.scale = data.scale || 32;
  state.origin = data.origin || { x: 0, y: 0 };
  state.snapStep = data.snapStep === undefined ? 0.5 : data.snapStep;
  state.paper = data.paper || 'square';
  state.showGrid = data.showGrid !== false;
  state.showLabels = data.showLabels !== false;
  state.color = data.color || '#244bb3';
  state.drawing = null;
  state.drag = null;
  state.divider = null;
  state.compassAnchor = null;
  state.compassCarryRadius = null;
  state.construction = null;
}

export const toolCopy = {
  pencil: ['Pencil', 'Draw naturally on the paper.'], point: ['Point', 'Place a precise coordinate point.'], label: ['Label', 'Click a point to rename it, or click empty space to place a labelled point.'],
  line: ['Straight line', 'Drag from one coordinate to another.'], ray: ['Ray', 'Drag from the start point through a second point — the ray extends forever from the start.'],
  ruler: ['Ruler', 'A guide appears as you draw a measured line.'],
  compass: ['Compass', 'Click to plant the needle. Its opening stays fixed after an arc; press Esc to move it, or X to release it.'],
  dividers: ['Dividers', 'Click two points to set the span. It stays held while you transfer it; press Esc or X to release.'],
  set45: ['45° set square', 'Drag along an edge. The line locks to the 45° and 90° edges.'], set60: ['30°/60° set square', 'Drag along an edge. The line locks to the 30°, 60° and 90° edges.'],
  protractor: ['Protractor', 'Draw an angle from the positive x-axis.'], hand: ['Move paper', 'Drag the graph paper to a better position.'], eraser: ['Rubber / eraser', 'Click a nearby mark to rub it out.'], move: ['Move', 'Click a mark and drag it to a new position.']
};

export const scaleMin = 0.25, scaleMax = 84;
export function clampScale(s) { return Math.max(scaleMin, Math.min(scaleMax, s)); }

export const screenToWorld = (p) => ({ x: (p.x - state.origin.x) / state.scale, y: (state.origin.y - p.y) / state.scale });
export const worldToScreen = (p) => ({ x: state.origin.x + p.x * state.scale, y: state.origin.y - p.y * state.scale });
export const snap = (p) => state.snapStep ? { x: Math.round(p.x / state.snapStep) * state.snapStep, y: Math.round(p.y / state.snapStep) * state.snapStep } : p;
export const pretty = (v) => Math.abs(v) < .001 ? '0' : (Math.round(v * 100) / 100).toString();
export const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function eventPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

export function polylineDistance(p, points) { if (points.length < 2) return Infinity; let closest = Infinity; for (let i = 1; i < points.length; i++) closest = Math.min(closest, segmentDistance(p, points[i - 1], points[i])); return closest; }
export function segmentDistance(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy; if (!len) return pointDistance(p, a); const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }
export function closestPointOnSegment(p, from, to) { const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy; if (!length) return { ...from }; const t = Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy) / length)); return { x: from.x + t * dx, y: from.y + t * dy }; }

export function showToast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove('show'), 2100); }
export function setToolTip(title, copy, keys = []) { const tips = keys.map(([key, label]) => `<kbd>${key}</kbd>${label ? ` ${label}` : ''}`).join('<span class="tip-sep">·</span>'); $('#tool-tip-card').innerHTML = `<b>${title}</b><span>${copy}</span>${keys.length ? `<span class="tip-keys">${tips}</span>` : ''}`; }
export function canvasCursor() { return state.tool === 'hand' ? 'grab' : state.tool === 'eraser' ? 'cell' : state.tool === 'move' ? (state.drag ? 'grabbing' : 'move') : 'crosshair'; }
export function pointOnMark(w) { let best = null, bestD = Infinity; state.actions.forEach(a => { let d = Infinity, p = null; if (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square' || a.type === 'ray') { d = segmentDistance(w, a.from, a.to); p = closestPointOnSegment(w, a.from, a.to); } else if (a.type === 'angle') { d = Math.min(pointDistance(w, a.center), segmentDistance(w, a.center, a.end)); p = pointDistance(w, a.center) <= segmentDistance(w, a.center, a.end) ? { x: a.center.x, y: a.center.y } : closestPointOnSegment(w, a.center, a.end); } else if (a.type === 'circle') { d = Math.abs(pointDistance(w, a.center) - a.radius); const r = a.radius, dist = pointDistance(w, a.center) || 1; p = { x: a.center.x + (w.x - a.center.x) * r / dist, y: a.center.y + (w.y - a.center.y) * r / dist }; } if (p && d < bestD) { bestD = d; best = p; } }); return best && bestD < .3 ? best : null; }
export function updateReadout(p) { const w = screenToWorld(p); let extra = ''; const a = state.drawing; if (a && (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square')) { const len = pointDistance(a.from, a.to); extra = `&nbsp;&nbsp;from (${pretty(a.from.x)}, ${pretty(a.from.y)}) → (${pretty(a.to.x)}, ${pretty(a.to.y)}) · ${pretty(len)} u`; } else if (a && a.type === 'ray') { const len = pointDistance(a.from, a.to); extra = `&nbsp;&nbsp;from (${pretty(a.from.x)}, ${pretty(a.from.y)}) through (${pretty(a.to.x)}, ${pretty(a.to.y)}) · ${pretty(len)} u`; } else { const m = pointOnMark(w); if (m) extra = `&nbsp;&nbsp;on line (${pretty(m.x)}, ${pretty(m.y)})`; } $('#coordinate-readout').innerHTML = `x: ${pretty(w.x)}&nbsp;&nbsp; y: ${pretty(w.y)}${extra}`; }
export function setTool(tool) { state.tool = tool; $$('.tool').forEach(el => el.classList.toggle('active', el.dataset.tool === tool)); const [name, copy] = toolCopy[tool]; setToolTip(name, copy); canvas.style.cursor = canvasCursor(); render(); }

let renderImpl = null;
export function registerRender(fn) { renderImpl = fn; }
export function render() { if (renderImpl) renderImpl(); }
