'use strict';

// Data model mirrors the world.json schema produced/consumed by editor.html / game.html.
// See saveFile()/loadWorldData() in editor.html for the authoritative shape.

const { TILE_TYPES } = require('./tileTypes');
const { DEFAULT_T, MT_NAMES } = require('./tileCatalog');

const MAP_COLS = 64;
const MAP_ROWS = 64;

const DEFAULT_TINT = '#ffffff';
const DEFAULT_TOTAL_TILES = 136;

function genId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function emptyGrid(rows, cols, fill = -1) {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function newMap(name, cols = MAP_COLS, rows = MAP_ROWS) {
  return {
    id: genId('map'),
    name,
    cols,
    rows,
    tileMap: emptyGrid(rows, cols),
    overlayMap: emptyGrid(rows, cols),
    exits: [],
    npcs: [],
    triggers: [],
    items: [],
    music: [],
    spawn: { row: Math.floor(rows / 2), col: Math.floor(cols / 2) },
  };
}

function newWorld(firstMapName = 'Map 1') {
  const m = newMap(firstMapName);
  return {
    version: 3,
    currentMapId: m.id,
    maps: [m],
    tintTable: new Array(DEFAULT_TOTAL_TILES).fill(DEFAULT_TINT),
    typeTable: [...DEFAULT_T],
    customNames: [...MT_NAMES],
    nextCustomTileId: DEFAULT_TOTAL_TILES,
    sheet1TileCount: DEFAULT_TOTAL_TILES,
    customTiles: {},
    assets: { tileset: null, tileset2: null },
    npcTemplates: [],
    itemTemplates: [],
    objectTemplates: [],
    recipes: [],
  };
}

// Singleton in-memory world for this server process.
const state = {
  world: newWorld(),
  filePath: null,
};

function findMap(mapId) {
  const m = state.world.maps.find(m => m.id === mapId);
  if (!m) throw new Error(`No map with id "${mapId}"`);
  return m;
}

function ensureTileTables(tileId) {
  const w = state.world;
  while (w.tintTable.length <= tileId) w.tintTable.push(DEFAULT_TINT);
  while (w.typeTable.length <= tileId) w.typeTable.push(TILE_TYPES.WALL);
}

// Allocate a brand-new tile id (for pixel-art tiles with no sheet slot), extending
// tintTable/typeTable/customNames the same way editor.html's duplicateCurrentTile() does.
function allocCustomTileId(name) {
  const w = state.world;
  const id = Math.max(w.nextCustomTileId, w.tintTable.length, w.typeTable.length);
  ensureTileTables(id);
  while (w.customNames.length <= id) w.customNames.push('TILE_' + w.customNames.length);
  if (name) w.customNames[id] = name;
  w.nextCustomTileId = id + 1;
  return id;
}

module.exports = {
  MAP_COLS, MAP_ROWS, TILE_TYPES, DEFAULT_TINT,
  genId, emptyGrid, newMap, newWorld,
  state, findMap, ensureTileTables, allocCustomTileId,
};
