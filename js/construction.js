import { $, state, pointDistance, segmentDistance, closestPointOnSegment, showToast, setTool } from './core.js';

export function near(a, b, tolerance = .38) { return pointDistance(a, b) <= tolerance; }

export function updateConstructionPanel() {
  const c = state.construction, card = $('#construction-card'), status = $('#guide-status'), axisButton = $('#perpendicular-button'), anyButton = $('#any-perpendicular-button'), keysBox = $('#construction-keys');
  if (!c) { card.dataset.step = ''; status.textContent = 'Let learners construct a perpendicular to any straight line using only the compass and ruler.'; axisButton.textContent = 'On x = 0'; anyButton.textContent = 'On any line'; keysBox.innerHTML = ''; return; }
  const copy = {
    'choose-line': 'Step 1 — click an existing straight line, or use the ruler to draw a new reference line.',
    'pick-point': 'Choose the point P on the selected line where the perpendicular must pass.',
    'first-circle': 'Plant the compass at P and sweep a circle that cuts the reference line at A and B.',
    'upper-arc': 'Plant the compass at A and sweep a wide arc. Open it farther than AP.',
    'lower-arc': 'Move the needle to B. The compass keeps its opening to locate C and D.',
    'ruler': 'Select Ruler and draw through C and D. That line is perpendicular to the reference line.',
    'complete': 'Construction complete — CD passes through P and forms a right angle with the reference line.'
  }, stepKeys = {
    'choose-line': [['R', 'ruler']],
    'pick-point': [],
    'first-circle': [['Esc', 'lift needle'], ['X', 'release opening']],
    'upper-arc': [['Esc', 'replant on A'], ['X', 'release opening']],
    'lower-arc': [['Esc', 'replant on B'], ['X', 'release opening']],
    'ruler': [['R', 'ruler']],
    'complete': []
  };
  card.dataset.step = c.step; status.textContent = copy[c.step]; keysBox.innerHTML = stepKeys[c.step] && stepKeys[c.step].length ? `Keys: ${stepKeys[c.step].map(([k, l]) => `<kbd>${k}</kbd> ${l}`).join('<span class="tip-sep"> · </span>')}` : ''; axisButton.textContent = c.mode === 'axis' ? 'Restart x = 0' : 'On x = 0'; anyButton.textContent = c.mode === 'any' ? 'Restart any line' : 'On any line';
}
function freshConstruction(mode) { return { kind: 'perpendicular', mode, step: mode === 'axis' ? 'pick-point' : 'choose-line', line: null, direction: null, point: null, upper: null, lower: null, left: null, right: null, axisRadius: 0, arcRadius: 0 }; }
export function setConstructionLine(c, line) { const dx = line.to.x - line.from.x, dy = line.to.y - line.from.y, length = Math.hypot(dx, dy); if (length < .45) { showToast('Draw a longer reference line first.'); return false; } c.line = { from: { ...line.from }, to: { ...line.to } }; c.direction = { x: dx / length, y: dy / length }; c.step = 'pick-point'; state.compassAnchor = null; setTool('point'); updateConstructionPanel(); return true; }
export function beginPerpendicular() { const c = freshConstruction('axis'); state.construction = c; setConstructionLine(c, { from: { x: 0, y: -1000 }, to: { x: 0, y: 1000 } }); state.compassCarryRadius = null; updateConstructionPanel(); showToast('Choose a point on x = 0 to begin the construction'); }
export function beginAnyPerpendicular() { state.construction = freshConstruction('any'); state.compassAnchor = null; state.compassCarryRadius = null; setTool('ruler'); updateConstructionPanel(); showToast('Click a straight line already on the page, or draw one with the ruler.'); }
export function findReferenceLine(p) { let best = null, bestDistance = Infinity; state.actions.forEach(a => { if (a.type !== 'line' && a.type !== 'ruler' && a.type !== 'set-square') return; const distance = segmentDistance(p, a.from, a.to); if (distance < bestDistance) { bestDistance = distance; best = a; } }); return best && bestDistance < .42 ? best : null; }
export function constrainSetSquare(from, to, square) { const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy); if (length < .01) return { ...from }; const step = square === '45' ? Math.PI / 4 : Math.PI / 6, angle = Math.round(Math.atan2(dy, dx) / step) * step; return { x: from.x + length * Math.cos(angle), y: from.y + length * Math.sin(angle) }; }
export function advanceConstruction(a) {
  const c = state.construction; if (!c) return;
  if (c.step === 'choose-line' && (a.type === 'line' || a.type === 'ruler' || a.type === 'set-square')) { if (setConstructionLine(c, a)) { showToast('Reference line selected. Now choose P on it.'); } return; }
  if (!c.point) return;
  if (c.step === 'first-circle' && a.type === 'compass') {
    if (!near(a.center, c.point)) { state.compassAnchor = null; showToast('For step 1, lift the compass and plant its needle on P.'); return; }
    if (a.radius < .65) { showToast('Open the compass a little wider before sweeping.'); return; }
    c.axisRadius = a.radius; c.upper = { x: c.point.x + c.direction.x * a.radius, y: c.point.y + c.direction.y * a.radius }; c.lower = { x: c.point.x - c.direction.x * a.radius, y: c.point.y - c.direction.y * a.radius }; c.step = 'upper-arc'; state.compassAnchor = null; state.compassCarryRadius = null; setTool('compass'); updateConstructionPanel(); showToast('Good. A and B are where the first circle meets the reference line.'); return;
  }
  if (c.step === 'upper-arc' && a.type === 'compass') {
    if (!near(a.center, c.upper)) { state.compassAnchor = null; showToast('For step 2, lift the compass and plant its needle on A.'); return; }
    if (a.radius <= c.axisRadius + .25) { showToast('Open the compass wider than AP so the next arcs meet.'); return; }
    c.arcRadius = a.radius; const half = Math.sqrt(a.radius * a.radius - c.axisRadius * c.axisRadius), normal = { x: -c.direction.y, y: c.direction.x }; c.left = { x: c.point.x + normal.x * half, y: c.point.y + normal.y * half }; c.right = { x: c.point.x - normal.x * half, y: c.point.y - normal.y * half }; c.step = 'lower-arc'; state.compassAnchor = null; state.compassCarryRadius = c.arcRadius; setTool('compass'); updateConstructionPanel(); showToast('The compass opening is held. Move its needle to B and sweep again.'); return;
  }
  if (c.step === 'lower-arc' && a.type === 'compass') {
    if (!near(a.center, c.lower)) { state.compassAnchor = null; showToast('For step 3, lift the compass and plant its needle on B.'); return; }
    if (Math.abs(a.radius - c.arcRadius) > .42) { showToast('Match the compass opening used from A before continuing.'); return; }
    c.step = 'ruler'; state.compassAnchor = null; state.compassCarryRadius = null; setTool('ruler'); updateConstructionPanel(); showToast('The arc intersections are C and D. Place the ruler through them.'); return;
  }
  if (c.step === 'ruler' && a.type === 'ruler') {
    if (segmentDistance(c.left, a.from, a.to) > .4 || segmentDistance(c.right, a.from, a.to) > .4) { showToast('Use the ruler to pass through both C and D.'); return; }
    c.step = 'complete'; updateConstructionPanel(); showToast('Excellent — you have constructed a perpendicular to x = 0.');
  }
}
