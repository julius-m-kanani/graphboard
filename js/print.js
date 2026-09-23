import { state, render } from './core.js';
import { withPrintContext } from './draw.js';

// A4 portrait at 96 CSS px/in, rendered at 3x (≈288 dpi) for crisp print.
export const A4_CSS_WIDTH = 794;
export const A4_CSS_HEIGHT = 1123;
export const PRINT_SCALE = 3;

// Render the current paper — same scale, centred on the current view — onto
// an A4 portrait page. Always prints on white paper (chalk inks remap to dark
// via resolveInk), regardless of the on-screen theme. Synchronous; the live
// state is restored before returning.
export function renderA4DataURL() {
  const prevSize = { ...state.canvasSize };
  const prevOrigin = { ...state.origin };
  const prevDpr = state.dpr;
  const prevDark = state.darkMode;
  const prevDrawing = state.drawing;
  const prevDrag = state.drag;

  const worldCenter = {
    x: (prevSize.width / 2 - prevOrigin.x) / state.scale,
    y: (prevOrigin.y - prevSize.height / 2) / state.scale,
  };

  const c = document.createElement('canvas');
  c.width = A4_CSS_WIDTH * PRINT_SCALE;
  c.height = A4_CSS_HEIGHT * PRINT_SCALE;
  const pctx = c.getContext('2d');

  state.canvasSize = { width: A4_CSS_WIDTH, height: A4_CSS_HEIGHT };
  state.origin = {
    x: A4_CSS_WIDTH / 2 - worldCenter.x * state.scale,
    y: A4_CSS_HEIGHT / 2 + worldCenter.y * state.scale,
  };
  state.dpr = PRINT_SCALE;
  state.darkMode = false;
  state.drawing = null;
  state.drag = null;

  try {
    withPrintContext(pctx, () => render());
  } finally {
    state.canvasSize = prevSize;
    state.origin = prevOrigin;
    state.dpr = prevDpr;
    state.darkMode = prevDark;
    state.drawing = prevDrawing;
    state.drag = prevDrag;
  }
  return c.toDataURL('image/png');
}
