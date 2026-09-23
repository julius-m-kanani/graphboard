import { canvas, paperWrap, ctx as screenCtx, state, screenToWorld, worldToScreen, pretty, pointDistance, render, registerRender, SHAPES, SHAPES3D, shapeVertices, circleCenterRadius, solidGeometry, resolveInk, canvasPalette } from './core.js';

// Rendering target. Normally the on-screen context; printing temporarily
// redirects it to a high-resolution offscreen canvas (see js/print.js).
let g = screenCtx;
export function withPrintContext(c, fn) { const prev = g; g = c; try { return fn(); } finally { g = prev; } }

function minorGridStep() {
  const candidates = [0.05, 0.1, 0.125, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  for (const s of candidates) if (s * state.scale >= 9) return s;
  return candidates[candidates.length - 1];
}
function isMultiple(v, m) { return Math.abs(v / m - Math.round(v / m)) < 1e-6; }
function gridFraction(s) { return ({ 0.05: '1/20', 0.1: '⅒', 0.125: '⅛', 0.2: '⅕', 0.25: '¼', 0.5: '½' }[s] || String(Math.round(s))); }
function renderGrid() {
  const { width, height } = state.canvasSize;
  const pal = canvasPalette();
  g.save();
  g.fillStyle = pal.paper; g.fillRect(0, 0, width, height);
  if (state.showGrid && state.paper !== 'blank') {
    const min = screenToWorld({ x: 0, y: height }); const max = screenToWorld({ x: width, y: 0 });
    const minor = minorGridStep();
    const fromX = Math.floor(min.x / minor) - 1, toX = Math.ceil(max.x / minor) + 1, fromY = Math.floor(min.y / minor) - 1, toY = Math.ceil(max.y / minor) + 1;
    // Snap lines to whole device pixels: a 1px line drawn at a fractional
    // coordinate anti-aliases across two pixels at half strength and almost
    // disappears on a projector. Rounding first keeps full contrast.
    const crisp = (v) => Math.round(v) + 0.5;
    if (state.paper === 'dot') {
      g.fillStyle = pal.dot;
      for (let ix = fromX; ix <= toX; ix++) for (let iy = fromY; iy <= toY; iy++) { const p = worldToScreen({ x: ix * minor, y: iy * minor }); g.beginPath(); g.arc(p.x, p.y, 1.5, 0, Math.PI * 2); g.fill(); }
    } else {
      for (let ix = fromX; ix <= toX; ix++) {
        const x = ix * minor, p = worldToScreen({ x, y: 0 });
        const sx = crisp(p.x);
        g.beginPath();
        if (isMultiple(x, 5)) { g.strokeStyle = pal.major; g.lineWidth = 1.25; }
        else if (isMultiple(x, 1)) { g.strokeStyle = pal.unit; g.lineWidth = 1; }
        else { g.strokeStyle = pal.minor; g.lineWidth = 1; }
        g.moveTo(sx, 0); g.lineTo(sx, height); g.stroke();
      }
      for (let iy = fromY; iy <= toY; iy++) {
        const y = iy * minor, p = worldToScreen({ x: 0, y });
        const sy = crisp(p.y);
        g.beginPath();
        if (isMultiple(y, 5)) { g.strokeStyle = pal.major; g.lineWidth = 1.25; }
        else if (isMultiple(y, 1)) { g.strokeStyle = pal.unit; g.lineWidth = 1; }
        else { g.strokeStyle = pal.minor; g.lineWidth = 1; }
        g.moveTo(0, sy); g.lineTo(width, sy); g.stroke();
      }
    }
  }
  const note = document.querySelector('.canvas-corner-note');
  if (note) note.innerHTML = state.paper === 'blank' || !state.showGrid ? '' : `GRAPH PAPER&nbsp; · &nbsp;SQUARES = ${gridFraction(minorGridStep())} UNIT`;
  g.strokeStyle = pal.axis; g.lineWidth = 2; g.beginPath();
  const ax = Math.round(state.origin.x), ay = Math.round(state.origin.y);
  g.moveTo(0, ay); g.lineTo(width, ay); g.moveTo(ax, 0); g.lineTo(ax, height); g.stroke();
  const axisArrow = (x, y, angle) => { g.save(); g.translate(x, y); g.rotate(angle); g.fillStyle = pal.axis; g.beginPath(); g.moveTo(0, 0); g.lineTo(-6, 3); g.lineTo(-6, -3); g.closePath(); g.fill(); g.restore(); };
  axisArrow(width - 4, state.origin.y, 0); axisArrow(4, state.origin.y, Math.PI); axisArrow(state.origin.x, 4, -Math.PI / 2); axisArrow(state.origin.x, height - 4, Math.PI / 2);
  if (state.showLabels) renderLabels();
  g.restore();
}
function renderLabels() {
  const { width, height } = state.canvasSize; const min = screenToWorld({ x: 0, y: height }), max = screenToWorld({ x: width, y: 0 });
  if (max.x - min.x > 600 || max.y - min.y > 600) return;
  const pal = canvasPalette();
  g.save(); g.fillStyle = pal.label; g.font = '10px "DM Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let x = Math.ceil(min.x); x <= Math.floor(max.x); x++) { if (x && x % 1 === 0) { const p = worldToScreen({ x, y: 0 }); if (p.x > 12 && p.x < width - 12) { g.fillText(x, p.x, Math.min(height - 14, Math.max(4, state.origin.y + 6))); } } }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let y = Math.ceil(min.y); y <= Math.floor(max.y); y++) { if (y && y % 1 === 0) { const p = worldToScreen({ x: 0, y }); if (p.y > 9 && p.y < height - 9) { g.fillText(y, Math.min(width - 3, Math.max(17, state.origin.x - 6)), p.y); } } }
  g.fillStyle = pal.labelAxis; g.font = 'italic 12px Georgia,serif'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('x', width - 14, Math.max(13, state.origin.y - 5)); g.fillText('y', state.origin.x + 7, 13); g.restore();
}
function drawAction(a, preview = false) {
  const pal = canvasPalette();
  const ink = resolveInk(a.color);
  g.save(); g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round';
  if (a.type === 'pencil') { if (a.points.length < 2) { g.restore(); return; } g.lineWidth = 1.8; g.beginPath(); a.points.forEach((p, i) => { const s = worldToScreen(p); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y) }); g.stroke(); }
  if (a.type === 'point') { const p = worldToScreen(a.at); g.beginPath(); g.arc(p.x, p.y, 4.1, 0, Math.PI * 2); g.fill(); g.fillStyle = pal.hole; g.beginPath(); g.arc(p.x, p.y, 1.2, 0, Math.PI * 2); g.fill(); if (a.label) { g.font = '11px "DM Mono",monospace'; g.fillStyle = ink; g.fillText(a.label, p.x + 7, p.y - 7); } }
  if (a.type === 'dotted') {
    const p1 = worldToScreen(a.from), p2 = worldToScreen(a.to); const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
    if (len >= 2) { g.lineCap = 'butt'; g.setLineDash([2, 4]); g.lineWidth = 2; g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); g.setLineDash([]); g.lineCap = 'round'; }
  }
  if (a.type === 'ray') {
    const p1 = worldToScreen(a.from), p2 = worldToScreen(a.to); const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
    if (len >= 2) {
      const ux = dx / len, uy = dy / len, { width, height } = state.canvasSize;
      let t = 0;
      if (ux > 0) t = Math.max(t, (width - p1.x) / ux);
      if (ux < 0) t = Math.max(t, (-p1.x) / ux);
      if (uy > 0) t = Math.max(t, (height - p1.y) / uy);
      if (uy < 0) t = Math.max(t, (-p1.y) / uy);
      const ex = p1.x + ux * t, ey = p1.y + uy * t;
      g.lineCap = 'butt'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(ex, ey); g.stroke();
      g.fillStyle = ink;
      const ah = 9, aw = 4;
      g.beginPath(); g.moveTo(ex, ey);
      g.lineTo(ex - ux * ah - uy * aw, ey - uy * ah + ux * aw);
      g.lineTo(ex - ux * ah + uy * aw, ey - uy * ah - ux * aw);
      g.closePath(); g.fill();
      g.beginPath(); g.arc(p1.x, p1.y, 3.6, 0, Math.PI * 2); g.fill();
      g.lineCap = 'round';
    }
  }
  if (SHAPES.includes(a.type) || SHAPES3D.includes(a.type)) {
    g.lineWidth = 2;
    if (a.type === 'circle') { const { cx, cy, rx } = circleCenterRadius('circle', a.from, a.to); const p = worldToScreen({ x: cx, y: cy }); g.beginPath(); g.arc(p.x, p.y, rx * state.scale, 0, Math.PI * 2); g.stroke(); }
    else if (a.type === 'ellipse') { const { cx, cy, rx, ry } = circleCenterRadius('ellipse', a.from, a.to); const p = worldToScreen({ x: cx, y: cy }); g.beginPath(); g.ellipse(p.x, p.y, rx * state.scale, ry * state.scale, 0, 0, Math.PI * 2); g.stroke(); }
    else if (SHAPES3D.includes(a.type)) { drawSolidWire(a); }
    else { const pts = shapeVertices(a.type, a.from, a.to).map(worldToScreen); if (pts.length) { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); g.stroke(); } }
  }
  if (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square') { const p1 = worldToScreen(a.from), p2 = worldToScreen(a.to); g.lineWidth = 2; g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); if (a.type === 'ruler' && preview) drawRuler(p1, p2); if (a.type === 'set-square' && preview) drawSetSquare(p1, p2, a.square); }
  if (a.type === 'circle') { const p = worldToScreen(a.center); g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, a.radius * state.scale, 0, Math.PI * 2); g.stroke(); g.fillStyle = pal.hole; g.beginPath(); g.arc(p.x, p.y, 2.6, 0, Math.PI * 2); g.fill(); g.strokeStyle = ink; g.lineWidth = 1.3; g.stroke(); }
  if (a.type === 'compass') { if (a.points.length > 1) { g.lineWidth = 2.2; g.beginPath(); a.points.forEach((p, i) => { const s = worldToScreen(p); i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y) }); g.stroke(); } }
  if (a.type === 'angle') { const c = worldToScreen(a.center), e = worldToScreen(a.end), r = Math.min(1.25 * state.scale, pointDistance(c, e) * .65); const angle = Math.atan2(c.y - e.y, e.x - c.x); g.lineWidth = 2; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(e.x, e.y); g.stroke(); g.lineWidth = 1.3; g.beginPath(); g.arc(c.x, c.y, r, 0, angle, true); g.stroke(); g.font = '11px "DM Mono",monospace'; g.fillStyle = ink; g.fillText(`${Math.round((angle * 180 / Math.PI + 360) % 360)}°`, c.x + r + 5, c.y - 5); }
  if (a.type === 'plot') drawPlot(a, ink);
  g.restore();
}
function drawSolidWire(a) {
  const g = solidGeometry(a.type, a.from, a.to);
  for (const e of g.edges) {
    const p1 = worldToScreen(g.pts[e.a]), p2 = worldToScreen(g.pts[e.b]);
    g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y);
    if (e.hidden) { g.setLineDash([2, 4]); g.globalAlpha = .5; } else { g.setLineDash([]); g.globalAlpha = 1; }
    g.stroke();
  }
  g.setLineDash([]); g.globalAlpha = 1;
}
function drawRuler(p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy); if (len < 2) return; g.save(); g.translate(p1.x, p1.y); g.rotate(Math.atan2(dy, dx)); g.fillStyle = '#e7e8d1c9'; g.strokeStyle = '#9b9f7c'; g.lineWidth = 1; g.fillRect(0, -15, len, 30); g.strokeRect(0, -15, len, 30); g.fillStyle = '#6f765a'; g.font = '8px "DM Mono",monospace'; for (let x = 0; x < len; x += state.scale / 5) { const major = Math.round(x / (state.scale / 5)) % 5 === 0; g.fillRect(x, -15, 1, major ? 9 : 5); g.fillRect(x, major ? 6 : 10, 1, major ? 9 : 5); if (major && x > 5) g.fillText(String(Math.round(x / state.scale)), x + 2, -7) } g.textAlign = 'center'; g.fillText(`${pretty(len / state.scale)} units`, len / 2, 4); g.restore();
}
function drawSetSquare(p1, p2, square) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy); if (len < 8) return; const nx = -dy / len, ny = dx / len, ratio = square === '45' ? 1 : .577; const third = { x: p1.x + nx * len * ratio, y: p1.y + ny * len * ratio }; g.save(); g.fillStyle = '#cfe5f06e'; g.strokeStyle = '#5e8aadbb'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(third.x, third.y); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#4f7391'; g.font = '9px "DM Mono",monospace'; g.fillText(square === '45' ? '45°' : '30°  60°', p1.x + nx * 13 + 4, p1.y + ny * 13 + 4); g.strokeStyle = '#5e8aad'; g.strokeRect(p1.x + nx * 5 - dx / len * 3, p1.y + ny * 5 - dy / len * 3, 6, 6); g.restore();
}
function drawPlot(a, ink) {
  const { width } = state.canvasSize; const fn = a.fn; g.strokeStyle = ink || resolveInk(a.color); g.lineWidth = 2.2; g.beginPath(); let started = false, lastY = null;
  for (let sx = 0; sx <= width; sx += 1) { const x = (sx - state.origin.x) / state.scale; let y; try { y = fn(x) } catch { y = NaN } const sy = state.origin.y - y * state.scale; if (!Number.isFinite(y) || Math.abs(sy) > 100000 || (lastY !== null && Math.abs(sy - lastY) > state.canvasSize.height * 2)) { started = false; lastY = null; continue; } if (!started) { g.moveTo(sx, sy); started = true } else g.lineTo(sx, sy); lastY = sy; } g.stroke();
}
function compassPoint(a) { const angle = a.angles[a.angles.length - 1]; return { x: a.center.x + a.radius * Math.cos(angle), y: a.center.y + a.radius * Math.sin(angle) }; }
function drawCompassInstrument(center, pencil, color = '#244bb3', opacity = 1) {
  const needle = worldToScreen(center), lead = worldToScreen(pencil), dx = lead.x - needle.x, dy = lead.y - needle.y, len = Math.hypot(dx, dy); if (len < 10) return;
  let nx = -dy / len, ny = dx / len, rise = Math.min(74, Math.max(29, len * .52)); if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } const hinge = { x: (needle.x + lead.x) / 2 + nx * rise, y: (needle.y + lead.y) / 2 + ny * rise };
  g.save(); g.globalAlpha = opacity; g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#59696d'; g.lineWidth = 6; g.beginPath(); g.moveTo(needle.x, needle.y); g.lineTo(hinge.x, hinge.y); g.lineTo(lead.x, lead.y); g.stroke();
  g.strokeStyle = '#bec7c5'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(needle.x, needle.y); g.lineTo(hinge.x, hinge.y); g.lineTo(lead.x, lead.y); g.stroke();
  g.fillStyle = '#3e5158'; g.beginPath(); g.arc(hinge.x, hinge.y, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e3c978'; g.beginPath(); g.arc(hinge.x, hinge.y, 3.1, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#33464c'; g.beginPath(); g.moveTo(needle.x, needle.y); g.lineTo(needle.x - 4 * nx - 2 * dx / len, needle.y - 4 * ny - 2 * dy / len); g.lineTo(needle.x + 4 * nx - 2 * dx / len, needle.y + 4 * ny - 2 * dy / len); g.closePath(); g.fill();
  g.strokeStyle = color; g.lineWidth = 3; g.beginPath(); g.moveTo(lead.x - dx / len * 9, lead.y - dy / len * 9); g.lineTo(lead.x, lead.y); g.stroke(); g.fillStyle = color; g.beginPath(); g.arc(lead.x, lead.y, 2.5, 0, Math.PI * 2); g.fill(); g.restore();
}
function drawCompassGuide() {
  if (state.tool !== 'compass' || !state.compassAnchor || state.drawing) return; const raw = screenToWorld(state.pointer); if (pointDistance(raw, state.compassAnchor) < .22) return; const angle = Math.atan2(raw.y - state.compassAnchor.y, raw.x - state.compassAnchor.x), pencil = state.compassCarryRadius ? { x: state.compassAnchor.x + state.compassCarryRadius * Math.cos(angle), y: state.compassAnchor.y + state.compassCarryRadius * Math.sin(angle) } : raw;
  drawCompassInstrument(state.compassAnchor, pencil, resolveInk(state.color), .62); const p = worldToScreen(state.compassAnchor); g.save(); g.fillStyle = canvasPalette().guide; g.font = '10px "DM Mono",monospace'; g.fillText(state.compassCarryRadius ? 'opening held' : 'needle: (' + pretty(state.compassAnchor.x) + ', ' + pretty(state.compassAnchor.y) + ')', p.x + 8, p.y - 9); g.restore();
}
function drawDividerInstrument(anchor, tip, opacity = 1) {
  const left = worldToScreen(anchor), right = worldToScreen(tip), dx = right.x - left.x, dy = right.y - left.y, len = Math.hypot(dx, dy); if (len < 8) return; let nx = -dy / len, ny = dx / len, rise = Math.min(70, Math.max(25, len * .55)); if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } const hinge = { x: (left.x + right.x) / 2 + nx * rise, y: (left.y + right.y) / 2 + ny * rise }; g.save(); g.globalAlpha = opacity; g.lineCap = 'round'; g.strokeStyle = '#647277'; g.lineWidth = 5; g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(hinge.x, hinge.y); g.lineTo(right.x, right.y); g.stroke(); g.strokeStyle = '#d4dcda'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(hinge.x, hinge.y); g.lineTo(right.x, right.y); g.stroke(); g.fillStyle = '#405158'; g.beginPath(); g.arc(hinge.x, hinge.y, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#d9be6d'; g.beginPath(); g.arc(hinge.x, hinge.y, 2.6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#36464c'; for (const p of [left, right]) { g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - 4 * nx - 2 * dx / len, p.y - 4 * ny - 2 * dy / len); g.lineTo(p.x + 4 * nx - 2 * dx / len, p.y + 4 * ny - 2 * dy / len); g.closePath(); g.fill(); } g.restore();
}
function drawDividerGuide() { const d = state.divider; if (state.tool !== 'dividers' || !d || d.distance < .12) return; drawDividerInstrument(d.anchor, d.tip, .9); const p = worldToScreen(d.tip); g.save(); g.fillStyle = canvasPalette().guide; g.font = '10px "DM Mono",monospace'; g.fillText(`${pretty(d.distance)} units${d.locked ? ' · held' : ''}`, p.x + 8, p.y - 8); g.restore(); }
function drawPencilInstrument(point, previous, color) { const tip = worldToScreen(point), before = worldToScreen(previous || { x: point.x - .5, y: point.y }), dx = tip.x - before.x, dy = tip.y - before.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux, back = { x: tip.x - ux * 62, y: tip.y - uy * 62 }; g.save(); g.fillStyle = '#e4bc4d'; g.strokeStyle = '#7d6831'; g.lineWidth = 1; g.beginPath(); g.moveTo(tip.x - ux * 10 + nx * 4, tip.y - uy * 10 + ny * 4); g.lineTo(back.x + nx * 5, back.y + ny * 5); g.lineTo(back.x - nx * 5, back.y - ny * 5); g.lineTo(tip.x - ux * 10 - nx * 4, tip.y - uy * 10 - ny * 4); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#ddc49a'; g.beginPath(); g.moveTo(tip.x - ux * 10 + nx * 4, tip.y - uy * 10 + ny * 4); g.lineTo(tip.x - ux * 10 - nx * 4, tip.y - uy * 10 - ny * 4); g.lineTo(tip.x, tip.y); g.closePath(); g.fill(); g.fillStyle = color; g.beginPath(); g.arc(tip.x, tip.y, 2.1, 0, Math.PI * 2); g.fill(); g.restore(); }
function drawEraserGuide() { if (state.tool !== 'eraser') return; const p = state.pointer; g.save(); g.translate(p.x, p.y); g.rotate(-.55); g.fillStyle = '#e5a49bda'; g.strokeStyle = '#b76f68'; g.lineWidth = 1; g.fillRect(-12, -7, 24, 14); g.strokeRect(-12, -7, 24, 14); g.fillStyle = '#f2d4ce'; g.fillRect(5, -7, 7, 14); g.restore(); }
function drawConstructionGuide() {
  const c = state.construction; if (!c) return; const pal = canvasPalette();
  const marker = (world, label, active = false) => { const p = worldToScreen(world); g.save(); g.strokeStyle = active ? '#d47536' : (state.darkMode ? '#c9a06a' : '#b48459'); g.fillStyle = pal.paper; g.lineWidth = active ? 2.2 : 1.3; g.setLineDash(active ? [3, 2] : [2, 3]); g.beginPath(); g.arc(p.x, p.y, 8, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.fillStyle = active ? '#d47536' : (state.darkMode ? '#c9a06a' : '#9d7957'); g.font = '600 11px "DM Mono",monospace'; g.fillText(label, p.x + 10, p.y - 9); g.restore(); };
  if (c.mode === 'any' && c.line) { const from = worldToScreen({ x: c.line.from.x - c.direction.x * 1000, y: c.line.from.y - c.direction.y * 1000 }), to = worldToScreen({ x: c.line.to.x + c.direction.x * 1000, y: c.line.to.y + c.direction.y * 1000 }); g.save(); g.setLineDash([6, 5]); g.strokeStyle = '#7f9bc8'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke(); g.restore(); }
  if (!c.point) return; marker(c.point, 'P', c.step === 'first-circle'); if (c.upper) { marker(c.upper, 'A', c.step === 'upper-arc'); marker(c.lower, 'B', c.step === 'lower-arc'); }
  if (c.left) { marker(c.left, 'C', c.step === 'ruler'); marker(c.right, 'D', c.step === 'ruler'); if (c.step === 'ruler' || c.step === 'complete') { const l = worldToScreen(c.left), r = worldToScreen(c.right); g.save(); g.setLineDash([5, 4]); g.strokeStyle = '#b7865e'; g.lineWidth = 1; g.beginPath(); g.moveTo(l.x - 55, l.y); g.lineTo(r.x + 55, r.y); g.stroke(); g.restore(); } }
}
function renderPreview() { if (!state.drawing || state.drawing.type === 'pan') return; const a = state.drawing; g.save(); g.globalAlpha = .8; drawAction(a, true); g.restore(); if (a.type === 'angle') drawProtractor(worldToScreen(a.center), worldToScreen(a.end)); if (a.type === 'compass') drawCompassInstrument(a.center, compassPoint(a), resolveInk(a.color), .94); if (a.type === 'pencil') drawPencilInstrument(a.points[a.points.length - 1], a.points[a.points.length - 2], resolveInk(a.color)); }
function drawProtractor(c, e) { const radius = Math.min(105, Math.max(65, pointDistance(c, e))); g.save(); g.translate(c.x, c.y); g.fillStyle = '#f5dca75e'; g.strokeStyle = '#bca46caa'; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, radius, Math.PI, 0, false); g.lineTo(radius, 0); g.lineTo(-radius, 0); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#8e7952'; g.font = '8px "DM Mono",monospace'; g.textAlign = 'center'; for (let d = 0; d <= 180; d += 10) { const r = d * Math.PI / 180; const inner = radius - (d % 30 ? 6 : 11); g.beginPath(); g.moveTo(Math.cos(-r) * radius, Math.sin(-r) * radius); g.lineTo(Math.cos(-r) * inner, Math.sin(-r) * inner); g.stroke(); if (d % 30 === 0) g.fillText(d, Math.cos(-r) * (radius - 18), Math.sin(-r) * (radius - 18) + 3) } g.restore(); }

function renderAll() { g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); renderGrid(); state.actions.forEach(a => drawAction(a)); drawConstructionGuide(); drawCompassGuide(); drawDividerGuide(); drawEraserGuide(); renderPreview(); }
registerRender(renderAll);

export function resizeCanvas() {
  const rect = paperWrap.getBoundingClientRect();
  state.dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * state.dpr);
  canvas.height = Math.round(rect.height * state.dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const old = state.canvasSize;
  state.canvasSize = { width: rect.width, height: rect.height };
  if (!state.origin.x && !state.origin.y) state.origin = { x: rect.width / 2, y: rect.height / 2 };
  else state.origin.x += (rect.width - old.width) / 2, state.origin.y += (rect.height - old.height) / 2;
  render();
}
