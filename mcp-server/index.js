#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const {
  MAP_COLS, MAP_ROWS, TILE_TYPES,
  genId, emptyGrid, newMap, newWorld,
  state, findMap, ensureTileTables, allocCustomTileId,
} = require('./state');
const px = require('./pixel');
const tileCatalog = require('./tileCatalog');

const REPO_ROOT = path.join(__dirname, '..');

function bundledTilesetPath(style) {
  return path.join(REPO_ROOT, 'asset', style, 'Tilemap', 'tilemap_packed.png');
}

function embedBundledTileset(style, slot) {
  const abs = bundledTilesetPath(style);
  const buf = fs.readFileSync(abs);
  state.world.assets[slot] = { name: path.basename(abs), dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
  if (slot === 'tileset') state.world.sheet1TileCount = tileCatalog.TOTAL;
  return abs;
}

const server = new McpServer({ name: 'pixel-world-builder', version: '1.0.0' });

function ok(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function fail(err) {
  return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
}

function tool(name, description, shape, handler) {
  server.tool(name, description, shape, async (args) => {
    try {
      return ok(await handler(args));
    } catch (err) {
      return fail(err);
    }
  });
}

const tileTypeEnum = z.enum(Object.keys(TILE_TYPES));

function mapSummary(m) {
  return {
    id: m.id, name: m.name, cols: m.cols, rows: m.rows, spawn: m.spawn,
    npcCount: m.npcs.length, triggerCount: m.triggers.length,
    itemCount: m.items.length, exitCount: m.exits.length,
    musicTracks: m.music.map(t => t.name),
  };
}

// ── World ────────────────────────────────────────────────────────────────

tool('world_new', 'Start a fresh, empty world in memory with a single map. Discards any unsaved in-memory world. By default embeds the bundled Monochrome tileset so tile ids immediately correspond to real art and tile_catalog_* names — pass bundledTileset: "none" to skip.',
  {
    firstMapName: z.string().default('Map 1'),
    bundledTileset: z.enum([...tileCatalog.BUNDLED_STYLES, 'none']).default('Monochrome'),
  },
  ({ firstMapName, bundledTileset }) => {
    state.world = newWorld(firstMapName);
    state.filePath = null;
    let tileset = null;
    if (bundledTileset !== 'none') {
      const abs = embedBundledTileset(bundledTileset, 'tileset');
      tileset = { style: bundledTileset, path: abs };
    }
    return { message: 'New world created', map: mapSummary(state.world.maps[0]), tileset };
  });

tool('world_load', 'Load a world.json file from disk into memory, replacing the current in-memory world.',
  { filePath: z.string().describe('Path to a world.json file exported by editor.html') },
  ({ filePath }) => {
    const abs = path.resolve(filePath);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    raw.exits = raw.exits || [];
    raw.maps = (raw.maps || []).map(m => ({
      exits: [], npcs: [], triggers: [], items: [], music: [], ...m,
    }));
    raw.npcTemplates = raw.npcTemplates || [];
    raw.itemTemplates = raw.itemTemplates || [];
    raw.objectTemplates = raw.objectTemplates || [];
    raw.recipes = raw.recipes || [];
    raw.assets = raw.assets || { tileset: null, tileset2: null };
    raw.tintTable = raw.tintTable || [];
    raw.typeTable = raw.typeTable || [];
    raw.customNames = raw.customNames || [];
    raw.customTiles = raw.customTiles || {};
    state.world = raw;
    state.filePath = abs;
    return { message: `Loaded ${abs}`, maps: state.world.maps.map(mapSummary) };
  });

tool('world_save', 'Save the in-memory world to a world.json file on disk.',
  { filePath: z.string().optional().describe('Destination path. Defaults to the path last loaded, or ./world.json') },
  ({ filePath }) => {
    const abs = path.resolve(filePath || state.filePath || 'world.json');
    fs.writeFileSync(abs, JSON.stringify(state.world));
    state.filePath = abs;
    return { message: `Saved ${abs}`, maps: state.world.maps.length };
  });

tool('world_summary', 'Get a summary of the in-memory world: maps and their contents, templates, recipes, assets.', {}, () => ({
  currentMapId: state.world.currentMapId,
  maps: state.world.maps.map(mapSummary),
  npcTemplates: state.world.npcTemplates.map(t => ({ id: t.id, displayName: t.displayName, tileId: t.tileId })),
  itemTemplates: state.world.itemTemplates.map(t => ({ id: t.id, name: t.name, tileId: t.tileId, pickup: t.pickup })),
  objectTemplates: state.world.objectTemplates.map(t => ({ id: t.id, name: t.name, rows: t.rows, cols: t.cols })),
  recipes: state.world.recipes.length,
  assets: { tileset: !!state.world.assets.tileset, tileset2: !!state.world.assets.tileset2 },
}));

tool('world_get_raw', 'Get the full raw world.json object currently in memory (can be large).', {}, () => state.world);

tool('world_validate', 'Check the in-memory world for dangling references and out-of-range values (bad map ids, tile ids, template ids).', {}, () => {
  const w = state.world;
  const issues = [];
  const mapIds = new Set(w.maps.map(m => m.id));
  const npcTmplIds = new Set(w.npcTemplates.map(t => t.id));
  const itemTmplIds = new Set(w.itemTemplates.map(t => t.id));

  if (!mapIds.has(w.currentMapId)) issues.push(`currentMapId "${w.currentMapId}" does not match any map`);

  for (const m of w.maps) {
    if (m.tileMap.length !== MAP_ROWS || m.tileMap.some(row => row.length !== MAP_COLS)) {
      issues.push(`Map "${m.name}" tileMap is ${m.tileMap.length}x${m.tileMap[0]?.length ?? 0}, but editor.html/game.html require exactly ${MAP_ROWS}x${MAP_COLS} — this will break switching/rendering/deleting in the editor`);
    }
    if (m.overlayMap.length !== MAP_ROWS || m.overlayMap.some(row => row.length !== MAP_COLS)) {
      issues.push(`Map "${m.name}" overlayMap is not ${MAP_ROWS}x${MAP_COLS}`);
    }
    for (const e of m.exits) {
      if (!mapIds.has(e.toMapId)) issues.push(`Map "${m.name}" exit ${e.id}: toMapId "${e.toMapId}" not found`);
    }
    for (const n of m.npcs) {
      if (n.templateId && !npcTmplIds.has(n.templateId)) issues.push(`Map "${m.name}" NPC ${n.id}: templateId "${n.templateId}" not found`);
      for (const s of n.schedule || []) {
        if (!mapIds.has(s.mapId)) issues.push(`Map "${m.name}" NPC ${n.id} schedule: mapId "${s.mapId}" not found`);
      }
    }
    for (const it of m.items) {
      if (it.templateId && !itemTmplIds.has(it.templateId)) issues.push(`Map "${m.name}" item ${it.id}: templateId "${it.templateId}" not found`);
    }
    for (const t of m.triggers) {
      for (const ev of t.events || []) {
        if (ev.type === 'transitionToMap' && ev.toMapId && !mapIds.has(ev.toMapId)) {
          issues.push(`Map "${m.name}" trigger ${t.id}: transitionToMap toMapId "${ev.toMapId}" not found`);
        }
      }
    }
  }
  for (const r of w.recipes) {
    for (const inp of r.inputs) {
      if (!itemTmplIds.has(inp.templateId)) issues.push(`Recipe ${r.id}: input templateId "${inp.templateId}" not found`);
    }
    if (!itemTmplIds.has(r.output.templateId)) issues.push(`Recipe ${r.id}: output templateId "${r.output.templateId}" not found`);
  }
  return issues.length ? { valid: false, issues } : { valid: true, issues: [] };
});

// ── Assets ───────────────────────────────────────────────────────────────

tool('asset_set_tileset', 'Load a local PNG spritesheet file as tileset 1 or 2 (embeds it as a data URL, same as uploading in the editor).',
  {
    slot: z.enum(['tileset', 'tileset2']),
    filePath: z.string(),
    tileCount: z.number().int().positive().optional().describe('Number of tiles in this sheet, if known — updates sheet tile counts'),
  },
  ({ slot, filePath, tileCount }) => {
    const abs = path.resolve(filePath);
    const buf = fs.readFileSync(abs);
    const b64 = buf.toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;
    state.world.assets[slot] = { name: path.basename(abs), dataUrl };
    if (tileCount) {
      if (slot === 'tileset') {
        state.world.sheet1TileCount = tileCount;
      }
    }
    return { message: `Set ${slot} from ${abs} (${buf.length} bytes)` };
  });

tool('asset_use_bundled', `Embed one of the tileset styles that ships in this project's asset/ folder (${tileCatalog.BUNDLED_STYLES.join(', ')}) — same 136-tile layout in different art styles, so tile ids and tile_catalog_* names apply to all of them. Prefer this over asset_set_tileset for the common case.`,
  { style: z.enum(tileCatalog.BUNDLED_STYLES), slot: z.enum(['tileset', 'tileset2']).default('tileset') },
  ({ style, slot }) => {
    const abs = embedBundledTileset(style, slot);
    return { message: `Embedded bundled "${style}" tileset in slot "${slot}" from ${abs}` };
  });

// ── Tile catalog ─────────────────────────────────────────────────────────
// Names, default collision types, and USAGE ROLES for the 136 tiles in the
// bundled tileset, so tiles can be picked by meaning ("PATH_A", "TREE_PINE")
// instead of guessing raw integer ids — and, critically, so the difference
// between "this tile IS a complete object" and "this tile is one PIECE of a
// bigger structure" is explicit instead of assumed.
//
// role values (see tileCatalog.js roleFor() for exactly which names map where):
//   structure — already a whole object (a whole tree, a whole little house).
//               Place ONE tile per tree/building. Never assemble several
//               'structure' tiles to try to build one bigger building — there
//               is no such assembly in this tileset; HOUSE_A..F are each a
//               complete building already, just in different styles/sizes.
//   wall      — one PIECE of a wall run (plain segment/corner/pillar/window/
//               arch/bars/gate). A single 'wall' tile placed alone does NOT
//               read as a wall or building — it must be assembled into an
//               outline (see room_outline) or via object_template_create +
//               object_stamp. Never tile_fill_rect a 'wall' tile over an area.
//   door      — a doorway insert placed where a wall run has a gap.
//   linear    — placed as a repeated line (fence, bridge, railing), not
//               filled as an area and not a standalone object.
//   terrain   — seamless ground cover (grass/path/water/floor/...). Safe to
//               tile_fill_rect over any area.
//   prop      — a complete single-tile decoration (chest, table, barrel,
//               creature, character...). Place individually, like 'structure'.
//   icon      — a small UI/decorative glyph (heart, cross, sparkle) — rarely
//               what you want as actual map scenery.
// Only meaningful when the world uses a bundled/default-layout sheet.

tool('tile_catalog_list', 'List all 136 bundled tile ids with their names, default collision type, and usage role (structure/wall/door/linear/terrain/prop/icon — see tool description context). Call this before placing tiles for a new kind of scenery.', {}, () => tileCatalog.catalog());

tool('tile_catalog_find', 'Search bundled tile names by substring (case-insensitive), e.g. "wall", "tree", "door". Each result includes its usage role.',
  { query: z.string() },
  ({ query }) => tileCatalog.findByName(query));

tool('tile_catalog_by_role', 'List bundled tiles by usage role: "structure" (complete single-tile buildings/trees — place one), "wall" (wall-run pieces that must be assembled — see room_outline), "door", "linear" (fences/bridges, placed in a line), "terrain" (freely fillable ground cover), "prop" (standalone decorations), or "icon" (UI glyphs, rarely map scenery).',
  { role: z.enum(['structure', 'wall', 'door', 'linear', 'terrain', 'prop', 'icon']) },
  ({ role }) => tileCatalog.findByRole(role));

tool('tile_name_to_id', 'Resolve a bundled tile name (e.g. "GRASS_A") to its tile id.',
  { name: z.string() },
  ({ name }) => ({ name, id: tileCatalog.idForName(name) }));

tool('structure_guide', 'Read before placing scenery: minimum-tile-count conventions for common concepts (trees, forests, houses, rooms), how many tiles ONE object needs — and separately, how several objects should relate to EACH OTHER spatially (clustered into a village vs. deliberately isolated, connected by a path vs. not, a river that actually flows through the map vs. a disconnected puddle). Call this once per session before building out a map\'s scenery.', {}, () => ({
  principles: [
    'A "structure" or "prop" role tile (tile_catalog_by_role) is already a complete object at 1 tile — placing several of the SAME concept next to each other does not make one bigger version of it; it just repeats the object.',
    'A "wall"/"door"/"linear" role tile is one PIECE of something bigger and looks wrong placed alone — assemble with room_outline or a saved object_template (see object_template_find before building a new one).',
    'More tiles = more visual detail, not a different collision/gameplay meaning by itself — scale up tile count only for scenery you want to stand out (a landmark building, a dense forest), not uniformly.',
    'Decide the RELATIONSHIP before placing: is this one of a cluster (village houses, a forest, a mountain range) or a deliberately isolated landmark (a lone cottage, a lone dead tree)? That decision drives spacing and whether a path connects it to anything — see "layout" below.',
  ],
  concepts: [
    { concept: 'tree', minTiles: 1, guidance: 'One TREE_* structure tile is a complete tree. Fine to scatter individually across grass.' },
    { concept: 'forest', minTiles: 4, guidance: 'A cluster of 4+ TREE_* tiles reads as a forest patch. Use scatter_area with several TREE_* ids (for variety) and minSpacing 1-2 for a dense wood, 3+ for a sparse treeline — never a hand-placed perfect grid, it reads as planted.' },
    { concept: 'small building', minTiles: 1, guidance: 'One HOUSE_* structure tile is a complete small building — good for background/distant buildings or a village of simple houses.' },
    { concept: 'large / detailed building', minTiles: '10+ (e.g. 13)', guidance: 'Needs a hand-built multi-tile composite (roof + textured walls + a door insert) saved via object_template_create with category:"building" — there is no single tile for this, and no verified stock recipe shipped here yet. Build it once, look at it in the editor, then reuse it with object_stamp instead of re-deriving the layout each time. Check object_template_find({category:"building"}) first in case one already exists in this world.' },
    { concept: 'room / building interior', minTiles: 'width*height', guidance: 'Use room_outline for a plain rectangular room (wall run + floor fill). For anything irregular, build once with object_template_create using wall/door role tiles, verify visually, then reuse.' },
  ],
  layout: [
    {
      relationship: 'settlement (houses that belong together)',
      guidance: 'Cluster building placements within roughly 3-8 tiles of each other, facing/opening onto a shared path or a central clearing — not scattered randomly across the whole map. Use path_between to connect every house entrance to the shared path, and that path to the map\'s spawn/exit. A group of houses with no path between them reads as ruins, not a lived-in village.',
    },
    {
      relationship: 'isolated structure (a lone house, a hermit\'s hut, a landmark tree)',
      guidance: 'Deliberately keep 10+ tiles of distance from other structures and skip the connecting path (or give it a single unmaintained-looking dirt path via path_between with a PATH/DIRT tileId) — the absence of infrastructure is what signals "remote" or "abandoned". Don\'t place other buildings nearby, or it stops reading as isolated.',
    },
    {
      relationship: 'river',
      guidance: 'Build with path_between using a WATER_* tileId and several waypoints so it can meander — pass width 2-3 for a proper river vs. 1 for a stream. It must be a single unbroken connected line with a clear source and exit (both ends at the map edge, or one end feeding a lake/pond area) — a short isolated water segment in the middle of a field reads as a puddle, not a river. Where a road path must cross it, place a BRIDGE tile (tile_name_to_id({name:"BRIDGE"})) at the crossing cell after painting both the river and the road.',
    },
    {
      relationship: 'road / path network',
      guidance: 'Only draw a path with path_between between two places that matter — spawn, a map exit, a settlement, a landmark. A path connects things; it should not start and end in open grass with nothing at either end, and it should not cross itself in confusing ways. Building entrances (the doorCol cell from room_outline, or the front tile of a structure) are the natural path endpoints.',
    },
    {
      relationship: 'general spacing rule',
      guidance: 'Objects meant to belong to the same group (same settlement, same forest, same rock field) go close together with a connecting path if they are buildings; objects meant to read as unrelated/separate go far enough apart (10+ tiles) that the eye doesn\'t group them. There is no good "medium" distance — near-but-unconnected buildings just look like a layout mistake.',
    },
  ],
}));

// ── Maps ─────────────────────────────────────────────────────────────────

tool('map_create', `Create a new map in the world. Maps are always ${MAP_ROWS}x${MAP_COLS} — editor.html/game.html hardcode that grid size everywhere except multi-tile object stamps, so a map of any other size renders/switches/deletes incorrectly and can break the editor UI.`,
  { name: z.string() },
  ({ name }) => {
    const m = newMap(name, MAP_COLS, MAP_ROWS);
    state.world.maps.push(m);
    return mapSummary(m);
  });

tool('map_list', 'List all maps in the world with summary info.', {}, () => state.world.maps.map(mapSummary));

tool('map_rename', 'Rename a map.', { mapId: z.string(), name: z.string() }, ({ mapId, name }) => {
  findMap(mapId).name = name;
  return { message: 'Renamed' };
});

tool('map_delete', 'Delete a map from the world.', { mapId: z.string() }, ({ mapId }) => {
  const w = state.world;
  const idx = w.maps.findIndex(m => m.id === mapId);
  if (idx < 0) throw new Error(`No map with id "${mapId}"`);
  w.maps.splice(idx, 1);
  if (w.currentMapId === mapId) w.currentMapId = w.maps[0]?.id ?? null;
  return { message: 'Deleted', remaining: w.maps.length };
});

tool('map_duplicate', 'Duplicate a map, including its NPCs, triggers, items, and exits (with freshly generated ids).',
  { mapId: z.string(), name: z.string().optional() },
  ({ mapId, name }) => {
    const src = findMap(mapId);
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = genId('map');
    clone.name = name || (src.name + ' Copy');
    clone.exits = (src.exits || []).map(e => ({ ...e, id: genId('exit') }));
    clone.npcs = (src.npcs || []).map(n => ({ ...n, id: genId('npc') }));
    clone.triggers = (src.triggers || []).map(t => ({ ...t, id: genId('trig') }));
    clone.items = (src.items || []).map(it => ({ ...it, id: genId('item') }));
    state.world.maps.push(clone);
    return mapSummary(clone);
  });

tool('map_set_spawn', 'Set the player spawn point for a map.',
  { mapId: z.string(), row: z.number().int(), col: z.number().int() },
  ({ mapId, row, col }) => {
    findMap(mapId).spawn = { row, col };
    return { message: 'Spawn set' };
  });

tool('map_get', 'Get full details of one map (tile grids included — can be large).',
  { mapId: z.string() }, ({ mapId }) => findMap(mapId));

// ── Tiles ────────────────────────────────────────────────────────────────

tool('tile_paint', 'Paint one or more individual tiles on a map layer.',
  {
    mapId: z.string(),
    layer: z.enum(['base', 'overlay']).default('base'),
    cells: z.array(z.object({ row: z.number().int(), col: z.number().int(), tileId: z.number().int() })).min(1),
  },
  ({ mapId, layer, cells }) => {
    const m = findMap(mapId);
    const grid = layer === 'overlay' ? m.overlayMap : m.tileMap;
    for (const { row, col, tileId } of cells) {
      if (row < 0 || row >= m.rows || col < 0 || col >= m.cols) throw new Error(`Cell (${row},${col}) out of bounds for map ${m.rows}x${m.cols}`);
      grid[row][col] = tileId;
      if (tileId >= 0) ensureTileTables(tileId);
    }
    return { message: `Painted ${cells.length} cell(s) on ${layer} layer` };
  });

tool('tile_fill_rect', 'Fill a rectangular region of a map layer with one tile id.',
  {
    mapId: z.string(),
    layer: z.enum(['base', 'overlay']).default('base'),
    rowStart: z.number().int(), colStart: z.number().int(),
    rowEnd: z.number().int(), colEnd: z.number().int(),
    tileId: z.number().int(),
  },
  ({ mapId, layer, rowStart, colStart, rowEnd, colEnd, tileId }) => {
    const m = findMap(mapId);
    const grid = layer === 'overlay' ? m.overlayMap : m.tileMap;
    const r0 = Math.max(0, Math.min(rowStart, rowEnd)), r1 = Math.min(m.rows - 1, Math.max(rowStart, rowEnd));
    const c0 = Math.max(0, Math.min(colStart, colEnd)), c1 = Math.min(m.cols - 1, Math.max(colStart, colEnd));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r][c] = tileId;
    if (tileId >= 0) ensureTileTables(tileId);
    return { message: `Filled rows ${r0}-${r1}, cols ${c0}-${c1} with tile ${tileId} on ${layer} layer` };
  });

tool('tile_get', 'Read the base and overlay tile ids at one cell.',
  { mapId: z.string(), row: z.number().int(), col: z.number().int() },
  ({ mapId, row, col }) => {
    const m = findMap(mapId);
    return { base: m.tileMap[row]?.[col] ?? null, overlay: m.overlayMap[row]?.[col] ?? null };
  });

tool('tiletype_set', 'Set the collision/passability type for a tile id (applies wherever that tile id is used, across all maps).',
  { tileId: z.number().int(), type: tileTypeEnum },
  ({ tileId, type }) => {
    ensureTileTables(tileId);
    state.world.typeTable[tileId] = TILE_TYPES[type];
    return { message: `Tile ${tileId} type set to ${type}` };
  });

tool('tiletype_get', 'Get the collision/passability type for a tile id.',
  { tileId: z.number().int() },
  ({ tileId }) => {
    const v = state.world.typeTable[tileId];
    const name = Object.keys(TILE_TYPES).find(k => TILE_TYPES[k] === v);
    return { tileId, type: name ?? null, raw: v ?? null };
  });

tool('tile_tint_set', 'Set a tint color (recolor) applied to a tile id.',
  { tileId: z.number().int(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) },
  ({ tileId, color }) => {
    ensureTileTables(tileId);
    state.world.tintTable[tileId] = color;
    return { message: `Tile ${tileId} tint set to ${color}` };
  });

// ── Pixel-level custom tile editing ─────────────────────────────────────
// Headless equivalent of editor.html's 16×16 pixel editor. `pixels` here is the
// user-drawn overlay layer only (mostly transparent) — it is composited on top of
// the sheet tile named by `base` at render time, exactly as editor.html/game.html do.

const colorCell = z.union([z.string().regex(/^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/), z.null()])
  .describe('#rrggbb, #rrggbbaa, or null for transparent');

tool('tile_pixels_set', 'Overwrite the full 16x16 pixel-edit layer for a tile id (a custom drawing on top of the sheet tile, or a wholly new tile if base is -1).',
  {
    tileId: z.number().int(),
    base: z.number().int().optional().describe('Sheet tile id to draw underneath, or -1 for none. Defaults to tileId itself if it falls within sheet1TileCount, else -1.'),
    pixels: z.array(z.array(colorCell)).length(16).describe('16 rows x 16 cols of colors, top-left origin'),
  },
  ({ tileId, base, pixels }) => {
    ensureTileTables(tileId);
    const entry = px.ensureEntry(state.world, tileId, base);
    entry.pixels = px.gridToPixels(pixels);
    return { message: `Set pixel layer for tile ${tileId}`, base: entry.base };
  });

tool('tile_pixel_paint', 'Paint individual pixels onto a tile\'s pixel-edit layer without touching the rest (creates the layer if it does not exist yet, starting fully transparent).',
  {
    tileId: z.number().int(),
    base: z.number().int().optional(),
    pixels: z.array(z.object({ x: z.number().int().min(0).max(15), y: z.number().int().min(0).max(15), color: colorCell })).min(1),
  },
  ({ tileId, base, pixels }) => {
    ensureTileTables(tileId);
    const entry = px.ensureEntry(state.world, tileId, base);
    for (const { x, y, color } of pixels) px.setPixel(entry.pixels, x, y, px.hexToRgba(color));
    return { message: `Painted ${pixels.length} pixel(s) on tile ${tileId}`, base: entry.base };
  });

tool('tile_pixel_fill', 'Flood-fill a contiguous region of a tile\'s pixel-edit layer starting at (x, y), same as the editor\'s bucket tool.',
  {
    tileId: z.number().int(),
    base: z.number().int().optional(),
    x: z.number().int().min(0).max(15), y: z.number().int().min(0).max(15),
    color: colorCell,
  },
  ({ tileId, base, x, y, color }) => {
    ensureTileTables(tileId);
    const entry = px.ensureEntry(state.world, tileId, base);
    const painted = px.floodFill(entry.pixels, x, y, px.hexToRgba(color));
    return { message: `Flood-filled ${painted} pixel(s) on tile ${tileId}`, base: entry.base };
  });

tool('tile_pixels_get', 'Read a tile\'s current pixel-edit layer as a 16x16 grid of hex colors (null = transparent), plus its base sheet tile id. Returns null if the tile has no custom pixel edits.',
  { tileId: z.number().int() },
  ({ tileId }) => {
    const entry = px.getEntry(state.world, tileId);
    if (!entry || !entry.pixels) return null;
    return { tileId, base: entry.base, pixels: px.pixelsToGrid(entry.pixels) };
  });

tool('tile_pixels_clear', 'Remove all custom pixel edits for a tile id, reverting it to the plain sheet tile.',
  { tileId: z.number().int() },
  ({ tileId }) => {
    delete state.world.customTiles[String(tileId)];
    return { message: `Cleared pixel edits for tile ${tileId}` };
  });

tool('tile_duplicate', 'Duplicate a tile (pixel edits, tint, type, and name) into a brand-new tile id, same as the editor\'s "duplicate tile" action. Useful for making a variant without touching the original.',
  { tileId: z.number().int(), name: z.string().optional() },
  ({ tileId, name }) => {
    const w = state.world;
    ensureTileTables(tileId);
    const srcEntry = px.getEntry(w, tileId);
    const baseId = srcEntry ? srcEntry.base : px.defaultBase(w, tileId);
    const newId = allocCustomTileId(name || ((w.customNames[tileId] || 'TILE_' + tileId) + '_copy'));
    w.tintTable[newId] = w.tintTable[tileId] || '#ffffff';
    w.typeTable[newId] = w.typeTable[tileId] ?? TILE_TYPES.WALL;
    w.customTiles[String(newId)] = {
      base: baseId,
      pixels: srcEntry?.pixels ? [...srcEntry.pixels] : px.blankPixels(),
    };
    return { message: `Duplicated tile ${tileId} → ${newId}`, newTileId: newId, base: baseId };
  });

tool('tile_create_blank', 'Allocate a brand-new tile id with no sheet backing, ready for pure pixel art (base = -1 unless you place it over an existing sheet tile).',
  { name: z.string().optional(), base: z.number().int().default(-1) },
  ({ name, base }) => {
    const newId = allocCustomTileId(name);
    state.world.customTiles[String(newId)] = { base, pixels: px.blankPixels() };
    return { message: `Created tile ${newId}`, tileId: newId };
  });

// ── NPCs ─────────────────────────────────────────────────────────────────

const patrolSchema = z.union([
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('wander'), radius: z.number().int().positive() }),
  z.object({ type: z.literal('waypoint'), points: z.array(z.object({ row: z.number().int(), col: z.number().int() })) }),
]).default({ type: 'none' });

