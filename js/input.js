import { $, $$, canvas, paperWrap, state, screenToWorld, worldToScreen, snap, pretty, pointDistance, eventPoint, polylineDistance, segmentDistance, closestPointOnSegment, showToast, setTool, setToolTip, canvasCursor, toolCopy, updateReadout, render, clampScale, ALL_SHAPES, shapeDistance, setDarkMode } from './core.js';
import { renderA4DataURL } from './print.js';
import { commit, undo, redo, updateHistory } from './history.js';
import { beginPerpendicular, beginAnyPerpendicular, findReferenceLine, setConstructionLine, constrainSetSquare, updateConstructionPanel } from './construction.js';

function eraseNear(w) {
  let best = -1, dist = Infinity;
  state.actions.forEach((a, i) => { let d = Infinity; if (a.type === 'point') d = pointDistance(a.at, w); else if (a.type === 'circle') d = Math.abs(pointDistance(a.center, w) - a.radius); else if (a.type === 'pencil') d = Math.min(...a.points.map(p => pointDistance(p, w))); else if (a.type === 'compass') d = polylineDistance(w, a.points); else if (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square' || a.type === 'ray' || a.type === 'dotted') d = segmentDistance(w, a.from, a.to); else if (ALL_SHAPES.includes(a.type)) d = shapeDistance(w, a); else if (a.type === 'angle') d = Math.min(pointDistance(w, a.center), segmentDistance(w, a.center, a.end)); if (d < dist) { dist = d; best = i; } });
  if (best >= 0 && dist < .55) { state.redo = []; state.actions.splice(best, 1); updateHistory(); render(); showToast('Mark erased'); } else showToast('No mark close enough to erase');
}
function pickAction(w) {
  let best = -1, bestD = Infinity;
  state.actions.forEach((a, i) => { let d = Infinity; if (a.type === 'point') d = pointDistance(a.at, w); else if (a.type === 'circle') d = Math.min(pointDistance(a.center, w), Math.abs(pointDistance(a.center, w) - a.radius)); else if (a.type === 'pencil') d = Math.min(...a.points.map(p => pointDistance(p, w))); else if (a.type === 'compass') d = polylineDistance(w, a.points); else if (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square' || a.type === 'ray' || a.type === 'dotted') d = segmentDistance(w, a.from, a.to); else if (ALL_SHAPES.includes(a.type)) d = shapeDistance(w, a); else if (a.type === 'angle') d = Math.min(pointDistance(w, a.center), segmentDistance(w, a.center, a.end)); if (d < bestD) { bestD = d; best = i; } }); return best >= 0 && bestD < .55 ? state.actions[best] : null;
}
function applyMove(a, dx, dy) {
  if (a.type === 'point') { a.at.x += dx; a.at.y += dy; if (a.label && a.label[0] === '(') a.label = `(${pretty(a.at.x)}, ${pretty(a.at.y)})`; return; }
  if (a.type === 'circle') { a.center.x += dx; a.center.y += dy; return; }
  if (a.type === 'compass') { a.center.x += dx; a.center.y += dy; a.points.forEach(p => { p.x += dx; p.y += dy }); return; }
  if (a.type === 'pencil') { a.points.forEach(p => { p.x += dx; p.y += dy }); return; }
  if (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square' || a.type === 'ray' || a.type === 'dotted' || ALL_SHAPES.includes(a.type)) { a.from.x += dx; a.from.y += dy; a.to.x += dx; a.to.y += dy; return; }
  if (a.type === 'angle') { a.center.x += dx; a.center.y += dy; a.end.x += dx; a.end.y += dy; }
}
function pickPointNear(w) { let best = null, bestD = Infinity; state.actions.forEach(a => { if (a.type !== 'point') return; const d = pointDistance(a.at, w); if (d < bestD) { bestD = d; best = a; } }); return best && bestD < .55 ? best : null; }
function nextPointLabel() {
  const used = new Set(state.actions.filter(a => a.type === 'point' && a.label).map(a => a.label));
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let n = 0;
  while (true) { let label = '', k = n; do { label = alpha[k % 26] + label; k = Math.floor(k / 26) - 1; } while (k >= 0); if (!used.has(label)) return label; n++; }
}
function showLabelEditor(world, existing) {
  const p = worldToScreen(world), input = document.createElement('input'); input.className = 'point-label-input'; input.value = existing && existing.label ? existing.label : ''; input.style.left = Math.round(p.x + 8) + 'px'; input.style.top = Math.round(p.y - 24) + 'px'; input.setAttribute('aria-label', 'Point label'); let done = false;
  const finish = () => { if (done) return; done = true; input.remove(); const label = input.value.trim(); if (existing) { existing.label = label; render(); } else commit({ type: 'point', at: world, color: state.color, label }); };
  const cancel = () => { if (done) return; done = true; input.remove(); render(); };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(); else if (e.key === 'Escape') cancel(); }); input.addEventListener('blur', finish); paperWrap.appendChild(input); input.focus(); input.select();
}
function zoomBy(f) { state.scale = clampScale(state.scale * f); state.origin = { x: state.canvasSize.width / 2, y: state.canvasSize.height / 2 }; $('#scale-readout').textContent = `1 unit = ${state.scale < 10 ? state.scale.toFixed(2) : Math.round(state.scale)} px`; render(); }
export function compileExpression(raw) {
  let expr = raw.trim().toLowerCase().replace(/^y\s*=\s*/, '').replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/\^/g, '**'); if (!expr) throw Error('Enter an equation first'); if (/[^0-9a-z+\-*/().,\s]/.test(expr)) throw Error('Use numbers, x, and standard operators only');
  const allowed = new Set(['x', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'abs', 'sqrt', 'log', 'ln', 'exp', 'pi', 'e']); const words = expr.match(/[a-z]+/g) || []; if (words.some(w => !allowed.has(w))) throw Error('Try x, sin, cos, sqrt, or other standard functions');
  expr = expr.replace(/\bln\b/g, 'Math.log').replace(/\b(sin|cos|tan|asin|acos|atan|abs|sqrt|log|exp)\b/g, 'Math.$1').replace(/\bpi\b/g, 'Math.PI').replace(/\be\b/g, 'Math.E').replace(/\bx\b/g, 'x'); return new Function('x', `"use strict"; return (${expr});`);
}
function plotEquation() { if (window.__builderReadOnly) { showToast('Preview is read-only — click Edit to keep building.'); return; } const input = $('#expression-input'); try { const fn = compileExpression(input.value); commit({ type: 'plot', fn, color: state.color, expression: input.value }); showToast(`Plotted y = ${input.value.replace(/^y\s*=\s*/i, '')}`); input.value = ''; } catch (err) { showToast(err.message); } }

function endDraw(e) {
  if (state.tool === 'move') { state.drag = null; canvas.style.cursor = canvasCursor(); render(); return; }
  if (!state.drawing) return; const a = state.drawing; state.drawing = null; canvas.style.cursor = canvasCursor();
  if (a.type === 'pan') { render(); return; }
  if (a.type === 'pencil' && a.points.length < 2) { render(); return; }
  if ((a.type === 'line' || a.type === 'ruler' || a.type === 'set-square' || a.type === 'ray' || a.type === 'dotted' || ALL_SHAPES.includes(a.type)) && pointDistance(a.from, a.to) < .1) { render(); return; }
  if (a.type === 'compass' && a.points.length < 2) { state.compassCarryRadius = a.radius; setToolTip('Compass opening held', 'Sweep the pencil leg to draw the arc, or press Esc to move the needle with this span.', [['Esc', 'replant, keeping span'], ['X', 'release opening']]); render(); showToast('Opening held in place — sweep to draw, Esc to move, X to release.'); return; }
  if (a.type === 'angle' && pointDistance(a.center, a.end) < .1) { render(); return; }
  if (a.type === 'compass') { state.compassCarryRadius = a.radius; setToolTip('Compass opening held', 'Move the needle to a new centre to keep this span, or release it.', [['Esc', 'replant, keeping span'], ['X', 'release opening']]); }
  commit(a);
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (err) {} const s = eventPoint(e); state.pointer = s; const rawWorld = screenToWorld(s); const constructionFree = state.construction && (state.tool === 'compass' || (state.tool === 'ruler' && (state.construction.step === 'ruler' || state.construction.step === 'choose-line')) || (state.tool === 'point' && state.construction.step === 'pick-point' && state.construction.mode === 'any')); const w = state.tool === 'pencil' || state.tool === 'eraser' || constructionFree ? rawWorld : snap(rawWorld);
  if (window.__builderReadOnly && state.tool !== 'hand' && !e.shiftKey && e.button !== 1) { showToast('Preview is read-only — click Edit to keep building.'); return; }
  if (state.tool === 'eraser') { eraseNear(w); return; }
  if (state.tool === 'move') { const target = pickAction(rawWorld); if (target) { state.drag = { action: target, from: { ...rawWorld } }; canvas.style.cursor = 'grabbing'; render(); } return; }
  if (state.tool === 'label') { showLabelEditor(rawWorld, pickPointNear(rawWorld)); return; }
  if (state.tool === 'dividers') {
    if (!state.divider) { state.divider = { anchor: w, tip: w, distance: 0, angle: 0, locked: false }; showToast('Place the second point to set the divider span.'); render(); return; }
    if (!state.divider.locked) { const distance = pointDistance(state.divider.anchor, w); if (distance < .12) { state.divider = { anchor: w, tip: w, distance: 0, angle: 0, locked: false }; render(); return; } state.divider = { ...state.divider, tip: w, distance, angle: Math.atan2(w.y - state.divider.anchor.y, w.x - state.divider.anchor.x), locked: true }; showToast(`Divider span held: ${pretty(distance)} units. Click a new point to transfer it.`); render(); return; }
    const d = state.divider; state.divider = { ...d, anchor: w, tip: { x: w.x + d.distance * Math.cos(d.angle), y: w.y + d.distance * Math.sin(d.angle) }, locked: true }; showToast('Distance transferred. Use the pencil to mark the second point if needed.'); render(); return;
  }
  if (state.construction && state.construction.step === 'choose-line') {
    const reference = findReferenceLine(rawWorld); if (reference) { if (setConstructionLine(state.construction, reference)) showToast('Reference line selected. Now choose P on it.'); return; }
    if (state.tool !== 'ruler') { setTool('ruler'); showToast('Use the ruler to draw the reference line, or click an existing one.'); return; }
  }
  if (state.construction && state.construction.step === 'pick-point') {
    const c = state.construction; let point; if (c.mode === 'axis') { if (Math.abs(rawWorld.x) > .35) { showToast('Choose P directly on the line x = 0.'); return; } point = { x: 0, y: state.snapStep ? Math.round(rawWorld.y / state.snapStep) * state.snapStep : rawWorld.y }; } else { point = closestPointOnSegment(rawWorld, c.line.from, c.line.to); if (pointDistance(rawWorld, point) > .38) { showToast('Choose P directly on the selected reference line.'); return; } }
    c.point = point; c.step = 'first-circle'; commit({ type: 'point', at: c.point, color: '#bf622b', label: 'P' }); state.compassAnchor = null; setTool('compass'); updateConstructionPanel(); showToast('P is set. Plant the compass needle on P.'); return;
  }
  if (state.tool === 'point') { commit({ type: 'point', at: w, color: state.color, label: nextPointLabel() }); return; }
  if (state.tool === 'hand' || e.shiftKey || e.button === 1) { state.drawing = { type: 'pan', from: s, origin: { ...state.origin } }; canvas.style.cursor = 'grabbing'; return; }
  if (state.tool === 'compass') {
    if (!state.compassAnchor) { state.compassAnchor = w; setToolTip('Compass needle planted', 'Press the pencil leg at your chosen radius and sweep — a quick click without sweeping holds the opening in place.', [['Esc', 'lift needle']]); showToast('Needle planted — choose the compass radius'); render(); return; }
    const radius = state.compassCarryRadius || pointDistance(state.compassAnchor, w); if (!state.compassCarryRadius && radius < .22) { state.compassAnchor = w; render(); return; }
    const angle = Math.atan2(w.y - state.compassAnchor.y, w.x - state.compassAnchor.x), pencil = { x: state.compassAnchor.x + radius * Math.cos(angle), y: state.compassAnchor.y + radius * Math.sin(angle) }; state.drawing = { type: 'compass', center: state.compassAnchor, radius, angles: [angle], points: [pencil], color: state.color }; render(); return;
  }
  const types = { pencil: 'pencil', line: 'line', ray: 'ray', dotted: 'dotted', ruler: 'ruler', set45: 'set-square', set60: 'set-square', protractor: 'angle', square: 'square', rectangle: 'rectangle', triangle: 'triangle', 'right-triangle': 'right-triangle', parallelogram: 'parallelogram', rhombus: 'rhombus', trapezoid: 'trapezoid', pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', star: 'star', circle: 'circle', ellipse: 'ellipse', arrow: 'arrow', 'double-arrow': 'double-arrow', cube: 'cube', cuboid: 'cuboid', 'triangular-prism': 'triangular-prism', 'square-pyramid': 'square-pyramid', tetrahedron: 'tetrahedron', cone: 'cone', cylinder: 'cylinder', sphere: 'sphere' }; const type = types[state.tool] || 'pencil';
  state.drawing = type === 'pencil' ? { type, points: [w], color: state.color } : type === 'set-square' ? { type, square: state.tool === 'set45' ? '45' : '60', color: state.color, from: w, to: w } : { type, color: state.color, from: w, to: w, center: w, end: w, radius: 0 }; render();
});
canvas.addEventListener('pointermove', e => {
  const s = eventPoint(e); state.pointer = s; updateReadout(s); if (state.tool === 'dividers' && state.divider) { const d = state.divider, raw = screenToWorld(s); if (!d.locked) { const distance = pointDistance(d.anchor, raw); if (distance > .03) state.divider = { ...d, tip: raw, distance, angle: Math.atan2(raw.y - d.anchor.y, raw.x - d.anchor.x) }; } else if (pointDistance(d.anchor, raw) > .05) { const angle = Math.atan2(raw.y - d.anchor.y, raw.x - d.anchor.x); state.divider = { ...d, angle, tip: { x: d.anchor.x + d.distance * Math.cos(angle), y: d.anchor.y + d.distance * Math.sin(angle) } }; } render(); return; } if (state.tool === 'move' && state.drag) { const raw = screenToWorld(s), d = state.drag; applyMove(d.action, raw.x - d.from.x, raw.y - d.from.y); d.from = { x: raw.x, y: raw.y }; render(); return; } if (!state.drawing) { render(); return; } if (state.drawing.type === 'pan') { state.origin = { x: state.drawing.origin.x + s.x - state.drawing.from.x, y: state.drawing.origin.y + s.y - state.drawing.from.y }; render(); return; } const a = state.drawing, raw = screenToWorld(s), w = a.type === 'pencil' || a.type === 'compass' || a.type === 'set-square' || (a.type === 'ruler' && state.construction && (state.construction.step === 'ruler' || state.construction.step === 'choose-line')) ? raw : snap(raw);
  if (a.type === 'pencil') { const last = a.points[a.points.length - 1]; if (pointDistance(last, w) > .035) a.points.push(w) }
  else if (a.type === 'compass') { const angle = Math.atan2(w.y - a.center.y, w.x - a.center.x), previous = a.angles[a.angles.length - 1], delta = Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous)); if (Math.abs(delta) > .003) { const next = previous + delta; a.angles.push(next); a.points.push({ x: a.center.x + a.radius * Math.cos(next), y: a.center.y + a.radius * Math.sin(next) }); } }
  else if (a.type === 'set-square') { a.to = constrainSetSquare(a.from, w, a.square) }
  else if (a.type === 'angle') { a.end = w }
  else a.to = w; render();
});
canvas.addEventListener('pointerup', endDraw); canvas.addEventListener('pointercancel', endDraw); canvas.addEventListener('pointerleave', () => { state.hovering = false; });
canvas.addEventListener('wheel', e => { e.preventDefault(); const s = eventPoint(e), anchor = screenToWorld(s); state.scale = clampScale(state.scale * (e.deltaY < 0 ? 1.12 : .89)); state.origin = { x: s.x - anchor.x * state.scale, y: s.y + anchor.y * state.scale }; $('#scale-readout').textContent = `1 unit = ${state.scale < 10 ? state.scale.toFixed(2) : Math.round(state.scale)} px`; render(); }, { passive: false });

$$('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#shape-select')?.addEventListener('change', e => { if (e.target.value) setTool(e.target.value); });
$('#shape3d-select')?.addEventListener('change', e => { if (e.target.value) setTool(e.target.value); });
$('#perpendicular-button').addEventListener('click', beginPerpendicular);
$('#any-perpendicular-button').addEventListener('click', beginAnyPerpendicular);
$$('.swatch').forEach(b => b.addEventListener('click', () => { state.color = b.dataset.color; $$('.swatch').forEach(s => s.classList.toggle('active', s === b)); }));
$('#undo-button').addEventListener('click', undo); $('#redo-button').addEventListener('click', redo);
$('#clear-button').addEventListener('click', () => { if (window.__builderReadOnly) { showToast('Preview is read-only — click Edit to keep building.'); return; } if (!state.actions.length) return; state.redo.push(...state.actions); state.actions = []; updateHistory(); render(); showToast('The page is clear'); });
$('#zoom-in').addEventListener('click', () => zoomBy(1.2)); $('#zoom-out').addEventListener('click', () => zoomBy(.83));
$('#grid-toggle').addEventListener('click', () => { state.showGrid = !state.showGrid; render(); showToast(state.showGrid ? 'Grid shown' : 'Grid hidden'); });
$('#theme-toggle')?.addEventListener('click', () => { setDarkMode(!state.darkMode); showToast(state.darkMode ? 'Blackboard mode — chalk on dark' : 'White paper mode'); });
$$('.segmented button[data-snap]').forEach(b => b.addEventListener('click', () => { state.snapStep = Number(b.dataset.snap); $$('.segmented button[data-snap]').forEach(x => x.classList.toggle('active', x === b)); showToast(state.snapStep ? (state.snapStep === .5 ? 'Snap to ½-unit grid — new points land on half-grid intersections' : `Snap to ${state.snapStep}-unit grid — new points land on grid intersections`) : 'Snap: Free — new points land exactly where you click'); updateReadout(state.pointer); }));
$('#labels-toggle').addEventListener('change', e => { state.showLabels = e.target.checked; render(); });
$$('.segmented button[data-paper]').forEach(b => b.addEventListener('click', () => { state.paper = b.dataset.paper; $$('.segmented button[data-paper]').forEach(x => x.classList.toggle('active', x === b)); render(); }));
$('#apply-range').addEventListener('click', () => { const xmin = Number($('#x-min').value), xmax = Number($('#x-max').value), ymin = Number($('#y-min').value), ymax = Number($('#y-max').value); if (![xmin, xmax, ymin, ymax].every(Number.isFinite) || xmax <= xmin || ymax <= ymin) { showToast('Enter a valid minimum and maximum range'); return; } const width = state.canvasSize.width, height = state.canvasSize.height; state.scale = clampScale(Math.min(width / (xmax - xmin), height / (ymax - ymin))); state.origin = { x: -xmin * state.scale + (width - (xmax - xmin) * state.scale) / 2, y: ymax * state.scale + (height - (ymax - ymin) * state.scale) / 2 }; $('#scale-readout').textContent = `1 unit = ${state.scale < 10 ? state.scale.toFixed(2) : Math.round(state.scale)} px`; render(); });
$('#plot-button').addEventListener('click', plotEquation); $('#expression-input').addEventListener('keydown', e => { if (e.key === 'Enter') plotEquation() });
$('#equation-help').addEventListener('click', () => showToast('Examples: 2*x + 1, x^2 - 4, sin(x). Use radians for trig.'));
$('#export-button').addEventListener('click', () => { render(); const exportCanvas = document.createElement('canvas'); exportCanvas.width = canvas.width; exportCanvas.height = canvas.height; const ex = exportCanvas.getContext('2d'); ex.drawImage(canvas, 0, 0); const a = document.createElement('a'); a.download = `${$('.document-name input').value.trim() || 'graphboard'}.png`; a.href = exportCanvas.toDataURL('image/png'); a.click(); showToast('Graph exported as a PNG'); });
$('#print-a4-button')?.addEventListener('click', () => {
  showToast('Preparing A4 print…');
  setTimeout(() => {
    let url;
    try { url = renderA4DataURL(); } catch (err) { showToast('Could not prepare the print page.'); return; }
    const img = document.getElementById('print-sheet-image');
    let printed = false;
    const printOnce = () => { if (!printed) { printed = true; window.print(); } };
    img.onload = printOnce;
    img.src = url;
    if (img.complete) printOnce();
  }, 40);
});
$('#settings-collapse').addEventListener('click', () => showToast('Graph settings stay available on the right.'));
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Escape' && state.compassAnchor) { state.compassAnchor = null; setToolTip('Compass lifted', 'Click to plant the needle at a new centre — the opening is held.', [['X', 'release opening']]); render(); showToast('Compass lifted — choose a new needle point with the opening held'); return; }
  if (e.key === 'Escape' && state.divider) { state.divider = null; render(); showToast('Dividers lifted'); return; }
  if (e.code === 'Space') { e.preventDefault(); setTool('hand'); }
  const key = e.key.toLowerCase(); if (key === 'x' && (state.compassCarryRadius || state.divider)) { state.compassAnchor = null; state.compassCarryRadius = null; state.divider = null; const [name, copy] = toolCopy[state.tool]; setToolTip(name, copy); render(); showToast('Instrument opening released'); return; }
  if (key === 'b' && !e.ctrlKey && !e.metaKey) { setDarkMode(!state.darkMode); showToast(state.darkMode ? 'Blackboard mode — chalk on dark' : 'White paper mode'); return; }
  const keys = { p: 'pencil', o: 'point', n: 'label', l: 'line', t: 'ray', y: 'dotted', r: 'ruler', c: 'compass', d: 'dividers', q: 'set45', w: 'set60', a: 'protractor', m: 'move', h: 'hand', e: 'eraser' }; if (keys[key]) setTool(keys[key]);
});
