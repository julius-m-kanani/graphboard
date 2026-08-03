import './draw.js';
import './construction.js';
import './history.js';
import './input.js';
import { resizeCanvas } from './draw.js';
import { updateHistory } from './history.js';

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateHistory();
