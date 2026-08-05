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
  pencil: ['Pencil', 'Draw naturally on the paper.'], point: ['Point', 'Place a point, labelled A, B, C… in turn.'], label: ['Label', 'Click a point to rename it, or click empty space to place a labelled point.'],
  line: ['Straight line', 'Drag from one coordinate to another.'], ray: ['Dotted line', 'Drag from one point to another to draw a dotted line with a measured length.'],
  ruler: ['Ruler', 'A guide appears as you draw a measured line.'],
  compass: ['Compass', 'Click to plant the needle. Its opening stays fixed after an arc; press Esc to move it, or X to release it.'],
  dividers: ['Dividers', 'Click two points to set the span. It stays held while you transfer it; press Esc or X to release.'],
  set45: ['45° set square', 'Drag along an edge. The line locks to the 45° and 90° edges.'], set60: ['30°/60° set square', 'Drag along an edge. The line locks to the 30°, 60° and 90° edges.'],
  protractor: ['Protractor', 'Draw an angle from the positive x-axis.'], hand: ['Move paper', 'Drag the graph paper to a better position.'], eraser: ['Rubber / eraser', 'Click a nearby mark to rub it out.'], move: ['Move', 'Click a mark and drag it to a new position.'],
  square: ['Square', 'Drag to set the size — sides stay equal.'], rectangle: ['Rectangle', 'Drag to set the width and height.'], triangle: ['Equilateral triangle', 'Drag to set the size of an equilateral triangle.'], 'right-triangle': ['Right triangle', 'Drag to set the size of a right triangle.'], parallelogram: ['Parallelogram', 'Drag to set the size and slant.'], rhombus: ['Rhombus', 'Drag to set the size of a diamond.'], trapezoid: ['Trapezoid', 'Drag to set the size of a trapezoid.'], pentagon: ['Pentagon', 'Drag to set the size of a regular pentagon.'], hexagon: ['Hexagon', 'Drag to set the size of a regular hexagon.'], octagon: ['Octagon', 'Drag to set the size of a regular octagon.'], star: ['Star', 'Drag to set the size of a five-pointed star.'], circle: ['Circle', 'Drag to set the radius.'], ellipse: ['Ellipse', 'Drag to set the width and height.'], arrow: ['Arrow', 'Drag to draw a block arrow.'], 'double-arrow': ['Double arrow', 'Drag to draw a double-headed block arrow.']
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

export const SHAPES = ['square', 'rectangle', 'triangle', 'right-triangle', 'parallelogram', 'rhombus', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star', 'circle', 'ellipse', 'arrow', 'double-arrow'];
function regularVertices(n, cx, cy, r, inner = 1) { const pts = []; for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n, rad = i % 2 === 0 ? r : r * inner; pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) }); } return pts; }
export function shapeVertices(shape, from, to) {
  const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2, r = Math.max(.001, pointDistance(from, to) / 2);
  const x0 = Math.min(from.x, to.x), x1 = Math.max(from.x, to.x), y0 = Math.min(from.y, to.y), y1 = Math.max(from.y, to.y), w = x1 - x0, h = y1 - y0, midY = (y0 + y1) / 2;
  if (shape === 'rectangle') return [{ x: from.x, y: from.y }, { x: to.x, y: from.y }, { x: to.x, y: to.y }, { x: from.x, y: to.y }];
  if (shape === 'square') { const s = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)); return [{ x: from.x, y: from.y }, { x: from.x + s, y: from.y }, { x: from.x + s, y: from.y + s }, { x: from.x, y: from.y + s }]; }
  if (shape === 'triangle') return regularVertices(3, cx, cy, r);
  if (shape === 'right-triangle') return [{ x: from.x, y: from.y }, { x: to.x, y: from.y }, { x: from.x, y: to.y }];
  if (shape === 'parallelogram') { const k = w * .22; return [{ x: from.x + k, y: from.y }, { x: to.x + k, y: from.y }, { x: to.x, y: to.y }, { x: from.x, y: to.y }]; }
  if (shape === 'rhombus') return [{ x: cx, y: from.y }, { x: to.x, y: cy }, { x: cx, y: to.y }, { x: from.x, y: cy }];
  if (shape === 'trapezoid') return [{ x: x0 + w * .25, y: y0 }, { x: x1 - w * .25, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  if (shape === 'pentagon') return regularVertices(5, cx, cy, r);
  if (shape === 'hexagon') return regularVertices(6, cx, cy, r);
  if (shape === 'octagon') return regularVertices(8, cx, cy, r);
  if (shape === 'star') return regularVertices(10, cx, cy, r, .45);
  if (shape === 'ellipse') { const pts = []; const rx = Math.max(.001, Math.abs(to.x - from.x) / 2), ry = Math.max(.001, Math.abs(to.y - from.y) / 2); for (let i = 0; i < 32; i++) { const a = i * 2 * Math.PI / 32; pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }); } return pts; }
  if (shape === 'arrow') { const head = Math.min(w * .4, Math.max(8, h * 1.2)), hh = Math.min(h * .3, head * .6); return [{ x: x0, y: y0 }, { x: x1 - head, y: y0 }, { x: x1 - head, y: midY - hh }, { x: x1, y: midY }, { x: x1 - head, y: midY + hh }, { x: x1 - head, y: y1 }, { x: x0, y: y1 }]; }
  if (shape === 'double-arrow') { const head = Math.min(w * .4, Math.max(8, h * 1.2)), hh = Math.min(h * .3, head * .6); return [{ x: x0 + head, y: y0 }, { x: x1 - head, y: y0 }, { x: x1 - head, y: midY - hh }, { x: x1, y: midY }, { x: x1 - head, y: midY + hh }, { x: x1 - head, y: y1 }, { x: x0 + head, y: y1 }, { x: x0 + head, y: midY + hh }, { x: x0, y: midY }, { x: x0 + head, y: midY - hh }]; }
  return [];
}
export function circleCenterRadius(shape, from, to) { const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2; if (shape === 'circle') { const r = pointDistance(from, to) / 2; return { cx, cy, rx: r, ry: r }; } return { cx, cy, rx: Math.max(.001, Math.abs(to.x - from.x) / 2), ry: Math.max(.001, Math.abs(to.y - from.y) / 2) }; }
export function closestPointOnShape(w, a) {
  if (a.type === 'circle') { const { cx, cy, rx } = circleCenterRadius('circle', a.from, a.to); const d = Math.max(Math.hypot(w.x - cx, w.y - cy), 1e-6); return { x: cx + (w.x - cx) * rx / d, y: cy + (w.y - cy) * rx / d }; }
  const pts = a.type === 'ellipse' ? shapeVertices('ellipse', a.from, a.to) : shapeVertices(a.type, a.from, a.to); let best = null, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) { const q = closestPointOnSegment(w, pts[i], pts[(i + 1) % pts.length]), d = pointDistance(w, q); if (d < bestD) { bestD = d; best = q; } }
  return best;
}
export function shapeDistance(w, a) { if (a.type === 'circle') { const { cx, cy, rx } = circleCenterRadius('circle', a.from, a.to); return Math.abs(Math.hypot(w.x - cx, w.y - cy) - rx); } const q = closestPointOnShape(w, a); return q ? pointDistance(w, q) : Infinity; }

