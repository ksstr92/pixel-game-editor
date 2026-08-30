'use strict';

// Names and default collision types for the 136 tiles in the bundled default
// tileset (asset/<style>/Tilemap/tilemap_packed.png, 17 cols x 8 rows).
// Transcribed verbatim from editor.html's MT_NAMES / DEFAULT_T so tile ids
// mean the same thing here as they do in the editor and in-game.

const { TILE_TYPES: T } = require('./tileTypes');

const MT_NAMES = [
  // Row 0 — water, terrain, trees, buildings
  'WATER_A', 'WATER_B', 'BLANK', 'STONE_GND', 'WALL_A', 'WALL_B',
  'TREE_A', 'TREE_B', 'TREE_C', 'TREE_PINE', 'HOUSE_A', 'HOUSE_B',
  'HOUSE_C', 'HOUSE_D', 'HOUSE_E', 'HOUSE_F', 'FENCE',

  // Row 1 — ground, grass, paths
  'GRASS_A', 'GRASS_B', 'BUSH_A', 'BUSH_B', 'FLOWER', 'GRASS_C',
  'PATH_A', 'PATH_B', 'GRASS_D', 'PAVED', 'BRIDGE', 'SAND',
  'GRAVEL_A', 'GRAVEL_B', 'COBBLE', 'DIRT_A', 'DIRT_B',

  // Row 2 — dungeon floor tiles (17 variants)
  'FLOOR_A', 'FLOOR_B', 'FLOOR_C', 'FLOOR_D', 'FLOOR_E', 'FLOOR_F',
  'FLOOR_G', 'FLOOR_H', 'FLOOR_I', 'FLOOR_J', 'FLOOR_K', 'FLOOR_L',
  'FLOOR_M', 'FLOOR_N', 'FLOOR_O', 'FLOOR_P', 'FLOOR_Q',

  // Row 3 — walls, windows, doors, objects
  'WALL_C', 'WALL_D', 'WALL_E', 'WALL_F', 'WALL_G',
  'WALL_CNR_TL', 'WALL_CNR_TR', 'WALL_PILLAR', 'WALL_WIN_S', 'WALL_WIN_L',
  'WALL_ARCH_L', 'WALL_BARS', 'WALL_GATE', 'TORCH', 'NPC',
  'SCROLL', 'SIGN',

  // Row 4 — props and objects
  'SPARKLE', 'SKULL_A', 'FIGURE_A', 'TABLE_A', 'TABLE_B', 'CURVE_L',
  'CURVE_R', 'RAILING', 'WINDOW_A', 'WINDOW_B', 'BANNER', 'CHEST_S',
  'MOUNTAIN', 'CABINET_A', 'CABINET_B', 'SHELF', 'CRATE',

  // Row 5 — stones, slopes, items
  'STONE_A', 'STONE_B', 'STONE_C', 'STONE_D', 'STONE_E', 'STONE_FLAT',
  'MEDALLION', 'BARREL', 'RUG', 'PAPER_A', 'PAPER_B', 'SLOPE_NW',
  'FIGURE_B', 'CORNER_SE', 'CORNER_SW', 'SLOPE_NE', 'BOX',

  // Row 6 — arches, textures, containers, doors
  'ARCH_A', 'ARCH_B', 'STONE_TEX_A', 'STONE_TEX_B', 'STONE_TEX_C', 'CRATE_A',
  'CRATE_B', 'CHEST_A', 'CHEST_B', 'FRAME_A', 'FRAME_B', 'CARPET_A',
  'CARPET_B', 'CLOUD', 'DOOR_A', 'DOOR_ARCH', 'MUSHROOM',

  // Row 7 — characters, icons, UI elements
  'HELMET', 'SKULL_B', 'MONK', 'SHADOW_FIG', 'KNIGHT', 'SLIME_A',
  'SLIME_B', 'FACE', 'CROSS', 'HEART_FULL', 'HEART_OUT', 'HEART_HALF',
  'LINE_DIAG', 'SMOKE', 'SCRATCH', 'FRAME_EMPTY', 'SKULL_C',
];

const TOTAL = MT_NAMES.length; // 136

const DEFAULT_T = (() => {
  const t = new Array(TOTAL).fill(T.WALL);
  t[0] = t[1] = T.WATER;
  t[3] = T.GRASS;
  t[6] = t[7] = t[8] = t[9] = T.TREE;
  t[10] = t[11] = t[12] = t[13] = t[14] = t[15] = T.WALL;
  t[16] = T.WALL;
  for (let i = 17; i <= 22; i++) t[i] = T.GRASS;
  t[23] = t[24] = T.PATH; t[25] = T.GRASS;
  t[26] = T.PATH; t[27] = T.PATH;
  t[28] = T.GRASS;
  t[29] = t[30] = t[31] = T.PATH;
  t[32] = t[33] = T.GRASS;
  for (let i = 34; i <= 50; i++) t[i] = T.FLOOR;
  for (let i = 51; i <= 55; i++) t[i] = T.SWALL;
  t[56] = t[57] = T.SWALL;
  t[58] = T.DWALL;
  t[59] = t[60] = T.SWALL;
  t[61] = t[62] = T.SWALL;
  t[63] = T.WALL;
  t[64] = T.FLOOR;
  t[65] = T.FLOOR;
  t[66] = t[67] = T.FLOOR;
  for (let i = 68; i <= 84; i++) t[i] = T.FLOOR;
  t[80] = T.WALL;
  for (let i = 85; i <= 101; i++) t[i] = T.FLOOR;
  t[85] = t[86] = t[87] = t[88] = t[89] = T.WALL;
  t[96] = t[99] = t[100] = T.FLOOR;
  t[102] = t[103] = T.SWALL;
  t[104] = t[105] = t[106] = T.SWALL;
  for (let i = 107; i <= 118; i++) t[i] = T.FLOOR;
  t[115] = T.FLOOR;
  t[116] = T.WALL;
  for (let i = 119; i <= 135; i++) t[i] = T.FLOOR;
  return t;
})();

const TYPE_NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));

function catalog() {
  return MT_NAMES.map((name, id) => ({ id, name, defaultType: TYPE_NAMES[DEFAULT_T[id]] }));
}

function findByName(query) {
  const q = query.toLowerCase();
  return catalog().filter(t => t.name.toLowerCase().includes(q));
}

function idForName(name) {
  const idx = MT_NAMES.findIndex(n => n.toLowerCase() === name.toLowerCase());
  if (idx < 0) throw new Error(`No bundled tile named "${name}". Use tile_catalog_find to search.`);
  return idx;
}

// Bundled spritesheets shipped in the parent project's asset/ folder — pass a
// style to asset_use_bundled to embed one directly, no manual file path needed.
const BUNDLED_STYLES = ['Monochrome', 'Default', 'Dot Matrix'];

module.exports = { MT_NAMES, DEFAULT_T, TOTAL, catalog, findByName, idForName, BUNDLED_STYLES };
