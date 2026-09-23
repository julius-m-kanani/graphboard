// Serialize / deserialize canvas actions to plain JSON for storage.
import { compileExpression } from './input.js';

// Map an action to a JSON-safe object. Equation plots store a function, so we
// persist the expression and recompile on load.
export function serializeAction(a) {
  const copy = { ...a };
  if (a.type === 'plot') delete copy.fn;
  if (a.type === 'set-square') copy.square = a.square;
  return copy;
}

export function serializeState(state) {
  return {
    tool: state.tool,
    color: state.color,
    scale: state.scale,
    origin: { ...state.origin },
    showGrid: state.showGrid,
    showLabels: state.showLabels,
    snapStep: state.snapStep,
    paper: state.paper,
    darkMode: !!state.darkMode,
    actions: state.actions.map(serializeAction)
  };
}

export function deserializeState(data) {
  const d = data || {};
  const actions = (d.actions || []).map(a => {
    const copy = { ...a };
    if (a.type === 'plot' && a.expression) {
      try { copy.fn = compileExpression(a.expression); } catch { copy.fn = () => NaN; }
    }
    return copy;
  });
  return {
    tool: d.tool || 'pencil',
    color: d.color || '#244bb3',
    scale: d.scale || 32,
    origin: { x: d.origin ? d.origin.x : 0, y: d.origin ? d.origin.y : 0 },
    showGrid: d.showGrid !== false,
    showLabels: d.showLabels !== false,
    snapStep: d.snapStep === undefined ? 0.5 : d.snapStep,
    paper: d.paper || 'square',
    darkMode: !!d.darkMode,
    actions
  };
}