const scheduleEntrySchema = z.object({
  startMin: z.number().int().min(0).max(1439).default(0),
  endMin: z.number().int().min(0).max(1439).default(480),
  mapId: z.string(),
  row: z.number().int().default(0),
  col: z.number().int().default(0),
  behavior: z.enum(['idle', 'wander']).default('idle'),
  radius: z.number().int().positive().default(3),
});

tool('npc_add', 'Place a new NPC on a map.',
  {
    mapId: z.string(), row: z.number().int(), col: z.number().int(),
    name: z.string().default('Villager'),
    tileId: z.number().int().default(-1),
    dialog: z.array(z.string()).min(1).default(['...']),
    templateId: z.string().nullable().optional(),
    patrol: patrolSchema,
    schedule: z.array(scheduleEntrySchema).default([]),
  },
  ({ mapId, row, col, name, tileId, dialog, templateId, patrol, schedule }) => {
    const m = findMap(mapId);
    if (m.tileMap[row]) m.tileMap[row][col] = -1;
    const npc = { id: genId('npc'), row, col, name, tileId, dialog, portrait: null, templateId: templateId ?? null, patrol, schedule };
    m.npcs.push(npc);
    return npc;
  });

tool('npc_update', 'Update fields on an existing NPC.',
  {
    mapId: z.string(), npcId: z.string(),
    name: z.string().optional(), tileId: z.number().int().optional(),
    dialog: z.array(z.string()).optional(), row: z.number().int().optional(), col: z.number().int().optional(),
    patrol: patrolSchema.optional(), schedule: z.array(scheduleEntrySchema).optional(),
  },
  ({ mapId, npcId, ...fields }) => {
    const m = findMap(mapId);
    const npc = m.npcs.find(n => n.id === npcId);
    if (!npc) throw new Error(`No NPC with id "${npcId}" on map "${mapId}"`);
    Object.assign(npc, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    return npc;
  });

tool('npc_delete', 'Remove an NPC from a map.', { mapId: z.string(), npcId: z.string() }, ({ mapId, npcId }) => {
  const m = findMap(mapId);
  const idx = m.npcs.findIndex(n => n.id === npcId);
  if (idx < 0) throw new Error(`No NPC with id "${npcId}"`);
  m.npcs.splice(idx, 1);
  return { message: 'NPC removed' };
});

tool('npc_list', 'List NPCs on a map.', { mapId: z.string() }, ({ mapId }) => findMap(mapId).npcs);

tool('npc_template_create', 'Create a reusable NPC template (tile + optional portrait).',
  { displayName: z.string(), tileId: z.number().int() },
  ({ displayName, tileId }) => {
    const t = { id: genId('tmpl'), displayName, tileId, portrait: null };
    state.world.npcTemplates.push(t);
    return t;
  });

tool('npc_template_list', 'List NPC templates.', {}, () => state.world.npcTemplates);

tool('npc_template_delete', 'Delete an NPC template.', { templateId: z.string() }, ({ templateId }) => {
  const w = state.world;
  const idx = w.npcTemplates.findIndex(t => t.id === templateId);
  if (idx < 0) throw new Error(`No template with id "${templateId}"`);
  w.npcTemplates.splice(idx, 1);
  return { message: 'Template deleted' };
});

// ── Triggers ─────────────────────────────────────────────────────────────

const triggerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dialog'), lines: z.array(z.string()), npcId: z.string().optional(), npcName: z.string().optional() }),
  z.object({ type: z.literal('cameraPan'), row: z.number().int(), col: z.number().int(), duration: z.number().positive().default(2.0), return: z.boolean().default(true), fromRow: z.number().int().optional(), fromCol: z.number().int().optional() }),
  z.object({ type: z.literal('tileChange'), changes: z.array(z.object({ row: z.number().int(), col: z.number().int(), tileId: z.number().int() })) }),
  z.object({ type: z.literal('setTimeOfDay'), gameMinutes: z.number().int().min(0).max(1439) }),
  z.object({ type: z.literal('transitionToMap'), toMapId: z.string(), toRow: z.number().int().default(0), toCol: z.number().int().default(0) }),
]);

