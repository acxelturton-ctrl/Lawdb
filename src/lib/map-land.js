// Where is land on the home page map (images/ca-map.svg), and which province? Read from the grid scripts/build-ca-map.mjs writes (src/lib/map-land.generated.js),
// so the Worker can keep a firm's logo on land and inside its own province instead of out in the water or across the border (src/routes/map.js).
import { CELL, COLS, ROWS, CODES, RUNS } from './map-land.generated.js';

let grid = null; // one byte a cell: 0 is water or another country, else 1 + the place in CODES
function load() {
  grid = new Uint8Array(COLS * ROWS);
  RUNS.forEach((row, j) => {
    let i = 0;
    for (let r = 0; r < row.length; r += 2) { grid.fill(row[r], j * COLS + i, j * COLS + i + row[r + 1]); i += row[r + 1]; }
  });
}

// The province code ("ON") at a point of the drawing, or '' for water, another country or outside the drawing.
export function provinceAt(x, y) {
  if (!grid) load();
  const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
  if (i < 0 || j < 0 || i >= COLS || j >= ROWS) return '';
  const id = grid[j * COLS + i];
  return id ? CODES[id - 1] : '';
}

// True when a circle of radius r (in the drawing's units) around the point is wholly inside the province: its centre and eight points on its edge.
export function inland(x, y, code, r = 0) {
  if (provinceAt(x, y) !== code) return false;
  if (!r) return true;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    if (provinceAt(x + r * Math.cos(a), y + r * Math.sin(a)) !== code) return false;
  }
  return true;
}
