'use strict';
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');
const assert = require('assert');

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'index.js')],
  });
  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`Registered tools: ${tools.tools.length}`);
  assert(tools.tools.length > 30, 'expected 30+ tools');

  async function call(name, args) {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`${name} failed: ${res.content[0].text}`);
    return JSON.parse(res.content[0].text);
  }

  const newWorldRes = await call('world_new', { firstMapName: 'Overworld' });
  assert(newWorldRes.tileset, 'expected bundled Monochrome tileset to be embedded by default');
  const summary1 = await call('world_summary', {});
  const mapId = summary1.maps[0].id;
  console.log('map created:', mapId);
  assert.strictEqual(summary1.assets.tileset, true, 'expected assets.tileset to be set');

  const catalog = await call('tile_catalog_list', {});
  assert.strictEqual(catalog.length, 136);
  const wallHits = await call('tile_catalog_find', { query: 'wall' });
  assert(wallHits.length > 0);
  const grassA = await call('tile_name_to_id', { name: 'GRASS_A' });
  assert.strictEqual(grassA.id, 17);

  const raw0 = await call('world_get_raw', {});
  assert.strictEqual(raw0.typeTable[0], 2, 'WATER_A should default to WATER type (2), not flat GRASS');
  assert.strictEqual(raw0.customNames[17], 'GRASS_A');

  const map2 = await call('map_create', { name: 'Dungeon' });
  console.log('map2 created:', map2.id);
  assert.strictEqual(map2.cols, 64);
  assert.strictEqual(map2.rows, 64);

  await call('tile_fill_rect', { mapId, layer: 'base', rowStart: 0, colStart: 0, rowEnd: 63, colEnd: 63, tileId: 17 });
  await call('tiletype_set', { tileId: 17, type: 'GRASS' });
  await call('tile_paint', { mapId, layer: 'overlay', cells: [{ row: 5, col: 5, tileId: 4 }] });
  await call('tiletype_set', { tileId: 4, type: 'TREE' });

  const npc = await call('npc_add', {
    mapId, row: 10, col: 10, name: 'Old Man', tileId: 10,
    dialog: ['Hello traveler.', 'Watch out for goblins.'],
    patrol: { type: 'wander', radius: 3 },
  });
  console.log('npc created:', npc.id);

  const trigger = await call('trigger_add', {
    mapId, row: 3, col: 3, activation: 'walk', title: 'Intro', oneShot: true,
    events: [{ type: 'dialog', lines: ['Welcome!'] }, { type: 'setTimeOfDay', gameMinutes: 480 }],
  });
  console.log('trigger created:', trigger.id);

  const itmpl = await call('item_template_create', { name: 'Potion', tileId: 22, description: 'Heals you', pickup: 'auto' });
  await call('item_add', { mapId, row: 7, col: 7, name: 'Potion', tileId: 22, templateId: itmpl.id });

  const itmpl2 = await call('item_template_create', { name: 'Herb', tileId: 23 });
  await call('recipe_create', { inputs: [{ templateId: itmpl2.id, count: 2 }, { templateId: itmpl2.id, count: 1 }], output: { templateId: itmpl.id, count: 1 } });

  await call('exit_add', { mapId, fromRow: 0, fromCol: 0, toMapId: map2.id, toRow: 5, toCol: 5 });
  await call('music_track_add', { mapId, filename: 'theme.mp3' });

  const objTmpl = await call('object_template_create', {
    name: 'Small House', category: 'building', description: 'quick 4-tile house block for tests',
    rows: 2, cols: 2, tiles: [[10, 11], [12, 13]],
  });
  assert.strictEqual(objTmpl.category, 'building');
  assert.strictEqual(objTmpl.tileCount, 4);
  await call('object_stamp', { mapId, objectId: objTmpl.id, row: 20, col: 20 });

  const buildingTemplates = await call('object_template_find', { category: 'building' });
  assert.strictEqual(buildingTemplates.length, 1);
  assert.strictEqual(buildingTemplates[0].id, objTmpl.id);
  const furnitureTemplates = await call('object_template_find', { category: 'furniture' });
  assert.strictEqual(furnitureTemplates.length, 0);

  const guide = await call('structure_guide', {});
  assert(guide.concepts.some(c => c.concept === 'forest' && c.minTiles === 4));
  assert(guide.concepts.some(c => c.concept === 'tree' && c.minTiles === 1));

  // Tile roles + room outline helper
  const wallTiles = await call('tile_catalog_by_role', { role: 'wall' });
  assert(wallTiles.every(t => t.role === 'wall'));
  assert(wallTiles.some(t => t.name === 'WALL_CNR_TL'));
  const structureTiles = await call('tile_catalog_by_role', { role: 'structure' });
  assert(structureTiles.some(t => t.name === 'HOUSE_A'));
  const catalogWithRoles = await call('tile_catalog_list', {});
  assert(catalogWithRoles.every(t => typeof t.role === 'string'));

  const doorId = (await call('tile_name_to_id', { name: 'DOOR_A' })).id;
  const cornerTLId = (await call('tile_name_to_id', { name: 'WALL_CNR_TL' })).id;
  const floorAId = (await call('tile_name_to_id', { name: 'FLOOR_A' })).id;

  const room = await call('room_outline', { mapId, row: 30, col: 10, width: 6, height: 5, doorCol: 3 });
  console.log(room.message);
  const doorTileAfter = await call('tile_get', { mapId, row: 30, col: 13 });
  const cornerTileAfter = await call('tile_get', { mapId, row: 30, col: 10 });
  const floorTileAfter = await call('tile_get', { mapId, row: 32, col: 12 });
  assert.strictEqual(doorTileAfter.base, doorId);
  assert.strictEqual(cornerTileAfter.base, cornerTLId);
  assert.strictEqual(floorTileAfter.base, floorAId);

  // Pixel-level custom tile editing
  const blankTile = await call('tile_create_blank', { name: 'CustomSign' });
  await call('tile_pixel_paint', {
    tileId: blankTile.tileId,
    pixels: [{ x: 0, y: 0, color: '#ff0000' }, { x: 1, y: 0, color: '#00ff00' }],
  });
  await call('tile_pixel_fill', { tileId: blankTile.tileId, x: 8, y: 8, color: '#0000ffcc' });
  const readBack = await call('tile_pixels_get', { tileId: blankTile.tileId });
  assert.strictEqual(readBack.pixels[0][0], '#ff0000');
  assert.strictEqual(readBack.pixels[0][1], '#00ff00');
  assert.strictEqual(readBack.pixels[8][8], '#0000ffcc');
  assert.strictEqual(readBack.base, -1);

  const grid16 = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => null));
  grid16[15][15] = '#123456';
  await call('tile_pixels_set', { tileId: 5, pixels: grid16 });
  const t5 = await call('tile_pixels_get', { tileId: 5 });
  assert.strictEqual(t5.base, 5);
  assert.strictEqual(t5.pixels[15][15], '#123456');

  const dup = await call('tile_duplicate', { tileId: 5, name: 'Wall_Variant' });
  const dupPixels = await call('tile_pixels_get', { tileId: dup.newTileId });
  assert.strictEqual(dupPixels.pixels[15][15], '#123456');

  await call('tile_pixels_clear', { tileId: dup.newTileId });
  const cleared = await call('tile_pixels_get', { tileId: dup.newTileId });
  assert.strictEqual(cleared, null);

  const validation = await call('world_validate', {});
  console.log('validation:', validation);
  assert.strictEqual(validation.valid, true, 'expected world to validate cleanly');

  // Regression: a map whose grid isn't 64x64 must be flagged (editor.html hardcodes
  // MAP_ROWS/MAP_COLS=64 everywhere except object stamps — any other size breaks
  // switching/rendering/deleting in the editor UI).
  const fs = require('fs');
  const goodWorldPath = path.join(require('os').tmpdir(), 'mcp-smoke-good-world.json');
  const raw = await call('world_get_raw', {});
  fs.writeFileSync(goodWorldPath, JSON.stringify(raw)); // snapshot to restore after the regression check below

  const badWorldPath = path.join(require('os').tmpdir(), 'mcp-smoke-bad-world.json');
  const badWorld = JSON.parse(JSON.stringify(raw));
  badWorld.maps[0].tileMap = Array.from({ length: 44 }, () => new Array(44).fill(-1));
  badWorld.maps[0].overlayMap = Array.from({ length: 44 }, () => new Array(44).fill(-1));
  fs.writeFileSync(badWorldPath, JSON.stringify(badWorld));
  await call('world_load', { filePath: badWorldPath });
  const badValidation = await call('world_validate', {});
  assert.strictEqual(badValidation.valid, false);
  assert(badValidation.issues.some(i => i.includes('44x44')), 'expected dimension mismatch to be flagged');
  console.log('bad-dimension map correctly flagged:', badValidation.issues[0]);

  await call('world_load', { filePath: goodWorldPath }); // restore before final save/assertions

  const outPath = path.join(require('os').tmpdir(), 'mcp-smoke-world.json');
  const saveRes = await call('world_save', { filePath: outPath });
  console.log(saveRes.message);

  const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.strictEqual(written.maps.length, 2);
  assert.strictEqual(written.maps[0].npcs.length, 1);
  assert.strictEqual(written.maps[0].triggers.length, 1);
  assert.strictEqual(written.maps[0].items.length, 1);
  assert.strictEqual(written.maps[0].exits.length, 1);
  assert.strictEqual(written.maps[0].music.length, 1);
  assert.strictEqual(written.maps[0].tileMap.length, 64);
  assert.strictEqual(written.maps[0].tileMap[0].length, 64);
  assert.strictEqual(written.maps[0].tileMap[30][30], 17);
  assert.strictEqual(written.maps[0].overlayMap[5][5], 4);
  assert.strictEqual(written.recipes.length, 1);
  assert.strictEqual(written.objectTemplates.length, 1);
  assert.strictEqual(written.customTiles[String(blankTile.tileId)].pixels[0], 255); // R of #ff0000 at pixel (0,0)
  assert.strictEqual(written.customTiles['5'].base, 5);
  assert.strictEqual(written.customTiles[String(dup.newTileId)], undefined); // cleared
  assert(written.assets.tileset && written.assets.tileset.dataUrl.startsWith('data:image/png;base64,'));
  assert.strictEqual(written.sheet1TileCount, 136);

  console.log('ALL ASSERTIONS PASSED');
  await client.close();
  process.exit(0);
}

main().catch(err => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