tool('trigger_add', 'Add a trigger to a map. A trigger fires a chain of events on Walk, Interact [E], or Map Load.',
  {
    mapId: z.string(), row: z.number().int(), col: z.number().int(),
    activation: z.enum(['walk', 'interact', 'mapload']),
    title: z.string().default(''),
    oneShot: z.boolean().default(false),
    events: z.array(triggerEventSchema).min(1),
  },
  ({ mapId, row, col, activation, title, oneShot, events }) => {
    const m = findMap(mapId);
    const trig = { id: genId('trig'), row, col, activation, title, oneShot, events };
    m.triggers.push(trig);
    return trig;
  });

tool('trigger_update', 'Update fields on an existing trigger (full replace of provided fields, e.g. events).',
  {
    mapId: z.string(), triggerId: z.string(),
    activation: z.enum(['walk', 'interact', 'mapload']).optional(),
    title: z.string().optional(), oneShot: z.boolean().optional(),
    events: z.array(triggerEventSchema).optional(),
  },
  ({ mapId, triggerId, ...fields }) => {
    const m = findMap(mapId);
    const trig = m.triggers.find(t => t.id === triggerId);
    if (!trig) throw new Error(`No trigger with id "${triggerId}"`);
    Object.assign(trig, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    return trig;
  });

tool('trigger_delete', 'Remove a trigger from a map.', { mapId: z.string(), triggerId: z.string() }, ({ mapId, triggerId }) => {
  const m = findMap(mapId);
  const idx = m.triggers.findIndex(t => t.id === triggerId);
  if (idx < 0) throw new Error(`No trigger with id "${triggerId}"`);
  m.triggers.splice(idx, 1);
  return { message: 'Trigger removed' };
});

tool('trigger_list', 'List triggers on a map.', { mapId: z.string() }, ({ mapId }) => findMap(mapId).triggers);

// ── Items ────────────────────────────────────────────────────────────────

tool('item_add', 'Place a collectible item on a map.',
  {
    mapId: z.string(), row: z.number().int(), col: z.number().int(),
    name: z.string(), tileId: z.number().int(), description: z.string().default(''),
    pickup: z.enum(['interact', 'auto']).default('interact'),
    templateId: z.string().nullable().optional(),
  },
  ({ mapId, row, col, name, tileId, description, pickup, templateId }) => {
    const m = findMap(mapId);
    const item = { id: genId('item'), row, col, name, tileId, description, pickup, templateId: templateId ?? null };
    m.items.push(item);
    return item;
  });

tool('item_update', 'Update fields on an existing placed item.',
  {
    mapId: z.string(), itemId: z.string(),
    name: z.string().optional(), tileId: z.number().int().optional(),
    description: z.string().optional(), pickup: z.enum(['interact', 'auto']).optional(),
    row: z.number().int().optional(), col: z.number().int().optional(),
  },
  ({ mapId, itemId, ...fields }) => {
    const m = findMap(mapId);
    const item = m.items.find(i => i.id === itemId);
    if (!item) throw new Error(`No item with id "${itemId}"`);
    Object.assign(item, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    return item;
  });

tool('item_delete', 'Remove a placed item from a map.', { mapId: z.string(), itemId: z.string() }, ({ mapId, itemId }) => {
  const m = findMap(mapId);
  const idx = m.items.findIndex(i => i.id === itemId);
  if (idx < 0) throw new Error(`No item with id "${itemId}"`);
  m.items.splice(idx, 1);
  return { message: 'Item removed' };
});

tool('item_list', 'List placed items on a map.', { mapId: z.string() }, ({ mapId }) => findMap(mapId).items);

tool('item_template_create', 'Create a reusable item template (name, tile, description, pickup mode) for use with item_add or recipes.',
  {
    name: z.string(), tileId: z.number().int(), description: z.string().default(''),
    pickup: z.enum(['interact', 'auto']).default('interact'),
  },
  ({ name, tileId, description, pickup }) => {
    const t = { id: genId('itmpl'), name, tileId, description, pickup };
    state.world.itemTemplates.push(t);
    return t;
  });

tool('item_template_list', 'List item templates.', {}, () => state.world.itemTemplates);

tool('item_template_delete', 'Delete an item template.', { templateId: z.string() }, ({ templateId }) => {
  const w = state.world;
  const idx = w.itemTemplates.findIndex(t => t.id === templateId);
  if (idx < 0) throw new Error(`No template with id "${templateId}"`);
  w.itemTemplates.splice(idx, 1);
  return { message: 'Template deleted' };
});

// ── Exits ────────────────────────────────────────────────────────────────

tool('exit_add', 'Add an exit zone on a map that teleports the player to another map.',
  {
    mapId: z.string(), fromRow: z.number().int(), fromCol: z.number().int(),
    toMapId: z.string(), toRow: z.number().int(), toCol: z.number().int(),
  },
  ({ mapId, fromRow, fromCol, toMapId, toRow, toCol }) => {
    const m = findMap(mapId);
    const exit = { id: genId('exit'), fromRow, fromCol, toMapId, toRow, toCol };
    m.exits.push(exit);
    return exit;
  });

tool('exit_delete', 'Remove an exit from a map.', { mapId: z.string(), exitId: z.string() }, ({ mapId, exitId }) => {
  const m = findMap(mapId);
  const idx = m.exits.findIndex(e => e.id === exitId);
  if (idx < 0) throw new Error(`No exit with id "${exitId}"`);
  m.exits.splice(idx, 1);
  return { message: 'Exit removed' };
});

tool('exit_list', 'List exits on a map.', { mapId: z.string() }, ({ mapId }) => findMap(mapId).exits);

// ── Music ────────────────────────────────────────────────────────────────

tool('music_track_add', 'Add a background music track to a map by filename (file must live in a music/ folder next to game.html at play time).',
  { mapId: z.string(), filename: z.string() },
  ({ mapId, filename }) => {
    const m = findMap(mapId);
    m.music.push({ name: filename });
    return { message: `Added track "${filename}"`, tracks: m.music.map(t => t.name) };
  });

tool('music_track_remove', 'Remove a background music track from a map by filename.',
  { mapId: z.string(), filename: z.string() },
  ({ mapId, filename }) => {
    const m = findMap(mapId);
    const idx = m.music.findIndex(t => t.name === filename);
    if (idx < 0) throw new Error(`No track "${filename}" on this map`);
    m.music.splice(idx, 1);
    return { message: 'Track removed', tracks: m.music.map(t => t.name) };
  });

tool('music_list', 'List music tracks on a map.', { mapId: z.string() }, ({ mapId }) => findMap(mapId).music);

// ── Recipes ──────────────────────────────────────────────────────────────

tool('recipe_create', 'Create a crafting recipe combining item templates into a result item.',
  {
    inputs: z.array(z.object({ templateId: z.string(), count: z.number().int().positive().default(1) })).min(2),
    output: z.object({ templateId: z.string(), count: z.number().int().positive().default(1) }),
  },
  ({ inputs, output }) => {
    const r = { id: genId('recipe'), inputs, output };
    state.world.recipes.push(r);
    return r;
  });

tool('recipe_list', 'List crafting recipes.', {}, () => state.world.recipes);

tool('recipe_delete', 'Delete a crafting recipe.', { recipeId: z.string() }, ({ recipeId }) => {
  const w = state.world;
  const idx = w.recipes.findIndex(r => r.id === recipeId);
  if (idx < 0) throw new Error(`No recipe with id "${recipeId}"`);
  w.recipes.splice(idx, 1);
  return { message: 'Recipe deleted' };
});

// ── Object templates (multi-tile stamps) ────────────────────────────────

function templateTileCount(t) {
  let n = 0;
  for (const row of t.tiles) for (const v of row) if (v >= 0) n++;
  if (t.overlay) for (const row of t.overlay) for (const v of row) if (v >= 0) n++;
  return n;
}

function templateSummary(t) {
  return { id: t.id, name: t.name, category: t.category ?? null, description: t.description ?? '', rows: t.rows, cols: t.cols, tileCount: templateTileCount(t) };
}

tool('object_template_create', `Create a reusable multi-tile stamp (e.g. a house or tree cluster) from explicit tile/overlay grids. Prefer object_template_create + object_stamp over placing 'wall'/'structure' pieces by hand for anything you'll reuse — annotate it with category/description so it shows up under object_template_find and future calls (yours or another agent's) don't have to re-derive the same layout. Verify the result looks right in the editor before treating it as reusable, especially for anything built from 'wall'-role pieces.`,
  {
    name: z.string(),
    category: z.string().optional().describe('Free-form grouping for discovery, e.g. "building", "vegetation", "furniture". Use tile_catalog_by_role({role:"structure"}) roots for single-tile concepts and reserve templates for multi-tile ones.'),
    description: z.string().optional().describe('What this represents and any composition notes, e.g. "13-tile detailed house: 2-wide sloped roof over a 3x3 stone wall block with a door insert".'),
    rows: z.number().int().positive(),
    cols: z.number().int().positive(),
    tiles: z.array(z.array(z.number().int())),
    overlay: z.array(z.array(z.number().int())).optional(),
  },
  ({ name, category, description, rows, cols, tiles, overlay }) => {
    if (tiles.length !== rows || tiles.some(r => r.length !== cols)) {
      throw new Error(`tiles must be a ${rows}x${cols} grid`);
    }
    const overlayTiles = overlay ?? emptyGrid(rows, cols);
    const t = { id: genId('obj'), name, category: category ?? null, description: description ?? '', rows, cols, tiles, overlay: overlayTiles };
    state.world.objectTemplates.push(t);
    return templateSummary(t);
  });

tool('object_template_list', 'List object (multi-tile stamp) templates with their category/description/tileCount.', {}, () => state.world.objectTemplates.map(templateSummary));

tool('object_template_find', 'List object templates filtered by category (e.g. "building", "vegetation") — use this before building a new template from scratch, in case one already exists.',
  { category: z.string() },
  ({ category }) => state.world.objectTemplates.filter(t => (t.category ?? '').toLowerCase() === category.toLowerCase()).map(templateSummary));

tool('object_template_delete', 'Delete an object template.', { objectId: z.string() }, ({ objectId }) => {
  const w = state.world;
  const idx = w.objectTemplates.findIndex(t => t.id === objectId);
  if (idx < 0) throw new Error(`No object template with id "${objectId}"`);
  w.objectTemplates.splice(idx, 1);
  return { message: 'Object template deleted' };
});

tool('object_stamp', 'Stamp an object template onto a map, top-left anchored at (row, col). Clips at map bounds.',
  { mapId: z.string(), objectId: z.string(), row: z.number().int(), col: z.number().int() },
  ({ mapId, objectId, row, col }) => {
    const m = findMap(mapId);
    const t = state.world.objectTemplates.find(o => o.id === objectId);
    if (!t) throw new Error(`No object template with id "${objectId}"`);
    let painted = 0;
    for (let r = 0; r < t.rows; r++) {
      const mr = row + r;
      if (mr < 0 || mr >= m.rows) continue;
      for (let c = 0; c < t.cols; c++) {
        const mc = col + c;
        if (mc < 0 || mc >= m.cols) continue;
        const baseTile = t.tiles[r][c];
        const overTile = t.overlay?.[r]?.[c] ?? -1;
        if (baseTile >= 0) m.tileMap[mr][mc] = baseTile;
        if (overTile >= 0) m.overlayMap[mr][mc] = overTile;
        painted++;
      }
    }
    return { message: `Stamped "${t.name}" at (${row},${col}) — ${painted} cell(s) touched` };
  });

tool('room_outline', `Paint a rectangular room using the bundled tileset's wall-run pieces: a north wall (corner, repeated wall segments, corner) along the top edge, with a floor fill underneath. This tileset only draws the north-facing wall of a room (the usual top-down-RPG convention — side/south walls aren't drawn so they don't block the view), so this paints exactly that, nothing more. It's the right way to make a "wall" or "building interior" read correctly — a single wall tile placed alone (tile_paint with a 'wall'-role tile) does not look like a wall.`,
  {
    mapId: z.string(),
    row: z.number().int().describe('Row of the top wall.'),
    col: z.number().int().describe('Column of the top-left corner.'),
    width: z.number().int().min(3).describe('Total width in tiles, corners included.'),
    height: z.number().int().min(2).describe('Total height in tiles, wall row included.'),
    doorCol: z.number().int().optional().describe('Column offset (0-based from the left corner) in the top wall to leave open as a doorway. Must be strictly between the two corners.'),
    floorTileId: z.number().int().optional().describe('Defaults to FLOOR_A. Pass a tile id from tile_catalog_by_role({role:"terrain"}) for a different look.'),
  },
  ({ mapId, row, col, width, height, doorCol, floorTileId }) => {
    const m = findMap(mapId);
    const kit = tileCatalog.ROOM_KIT;
    const floor = floorTileId ?? kit.floorVariants[0];
    if (doorCol !== undefined && (doorCol <= 0 || doorCol >= width - 1)) {
      throw new Error(`doorCol must be strictly between the corners (1..${width - 2})`);
    }
    let painted = 0;
    for (let dr = 0; dr < height; dr++) {
      const mr = row + dr;
      if (mr < 0 || mr >= m.rows) continue;
      for (let dc = 0; dc < width; dc++) {
        const mc = col + dc;
        if (mc < 0 || mc >= m.cols) continue;
        let tileId;
        if (dr === 0) {
          if (dc === doorCol) tileId = kit.door;
          else if (dc === 0) tileId = kit.cornerTL;
          else if (dc === width - 1) tileId = kit.cornerTR;
          else tileId = kit.wallVariants[dc % kit.wallVariants.length];
        } else {
          tileId = floor;
        }
        m.tileMap[mr][mc] = tileId;
        painted++;
      }
    }
    ensureTileTables(Math.max(kit.cornerTL, kit.cornerTR, ...kit.wallVariants, kit.door, floor));
    return { message: `Painted ${width}x${height} room outline at (${row},${col}) — ${painted} cell(s)`, doorAt: doorCol !== undefined ? { row, col: col + doorCol } : null };
  });

// Single-step-per-cell digital line: always moves exactly one row OR one col at a
// time (never both), so consecutive cells are always 4-connected — no diagonal gaps.
function connectedLine(r0, c0, r1, c1) {
  const pts = [[r0, c0]];
  let r = r0, c = c0;
  while (r !== r1 || c !== c1) {
    const dr = r1 - r, dc = c1 - c;
    if (Math.abs(dr) >= Math.abs(dc) && dr !== 0) r += Math.sign(dr);
    else if (dc !== 0) c += Math.sign(dc);
    else r += Math.sign(dr);
    pts.push([r, c]);
  }
  return pts;
}

tool('path_between', `Paint a connected line of one tile (a road, a river segment, a fence run...) through a sequence of waypoints — the right way to make two places actually look connected, instead of two isolated tiles with nothing between them. Guarantees no gaps: every painted cell is 4-connected to the next. Use this for roads linking a spawn/house/exit to the rest of the map, and for rivers (with a 'terrain' water tileId) — a river or road that doesn't connect to anything reads as decoration, not infrastructure.`,
  {
    mapId: z.string(),
    layer: z.enum(['base', 'overlay']).default('base'),
    waypoints: z.array(z.object({ row: z.number().int(), col: z.number().int() })).min(2).describe('The line passes through every waypoint in order — pass just [from, to] for a simple direct connector, or more points for a river/road that bends.'),
    tileId: z.number().int(),
    width: z.number().int().min(1).max(5).default(1).describe('Line thickness — paints a (2*floor(width/2)+1)-wide square brush centered on each line cell. Use >1 for a wider river.'),
  },
  ({ mapId, layer, waypoints, tileId, width }) => {
    const m = findMap(mapId);
    const grid = layer === 'overlay' ? m.overlayMap : m.tileMap;
    const radius = Math.floor((width - 1) / 2);
    const cells = new Set();
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i], b = waypoints[i + 1];
      for (const [r, c] of connectedLine(a.row, a.col, b.row, b.col)) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) cells.add(`${r + dr},${c + dc}`);
        }
      }
    }
    let painted = 0;
    for (const key of cells) {
      const [r, c] = key.split(',').map(Number);
      if (r < 0 || r >= m.rows || c < 0 || c >= m.cols) continue;
      grid[r][c] = tileId;
      painted++;
    }
    if (tileId >= 0) ensureTileTables(tileId);
    return { message: `Painted a connected path through ${waypoints.length} waypoint(s) — ${painted} cell(s)` };
  });

