// Values of the MediaPipe selfie_segmenter category mask as read back with
// `MPMask.getAsUint8Array()`: 0 where a person is, 255 everywhere else.
export const MASK_PERSON = 0;
export const MASK_BACKGROUND = 255;

// Components are found on a coarse grid whose long side has this many cells.
// The model itself segments at 256x256, so this loses nothing that matters, and
// a cell counts as a person if any pixel in it is — thin limbs stay connected.
const GRID_LONG_SIDE = 160;

// The component that held the speaker last frame wins unless another one is
// this much larger, so a passer-by of similar size never steals the frame.
const STICKINESS = 1.5;

type Component = {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sumX: number;
  sumY: number;
};

/**
 * The selfie segmenter marks every person in view as foreground, so a virtual
 * background still shows colleagues sitting behind the speaker (UNI-842). This
 * keeps only the connected region of the speaker and hands everyone else back
 * to the background.
 */
export class MainSubjectMask {
  private grid = new Uint8Array(0);
  private labels = new Int32Array(0);
  private stack = new Int32Array(0);
  private output = new Uint8Array(0);
  // Speaker centroid from the previous frame, in grid cells.
  private previous: { x: number; y: number } | null = null;

  filter(mask: Uint8Array, width: number, height: number): Uint8Array {
    const cell = Math.max(1, Math.ceil(Math.max(width, height) / GRID_LONG_SIDE));
    const gw = Math.ceil(width / cell);
    const gh = Math.ceil(height / cell);
    this.ensureCapacity(width * height, gw * gh);

    const grid = this.grid.subarray(0, gw * gh);
    grid.fill(0);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const gRow = Math.floor(y / cell) * gw;
      for (let x = 0; x < width; x++) {
        if (mask[row + x] === MASK_PERSON) grid[gRow + Math.floor(x / cell)] = 1;
      }
    }

    const components = this.label(grid, gw, gh);
    const keep = this.pickSpeaker(components);
    const output = this.output.subarray(0, width * height);
    output.fill(MASK_BACKGROUND);
    if (keep < 0) {
      this.previous = null;
      return output;
    }

    const labels = this.labels;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const gRow = Math.floor(y / cell) * gw;
      for (let x = 0; x < width; x++) {
        if (mask[row + x] === MASK_PERSON && labels[gRow + Math.floor(x / cell)] === keep) {
          output[row + x] = MASK_PERSON;
        }
      }
    }
    return output;
  }

  private ensureCapacity(pixels: number, cells: number) {
    if (this.output.length < pixels) this.output = new Uint8Array(pixels);
    if (this.grid.length < cells) {
      this.grid = new Uint8Array(cells);
      this.labels = new Int32Array(cells);
      this.stack = new Int32Array(cells);
    }
  }

  // 4-connected flood fill over the grid; labels[i] is the component index or -1.
  private label(grid: Uint8Array, gw: number, gh: number): Component[] {
    const labels = this.labels;
    const stack = this.stack;
    labels.fill(-1, 0, gw * gh);
    const components: Component[] = [];

    for (let start = 0; start < gw * gh; start++) {
      if (grid[start] === 0 || labels[start] !== -1) continue;
      const id = components.length;
      const c: Component = {
        area: 0,
        minX: gw,
        minY: gh,
        maxX: 0,
        maxY: 0,
        sumX: 0,
        sumY: 0,
      };
      let top = 0;
      stack[top++] = start;
      labels[start] = id;
      while (top > 0) {
        const i = stack[--top]!;
        const x = i % gw;
        const y = (i - x) / gw;
        c.area++;
        c.sumX += x;
        c.sumY += y;
        if (x < c.minX) c.minX = x;
        if (x > c.maxX) c.maxX = x;
        if (y < c.minY) c.minY = y;
        if (y > c.maxY) c.maxY = y;
        if (x > 0 && grid[i - 1] === 1 && labels[i - 1] === -1) {
          labels[i - 1] = id;
          stack[top++] = i - 1;
        }
        if (x < gw - 1 && grid[i + 1] === 1 && labels[i + 1] === -1) {
          labels[i + 1] = id;
          stack[top++] = i + 1;
        }
        if (y > 0 && grid[i - gw] === 1 && labels[i - gw] === -1) {
          labels[i - gw] = id;
          stack[top++] = i - gw;
        }
        if (y < gh - 1 && grid[i + gw] === 1 && labels[i + gw] === -1) {
          labels[i + gw] = id;
          stack[top++] = i + gw;
        }
      }
      components.push(c);
    }
    return components;
  }

  private pickSpeaker(components: Component[]): number {
    const prev = this.previous;
    let best = -1;
    let bestScore = 0;
    components.forEach((c, i) => {
      const heldSpeaker =
        prev !== null &&
        prev.x >= c.minX &&
        prev.x <= c.maxX &&
        prev.y >= c.minY &&
        prev.y <= c.maxY;
      const score = c.area * (heldSpeaker ? STICKINESS : 1);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) {
      const c = components[best]!;
      this.previous = { x: c.sumX / c.area, y: c.sumY / c.area };
    }
    return best;
  }
}
