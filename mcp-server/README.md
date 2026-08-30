# Pixel World Builder MCP Server

An MCP server that exposes the `world.json` data model used by `editor.html` / `game.html`
(from the parent [HTML5 Pixel Game Editor](../README.md)) as tools, so an agent can build
game worlds — maps, tiles, NPCs, triggers, items, exits, music, crafting recipes, and
multi-tile "object" stamps — without driving the editor UI.

The server holds one world in memory per process and mirrors exactly the JSON shape
`editor.html` saves/loads, so a file produced here opens directly in the editor and plays
directly in `game.html`.

## Install

```bash
npm install
```

## Run

The server speaks MCP over stdio. Point your MCP client at it, e.g. in Claude Code's
`.mcp.json`:

```json
{
  "mcpServers": {
    "pixel-world-builder": {
      "command": "node",
      "args": ["mcp-server/index.js"]
    }
  }
}
```

## Test

```bash
npm test
```

Runs `test/smoke.js`, which spins up the server over a real stdio transport, exercises
most tools (maps, tiles, NPCs, triggers, items, exits, music, recipes, object stamps),
validates the result, and asserts the saved `world.json` has the expected shape.

## Tool groups

- **World**: `world_new`, `world_load`, `world_save`, `world_summary`, `world_get_raw`, `world_validate`
- **Assets**: `asset_use_bundled` (embeds one of the tileset styles shipped in `asset/` — prefer this), `asset_set_tileset` (embeds any local PNG spritesheet)
- **Tile catalog**: `tile_catalog_list`, `tile_catalog_find`, `tile_name_to_id` — look up bundled tile ids by name (`GRASS_A`, `TREE_PINE`, `WALL_GATE`, …) instead of guessing integers
- **Maps**: `map_create`, `map_list`, `map_get`, `map_rename`, `map_delete`, `map_duplicate`, `map_set_spawn`
- **Tiles**: `tile_paint`, `tile_fill_rect`, `tile_get`, `tiletype_set`, `tiletype_get`, `tile_tint_set`
- **Pixel-level tile editing**: `tile_pixels_set`, `tile_pixel_paint`, `tile_pixel_fill`, `tile_pixels_get`, `tile_pixels_clear`, `tile_duplicate`, `tile_create_blank`
- **NPCs**: `npc_add`, `npc_update`, `npc_delete`, `npc_list`, `npc_template_create`, `npc_template_list`, `npc_template_delete`
- **Triggers**: `trigger_add`, `trigger_update`, `trigger_delete`, `trigger_list` (event types: `dialog`, `cameraPan`, `tileChange`, `setTimeOfDay`, `transitionToMap`)
- **Items**: `item_add`, `item_update`, `item_delete`, `item_list`, `item_template_create`, `item_template_list`, `item_template_delete`
- **Exits**: `exit_add`, `exit_delete`, `exit_list`
- **Music**: `music_track_add`, `music_track_remove`, `music_list`
- **Recipes**: `recipe_create`, `recipe_list`, `recipe_delete`
- **Object stamps**: `object_template_create`, `object_template_list`, `object_template_delete`, `object_stamp`

`world_validate` checks for dangling references (map ids in exits/transitions/schedules,
template ids in NPCs/items/recipes) so you can catch mistakes before opening the file in
the editor or game.

## Using tiles effectively

`world_new` embeds the bundled **Monochrome** tileset (`asset/Monochrome/Tilemap/tilemap_packed.png`,
136 tiles) by default, and seeds `typeTable`/`customNames` with the editor's real tile names
and collision defaults — so a fresh world is immediately playable and tile ids already mean
something, without any extra setup:

- `tile_catalog_find({ query: "wall" })` → find a tile by meaning instead of guessing a number
- `tile_name_to_id({ name: "PATH_A" })` → resolve a name to the id every other tool takes
- `game.html` can only render tiles from an *embedded* spritesheet (it has no bundled fallback
  of its own) — `world_new`'s default embed, or `asset_use_bundled`, takes care of that.

`asset_use_bundled` also accepts `Default` and `Dot Matrix`, which are the same 136-tile
layout in different art styles — the same ids and catalog names apply to all three. Pass
`bundledTileset: "none"` to `world_new` if you plan to call `asset_set_tileset` with your own
spritesheet instead (in which case the catalog/default types no longer apply, since they're
specific to the bundled layout).

## Other notes

- Maps default to the editor's 64×64 grid; pass `cols`/`rows` to `map_create` for other sizes.
- Pixel-level tile edits (`tile_pixel_paint`/`tile_pixel_fill`/`tile_pixels_set`) write to
  the same `customTiles[id] = { base, pixels }` structure editor.html and game.html read
  directly — `base` is the sheet tile drawn underneath (-1 for none), `pixels` is a 16×16
  RGBA overlay drawn on top, matching the editor's pixel-editor semantics exactly.