tool('scatter_area', `Scatter copies of one or more tiles across a rectangular area with randomized positions and a minimum spacing — the right way to build a forest, a boulder field, a flower patch, or any "natural" cluster, instead of a hand-placed grid (which reads as planted/artificial) or a single repeated tile (which reads as one object, not a region). Pass several tileIds (e.g. multiple TREE_* variants) for visual variety.`,
  {
    mapId: z.string(),
    layer: z.enum(['base', 'overlay']).default('base'),
    rowStart: z.number().int(), colStart: z.number().int(),
    rowEnd: z.number().int(), colEnd: z.number().int(),
    tileIds: z.array(z.number().int()).min(1).describe('One tile id is placed per spot, chosen randomly from this list each time — pass several for variety (e.g. TREE_A/B/C/PINE ids for a mixed forest).'),
    count: z.number().int().positive().describe('How many to place. May place fewer if the area is too small/dense for the requested spacing.'),
    minSpacing: z.number().int().min(0).default(2).describe('Minimum distance (Chebyshev) kept between placed tiles. 0-1 = dense thicket, 3+ = sparse scatter.'),
    onlyOverBaseTileIds: z.array(z.number().int()).optional().describe('If given, only scatter onto cells whose current base tileMap value is one of these ids — e.g. restrict a forest to grass so it doesn\'t plant trees over a path or water.'),
  },
  ({ mapId, layer, rowStart, colStart, rowEnd, colEnd, tileIds, count, minSpacing, onlyOverBaseTileIds }) => {
    const m = findMap(mapId);
    const grid = layer === 'overlay' ? m.overlayMap : m.tileMap;
    const r0 = Math.max(0, Math.min(rowStart, rowEnd)), r1 = Math.min(m.rows - 1, Math.max(rowStart, rowEnd));
    const c0 = Math.max(0, Math.min(colStart, colEnd)), c1 = Math.min(m.cols - 1, Math.max(colStart, colEnd));
    const placed = [];
    const maxAttempts = count * 30;
    let attempts = 0;
    while (placed.length < count && attempts < maxAttempts) {
      attempts++;
      const r = r0 + Math.floor(Math.random() * (r1 - r0 + 1));
      const c = c0 + Math.floor(Math.random() * (c1 - c0 + 1));
      if (onlyOverBaseTileIds && !onlyOverBaseTileIds.includes(m.tileMap[r][c])) continue;
      if (placed.some(p => Math.max(Math.abs(p.row - r), Math.abs(p.col - c)) < minSpacing)) continue;
      const tileId = tileIds[Math.floor(Math.random() * tileIds.length)];
      grid[r][c] = tileId;
      placed.push({ row: r, col: c, tileId });
    }
    for (const id of tileIds) if (id >= 0) ensureTileTables(id);
    return { message: `Placed ${placed.length}/${count} tile(s)${placed.length < count ? ' (area too small/dense for the rest)' : ''}`, placed };
  });

// ── Boot ─────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