export function showToast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove('show'), 2100); }
export function setToolTip(title, copy, keys = []) { const tips = keys.map(([key, label]) => `<kbd>${key}</kbd>${label ? ` ${label}` : ''}`).join('<span class="tip-sep">·</span>'); $('#tool-tip-card').innerHTML = `<b>${title}</b><span>${copy}</span>${keys.length ? `<span class="tip-keys">${tips}</span>` : ''}`; }
export function canvasCursor() { return state.tool === 'hand' ? 'grab' : state.tool === 'eraser' ? 'cell' : state.tool === 'move' ? (state.drag ? 'grabbing' : 'move') : 'crosshair'; }
export function pointOnMark(w) { let best = null, bestD = Infinity; state.actions.forEach(a => { let d = Infinity, p = null; if (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square' || a.type === 'ray') { d = segmentDistance(w, a.from, a.to); p = closestPointOnSegment(w, a.from, a.to); } else if (a.type === 'angle') { d = Math.min(pointDistance(w, a.center), segmentDistance(w, a.center, a.end)); p = pointDistance(w, a.center) <= segmentDistance(w, a.center, a.end) ? { x: a.center.x, y: a.center.y } : closestPointOnSegment(w, a.center, a.end); } else if (a.type === 'circle') { d = Math.abs(pointDistance(w, a.center) - a.radius); const r = a.radius, dist = pointDistance(w, a.center) || 1; p = { x: a.center.x + (w.x - a.center.x) * r / dist, y: a.center.y + (w.y - a.center.y) * r / dist }; } else if (SHAPES.includes(a.type)) { p = closestPointOnShape(w, a); d = p ? pointDistance(w, p) : Infinity; } if (p && d < bestD) { bestD = d; best = p; } }); return best && bestD < .3 ? best : null; }
export function updateReadout(p) { const w = screenToWorld(p); let extra = ''; const a = state.drawing; if (a && (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square')) { const len = pointDistance(a.from, a.to); extra = `&nbsp;&nbsp;from (${pretty(a.from.x)}, ${pretty(a.from.y)}) → (${pretty(a.to.x)}, ${pretty(a.to.y)}) · ${pretty(len)} u`; } else if (a && a.type === 'ray') { const len = pointDistance(a.from, a.to); extra = `&nbsp;&nbsp;from (${pretty(a.from.x)}, ${pretty(a.from.y)}) to (${pretty(a.to.x)}, ${pretty(a.to.y)}) · ${pretty(len)} u`; } else if (a && SHAPES.includes(a.type)) { const bw = Math.abs(a.to.x - a.from.x), bh = Math.abs(a.to.y - a.from.y); extra = a.type === 'circle' ? `&nbsp;&nbsp;radius ${pretty(bw / 2)} u · diameter ${pretty(bw)} u` : a.type === 'ellipse' ? `&nbsp;&nbsp;rx ${pretty(bw / 2)} × ry ${pretty(bh / 2)}` : `&nbsp;&nbsp;width ${pretty(bw)} × height ${pretty(bh)}`; } else { let point = null; for (const act of state.actions) if (act.type === 'point' && pointDistance(act.at, w) < .55) { point = act; break; } if (point) { extra = `&nbsp;&nbsp;${point.label ? point.label + ' ' : ''}(${pretty(point.at.x)}, ${pretty(point.at.y)})`; } else { const m = pointOnMark(w); if (m) extra = `&nbsp;&nbsp;on line (${pretty(m.x)}, ${pretty(m.y)})`; } } $('#coordinate-readout').innerHTML = `x: ${pretty(w.x)}&nbsp;&nbsp; y: ${pretty(w.y)}${extra}`; }
export function setTool(tool) { state.tool = tool; $$('.tool').forEach(el => el.classList.toggle('active', el.dataset.tool === tool)); const [name, copy] = toolCopy[tool]; setToolTip(name, copy); canvas.style.cursor = canvasCursor(); render(); }

let renderImpl = null;
export function registerRender(fn) { renderImpl = fn; }
export function render() { if (renderImpl) renderImpl(); }
