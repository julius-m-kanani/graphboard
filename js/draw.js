import { canvas, paperWrap, ctx, state, screenToWorld, worldToScreen, pretty, pointDistance, render, registerRender, SHAPES, SHAPES3D, shapeVertices, circleCenterRadius, solidGeometry, resolveInk, canvasPalette } from './core.js';

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
  ctx.save();
  ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, width, height);
  if (state.showGrid && state.paper !== 'blank') {
    const min = screenToWorld({ x: 0, y: height }); const max = screenToWorld({ x: width, y: 0 });
    const minor = minorGridStep();
    const fromX = Math.floor(min.x / minor) - 1, toX = Math.ceil(max.x / minor) + 1, fromY = Math.floor(min.y / minor) - 1, toY = Math.ceil(max.y / minor) + 1;
    // Snap lines to whole device pixels: a 1px line drawn at a fractional
    // coordinate anti-aliases across two pixels at half strength and almost
    // disappears on a projector. Rounding first keeps full contrast.
    const crisp = (v) => Math.round(v) + 0.5;
    if (state.paper === 'dot') {
      ctx.fillStyle = pal.dot;
      for (let ix = fromX; ix <= toX; ix++) for (let iy = fromY; iy <= toY; iy++) { const p = worldToScreen({ x: ix * minor, y: iy * minor }); ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill(); }
    } else {
      for (let ix = fromX; ix <= toX; ix++) {
        const x = ix * minor, p = worldToScreen({ x, y: 0 });
        const sx = crisp(p.x);
        ctx.beginPath();
        if (isMultiple(x, 5)) { ctx.strokeStyle = pal.major; ctx.lineWidth = 1.25; }
        else if (isMultiple(x, 1)) { ctx.strokeStyle = pal.unit; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = pal.minor; ctx.lineWidth = 1; }
        ctx.moveTo(sx, 0); ctx.lineTo(sx, height); ctx.stroke();
      }
      for (let iy = fromY; iy <= toY; iy++) {
        const y = iy * minor, p = worldToScreen({ x: 0, y });
        const sy = crisp(p.y);
        ctx.beginPath();
        if (isMultiple(y, 5)) { ctx.strokeStyle = pal.major; ctx.lineWidth = 1.25; }
        else if (isMultiple(y, 1)) { ctx.strokeStyle = pal.unit; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = pal.minor; ctx.lineWidth = 1; }
        ctx.moveTo(0, sy); ctx.lineTo(width, sy); ctx.stroke();
      }
    }
  }
  const note = document.querySelector('.canvas-corner-note');
  if (note) note.innerHTML = state.paper === 'blank' || !state.showGrid ? '' : `GRAPH PAPER&nbsp; · &nbsp;SQUARES = ${gridFraction(minorGridStep())} UNIT`;
  ctx.strokeStyle = pal.axis; ctx.lineWidth = 2; ctx.beginPath();
  const ax = Math.round(state.origin.x), ay = Math.round(state.origin.y);
  ctx.moveTo(0, ay); ctx.lineTo(width, ay); ctx.moveTo(ax, 0); ctx.lineTo(ax, height); ctx.stroke();
  const axisArrow = (x, y, angle) => { ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillStyle = pal.axis; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, 3); ctx.lineTo(-6, -3); ctx.closePath(); ctx.fill(); ctx.restore(); };
  axisArrow(width - 4, state.origin.y, 0); axisArrow(4, state.origin.y, Math.PI); axisArrow(state.origin.x, 4, -Math.PI / 2); axisArrow(state.origin.x, height - 4, Math.PI / 2);
  if (state.showLabels) renderLabels();
  ctx.restore();
}
function renderLabels() {
  const { width, height } = state.canvasSize; const min = screenToWorld({ x: 0, y: height }), max = screenToWorld({ x: width, y: 0 });
  if (max.x - min.x > 600 || max.y - min.y > 600) return;
  const pal = canvasPalette();
  ctx.save(); ctx.fillStyle = pal.label; ctx.font = '10px "DM Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let x = Math.ceil(min.x); x <= Math.floor(max.x); x++) { if (x && x % 1 === 0) { const p = worldToScreen({ x, y: 0 }); if (p.x > 12 && p.x < width - 12) { ctx.fillText(x, p.x, Math.min(height - 14, Math.max(4, state.origin.y + 6))); } } }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(min.y); y <= Math.floor(max.y); y++) { if (y && y % 1 === 0) { const p = worldToScreen({ x: 0, y }); if (p.y > 9 && p.y < height - 9) { ctx.fillText(y, Math.min(width - 3, Math.max(17, state.origin.x - 6)), p.y); } } }
  ctx.fillStyle = pal.labelAxis; ctx.font = 'italic 12px Georgia,serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('x', width - 14, Math.max(13, state.origin.y - 5)); ctx.fillText('y', state.origin.x + 7, 13); ctx.restore();
}
function drawAction(a, preview = false) {
  const pal = canvasPalette();
  const ink = resolveInk(a.color);
  ctx.save(); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (a.type === 'pencil') { if (a.points.length < 2) { ctx.restore(); return; } ctx.lineWidth = 1.8; ctx.beginPath(); a.points.forEach((p, i) => { const s = worldToScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y) }); ctx.stroke(); }
  if (a.type === 'point') { const p = worldToScreen(a.at); ctx.beginPath(); ctx.arc(p.x, p.y, 4.1, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = pal.hole; ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2); ctx.fill(); if (a.label) { ctx.font = '11px "DM Mono",monospace'; ctx.fillStyle = ink; ctx.fillText(a.label, p.x + 7, p.y - 7); } }
  if (a.type === 'dotted') {
    const p1 = worldToScreen(a.from), p2 = worldToScreen(a.to); const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
    if (len >= 2) { ctx.lineCap = 'butt'; ctx.setLineDash([2, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'round'; }
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
      ctx.lineCap = 'butt'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = ink;
      const ah = 9, aw = 4;
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * ah - uy * aw, ey - uy * ah + ux * aw);
      ctx.lineTo(ex - ux * ah + uy * aw, ey - uy * ah - ux * aw);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(p1.x, p1.y, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'round';
    }
  }
  if (SHAPES.includes(a.type) || SHAPES3D.includes(a.type)) {
    ctx.lineWidth = 2;
    if (a.type === 'circle') { const { cx, cy, rx } = circleCenterRadius('circle', a.from, a.to); const p = worldToScreen({ x: cx, y: cy }); ctx.beginPath(); ctx.arc(p.x, p.y, rx * state.scale, 0, Math.PI * 2); ctx.stroke(); }
    else if (a.type === 'ellipse') { const { cx, cy, rx, ry } = circleCenterRadius('ellipse', a.from, a.to); const p = worldToScreen({ x: cx, y: cy }); ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * state.scale, ry * state.scale, 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (SHAPES3D.includes(a.type)) { drawSolidWire(a); }
    else { const pts = shapeVertices(a.type, a.from, a.to).map(worldToScreen); if (pts.length) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); ctx.stroke(); } }
  }
  if (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square') { const p1 = worldToScreen(a.from), p2 = worldToScreen(a.to); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); if (a.type === 'ruler' && preview) drawRuler(p1, p2); if (a.type === 'set-square' && preview) drawSetSquare(p1, p2, a.square); }
  if (a.type === 'circle') { const p = worldToScreen(a.center); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, a.radius * state.scale, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = pal.hole; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.stroke(); }
  if (a.type === 'compass') { if (a.points.length > 1) { ctx.lineWidth = 2.2; ctx.beginPath(); a.points.forEach((p, i) => { const s = worldToScreen(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y) }); ctx.stroke(); } }
  if (a.type === 'angle') { const c = worldToScreen(a.center), e = worldToScreen(a.end), r = Math.min(1.25 * state.scale, pointDistance(c, e) * .65); const angle = Math.atan2(c.y - e.y, e.x - c.x); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, angle, true); ctx.stroke(); ctx.font = '11px "DM Mono",monospace'; ctx.fillStyle = ink; ctx.fillText(`${Math.round((angle * 180 / Math.PI + 360) % 360)}°`, c.x + r + 5, c.y - 5); }
  if (a.type === 'plot') drawPlot(a, ink);
  ctx.restore();
}
function drawSolidWire(a) {
  const g = solidGeometry(a.type, a.from, a.to);
  for (const e of g.edges) {
    const p1 = worldToScreen(g.pts[e.a]), p2 = worldToScreen(g.pts[e.b]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    if (e.hidden) { ctx.setLineDash([2, 4]); ctx.globalAlpha = .5; } else { ctx.setLineDash([]); ctx.globalAlpha = 1; }
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}
function drawRuler(p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy); if (len < 2) return; ctx.save(); ctx.translate(p1.x, p1.y); ctx.rotate(Math.atan2(dy, dx)); ctx.fillStyle = '#e7e8d1c9'; ctx.strokeStyle = '#9b9f7c'; ctx.lineWidth = 1; ctx.fillRect(0, -15, len, 30); ctx.strokeRect(0, -15, len, 30); ctx.fillStyle = '#6f765a'; ctx.font = '8px "DM Mono",monospace'; for (let x = 0; x < len; x += state.scale / 5) { const major = Math.round(x / (state.scale / 5)) % 5 === 0; ctx.fillRect(x, -15, 1, major ? 9 : 5); ctx.fillRect(x, major ? 6 : 10, 1, major ? 9 : 5); if (major && x > 5) ctx.fillText(String(Math.round(x / state.scale)), x + 2, -7) } ctx.textAlign = 'center'; ctx.fillText(`${pretty(len / state.scale)} units`, len / 2, 4); ctx.restore();
}
function drawSetSquare(p1, p2, square) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy); if (len < 8) return; const nx = -dy / len, ny = dx / len, ratio = square === '45' ? 1 : .577; const third = { x: p1.x + nx * len * ratio, y: p1.y + ny * len * ratio }; ctx.save(); ctx.fillStyle = '#cfe5f06e'; ctx.strokeStyle = '#5e8aadbb'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(third.x, third.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#4f7391'; ctx.font = '9px "DM Mono",monospace'; ctx.fillText(square === '45' ? '45°' : '30°  60°', p1.x + nx * 13 + 4, p1.y + ny * 13 + 4); ctx.strokeStyle = '#5e8aad'; ctx.strokeRect(p1.x + nx * 5 - dx / len * 3, p1.y + ny * 5 - dy / len * 3, 6, 6); ctx.restore();
}
function drawPlot(a, ink) {
  const { width } = state.canvasSize; const fn = a.fn; ctx.strokeStyle = ink || resolveInk(a.color); ctx.lineWidth = 2.2; ctx.beginPath(); let started = false, lastY = null;
  for (let sx = 0; sx <= width; sx += 1) { const x = (sx - state.origin.x) / state.scale; let y; try { y = fn(x) } catch { y = NaN } const sy = state.origin.y - y * state.scale; if (!Number.isFinite(y) || Math.abs(sy) > 100000 || (lastY !== null && Math.abs(sy - lastY) > state.canvasSize.height * 2)) { started = false; lastY = null; continue; } if (!started) { ctx.moveTo(sx, sy); started = true } else ctx.lineTo(sx, sy); lastY = sy; } ctx.stroke();
}
function compassPoint(a) { const angle = a.angles[a.angles.length - 1]; return { x: a.center.x + a.radius * Math.cos(angle), y: a.center.y + a.radius * Math.sin(angle) }; }
function drawCompassInstrument(center, pencil, color = '#244bb3', opacity = 1) {
  const needle = worldToScreen(center), lead = worldToScreen(pencil), dx = lead.x - needle.x, dy = lead.y - needle.y, len = Math.hypot(dx, dy); if (len < 10) return;
  let nx = -dy / len, ny = dx / len, rise = Math.min(74, Math.max(29, len * .52)); if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } const hinge = { x: (needle.x + lead.x) / 2 + nx * rise, y: (needle.y + lead.y) / 2 + ny * rise };
  ctx.save(); ctx.globalAlpha = opacity; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#59696d'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(needle.x, needle.y); ctx.lineTo(hinge.x, hinge.y); ctx.lineTo(lead.x, lead.y); ctx.stroke();
  ctx.strokeStyle = '#bec7c5'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(needle.x, needle.y); ctx.lineTo(hinge.x, hinge.y); ctx.lineTo(lead.x, lead.y); ctx.stroke();
  ctx.fillStyle = '#3e5158'; ctx.beginPath(); ctx.arc(hinge.x, hinge.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e3c978'; ctx.beginPath(); ctx.arc(hinge.x, hinge.y, 3.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#33464c'; ctx.beginPath(); ctx.moveTo(needle.x, needle.y); ctx.lineTo(needle.x - 4 * nx - 2 * dx / len, needle.y - 4 * ny - 2 * dy / len); ctx.lineTo(needle.x + 4 * nx - 2 * dx / len, needle.y + 4 * ny - 2 * dy / len); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lead.x - dx / len * 9, lead.y - dy / len * 9); ctx.lineTo(lead.x, lead.y); ctx.stroke(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lead.x, lead.y, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function drawCompassGuide() {
  if (state.tool !== 'compass' || !state.compassAnchor || state.drawing) return; const raw = screenToWorld(state.pointer); if (pointDistance(raw, state.compassAnchor) < .22) return; const angle = Math.atan2(raw.y - state.compassAnchor.y, raw.x - state.compassAnchor.x), pencil = state.compassCarryRadius ? { x: state.compassAnchor.x + state.compassCarryRadius * Math.cos(angle), y: state.compassAnchor.y + state.compassCarryRadius * Math.sin(angle) } : raw;
  drawCompassInstrument(state.compassAnchor, pencil, resolveInk(state.color), .62); const p = worldToScreen(state.compassAnchor); ctx.save(); ctx.fillStyle = canvasPalette().guide; ctx.font = '10px "DM Mono",monospace'; ctx.fillText(state.compassCarryRadius ? 'opening held' : 'needle: (' + pretty(state.compassAnchor.x) + ', ' + pretty(state.compassAnchor.y) + ')', p.x + 8, p.y - 9); ctx.restore();
}
function drawDividerInstrument(anchor, tip, opacity = 1) {
  const left = worldToScreen(anchor), right = worldToScreen(tip), dx = right.x - left.x, dy = right.y - left.y, len = Math.hypot(dx, dy); if (len < 8) return; let nx = -dy / len, ny = dx / len, rise = Math.min(70, Math.max(25, len * .55)); if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } const hinge = { x: (left.x + right.x) / 2 + nx * rise, y: (left.y + right.y) / 2 + ny * rise }; ctx.save(); ctx.globalAlpha = opacity; ctx.lineCap = 'round'; ctx.strokeStyle = '#647277'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(hinge.x, hinge.y); ctx.lineTo(right.x, right.y); ctx.stroke(); ctx.strokeStyle = '#d4dcda'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(left.x, left.y); ctx.lineTo(hinge.x, hinge.y); ctx.lineTo(right.x, right.y); ctx.stroke(); ctx.fillStyle = '#405158'; ctx.beginPath(); ctx.arc(hinge.x, hinge.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d9be6d'; ctx.beginPath(); ctx.arc(hinge.x, hinge.y, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#36464c'; for (const p of [left, right]) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 4 * nx - 2 * dx / len, p.y - 4 * ny - 2 * dy / len); ctx.lineTo(p.x + 4 * nx - 2 * dx / len, p.y + 4 * ny - 2 * dy / len); ctx.closePath(); ctx.fill(); } ctx.restore();
}
function drawDividerGuide() { const d = state.divider; if (state.tool !== 'dividers' || !d || d.distance < .12) return; drawDividerInstrument(d.anchor, d.tip, .9); const p = worldToScreen(d.tip); ctx.save(); ctx.fillStyle = canvasPalette().guide; ctx.font = '10px "DM Mono",monospace'; ctx.fillText(`${pretty(d.distance)} units${d.locked ? ' · held' : ''}`, p.x + 8, p.y - 8); ctx.restore(); }
function drawPencilInstrument(point, previous, color) { const tip = worldToScreen(point), before = worldToScreen(previous || { x: point.x - .5, y: point.y }), dx = tip.x - before.x, dy = tip.y - before.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux, back = { x: tip.x - ux * 62, y: tip.y - uy * 62 }; ctx.save(); ctx.fillStyle = '#e4bc4d'; ctx.strokeStyle = '#7d6831'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tip.x - ux * 10 + nx * 4, tip.y - uy * 10 + ny * 4); ctx.lineTo(back.x + nx * 5, back.y + ny * 5); ctx.lineTo(back.x - nx * 5, back.y - ny * 5); ctx.lineTo(tip.x - ux * 10 - nx * 4, tip.y - uy * 10 - ny * 4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ddc49a'; ctx.beginPath(); ctx.moveTo(tip.x - ux * 10 + nx * 4, tip.y - uy * 10 + ny * 4); ctx.lineTo(tip.x - ux * 10 - nx * 4, tip.y - uy * 10 - ny * 4); ctx.lineTo(tip.x, tip.y); ctx.closePath(); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(tip.x, tip.y, 2.1, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
function drawEraserGuide() { if (state.tool !== 'eraser') return; const p = state.pointer; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-.55); ctx.fillStyle = '#e5a49bda'; ctx.strokeStyle = '#b76f68'; ctx.lineWidth = 1; ctx.fillRect(-12, -7, 24, 14); ctx.strokeRect(-12, -7, 24, 14); ctx.fillStyle = '#f2d4ce'; ctx.fillRect(5, -7, 7, 14); ctx.restore(); }
function drawConstructionGuide() {
  const c = state.construction; if (!c) return; const pal = canvasPalette();
  const marker = (world, label, active = false) => { const p = worldToScreen(world); ctx.save(); ctx.strokeStyle = active ? '#d47536' : (state.darkMode ? '#c9a06a' : '#b48459'); ctx.fillStyle = pal.paper; ctx.lineWidth = active ? 2.2 : 1.3; ctx.setLineDash(active ? [3, 2] : [2, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = active ? '#d47536' : (state.darkMode ? '#c9a06a' : '#9d7957'); ctx.font = '600 11px "DM Mono",monospace'; ctx.fillText(label, p.x + 10, p.y - 9); ctx.restore(); };
  if (c.mode === 'any' && c.line) { const from = worldToScreen({ x: c.line.from.x - c.direction.x * 1000, y: c.line.from.y - c.direction.y * 1000 }), to = worldToScreen({ x: c.line.to.x + c.direction.x * 1000, y: c.line.to.y + c.direction.y * 1000 }); ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = '#7f9bc8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.restore(); }
  if (!c.point) return; marker(c.point, 'P', c.step === 'first-circle'); if (c.upper) { marker(c.upper, 'A', c.step === 'upper-arc'); marker(c.lower, 'B', c.step === 'lower-arc'); }
  if (c.left) { marker(c.left, 'C', c.step === 'ruler'); marker(c.right, 'D', c.step === 'ruler'); if (c.step === 'ruler' || c.step === 'complete') { const l = worldToScreen(c.left), r = worldToScreen(c.right); ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#b7865e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(l.x - 55, l.y); ctx.lineTo(r.x + 55, r.y); ctx.stroke(); ctx.restore(); } }
}
function renderPreview() { if (!state.drawing || state.drawing.type === 'pan') return; const a = state.drawing; ctx.save(); ctx.globalAlpha = .8; drawAction(a, true); ctx.restore(); if (a.type === 'angle') drawProtractor(worldToScreen(a.center), worldToScreen(a.end)); if (a.type === 'compass') drawCompassInstrument(a.center, compassPoint(a), resolveInk(a.color), .94); if (a.type === 'pencil') drawPencilInstrument(a.points[a.points.length - 1], a.points[a.points.length - 2], resolveInk(a.color)); }
function drawProtractor(c, e) { const radius = Math.min(105, Math.max(65, pointDistance(c, e))); ctx.save(); ctx.translate(c.x, c.y); ctx.fillStyle = '#f5dca75e'; ctx.strokeStyle = '#bca46caa'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, radius, Math.PI, 0, false); ctx.lineTo(radius, 0); ctx.lineTo(-radius, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#8e7952'; ctx.font = '8px "DM Mono",monospace'; ctx.textAlign = 'center'; for (let d = 0; d <= 180; d += 10) { const r = d * Math.PI / 180; const inner = radius - (d % 30 ? 6 : 11); ctx.beginPath(); ctx.moveTo(Math.cos(-r) * radius, Math.sin(-r) * radius); ctx.lineTo(Math.cos(-r) * inner, Math.sin(-r) * inner); ctx.stroke(); if (d % 30 === 0) ctx.fillText(d, Math.cos(-r) * (radius - 18), Math.sin(-r) * (radius - 18) + 3) } ctx.restore(); }

function renderAll() { ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0); renderGrid(); state.actions.forEach(a => drawAction(a)); drawConstructionGuide(); drawCompassGuide(); drawDividerGuide(); drawEraserGuide(); renderPreview(); }
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
