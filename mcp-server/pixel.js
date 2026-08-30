'use strict';

// Headless equivalent of editor.html's pixel tile editor (editCanvas / editedTiles /
// tileBaseMap). Tiles are 16x16 RGBA. On-disk shape matches serializeCustomTiles():
//   world.customTiles[tileId] = { base: number, pixels: number[1024] | null }
// where `pixels` is a flat RGBA byte array (row-major, 4 bytes/pixel) — exactly what
// editor.html/game.html read via ImageData.data.

const SIZE = 16;
const PIXEL_COUNT = SIZE * SIZE;

function hexToRgba(color) {
  if (color === null || color === undefined) return [0, 0, 0, 0];
  const m6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16), 255];
  const m8 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (m8) return [parseInt(m8[1], 16), parseInt(m8[2], 16), parseInt(m8[3], 16), parseInt(m8[4], 16)];
  throw new Error(`Invalid color "${color}" — expected #rrggbb, #rrggbbaa, or null for transparent`);
}

function rgbaToHex([r, g, b, a]) {
  const h = n => n.toString(16).padStart(2, '0');
  return a === 0 ? null : `#${h(r)}${h(g)}${h(b)}${a < 255 ? h(a) : ''}`;
}

function blankPixels() {
  return new Array(PIXEL_COUNT * 4).fill(0);
}

function getEntry(world, tileId) {
  return world.customTiles[String(tileId)] || null;
}

function defaultBase(world, tileId) {
  return tileId < (world.sheet1TileCount || 0) ? tileId : -1;
}

function ensureEntry(world, tileId, base) {
  const key = String(tileId);
  let entry = world.customTiles[key];
  if (!entry) {
    entry = { base: base !== undefined ? base : defaultBase(world, tileId), pixels: blankPixels() };
    world.customTiles[key] = entry;
  } else if (base !== undefined) {
    entry.base = base;
  }
  if (!entry.pixels) entry.pixels = blankPixels();
  return entry;
}

function gridToPixels(grid) {
  if (grid.length !== SIZE || grid.some(row => row.length !== SIZE)) {
    throw new Error(`pixels grid must be ${SIZE}x${SIZE}`);
  }
  const flat = new Array(PIXEL_COUNT * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = hexToRgba(grid[y][x]);
      const i = (y * SIZE + x) * 4;
      flat[i] = r; flat[i + 1] = g; flat[i + 2] = b; flat[i + 3] = a;
    }
  }
  return flat;
}

function pixelsToGrid(pixels) {
  const grid = [];
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      row.push(rgbaToHex([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]));
    }
    grid.push(row);
  }
  return grid;
}

function setPixel(pixels, x, y, rgba) {
  const i = (y * SIZE + x) * 4;
  pixels[i] = rgba[0]; pixels[i + 1] = rgba[1]; pixels[i + 2] = rgba[2]; pixels[i + 3] = rgba[3];
}

function getPixel(pixels, x, y) {
  const i = (y * SIZE + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

// 4-connected flood fill, mirroring editor.html's editorFloodFill().
function floodFill(pixels, startX, startY, newRgba) {
  const old = getPixel(pixels, startX, startY);
  if (old[0] === newRgba[0] && old[1] === newRgba[1] && old[2] === newRgba[2] && old[3] === newRgba[3]) return 0;
  const seen = new Uint8Array(PIXEL_COUNT);
  const q = [startY * SIZE + startX];
  seen[q[0]] = 1;
  let painted = 0;
  while (q.length) {
    const idx = q.shift();
    const py = Math.floor(idx / SIZE), px = idx % SIZE;
    const cur = getPixel(pixels, px, py);
    if (cur[0] !== old[0] || cur[1] !== old[1] || cur[2] !== old[2] || cur[3] !== old[3]) continue;
    setPixel(pixels, px, py, newRgba);
    painted++;
    for (const [ny, nx] of [[py - 1, px], [py + 1, px], [py, px - 1], [py, px + 1]]) {
      if (ny >= 0 && ny < SIZE && nx >= 0 && nx < SIZE) {
        const ni = ny * SIZE + nx;
        if (!seen[ni]) { seen[ni] = 1; q.push(ni); }
      }
    }
  }
  return painted;
}

module.exports = {
  SIZE, hexToRgba, rgbaToHex, blankPixels, getEntry, defaultBase, ensureEntry,
  gridToPixels, pixelsToGrid, setPixel, getPixel, floodFill,
};
