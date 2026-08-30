'use strict';

// Logical collision/passability types, matching T in editor.html / game.html.
const TILE_TYPES = {
  WALL: 0, GRASS: 1, WATER: 2, SWALL: 3, TREE: 4,
  PATH: 5, FLOOR: 6, DWALL: 7, OVERLAY_WALK: 8, OVERLAY_BLOCK: 9,
};

module.exports = { TILE_TYPES };
