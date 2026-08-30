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
- **Tile catalog**: `tile_catalog_list`, `tile_catalog_find`, `tile_catalog_by_role`, `tile_name_to_id` — look up bundled tile ids by name (`GRASS_A`, `TREE_PINE`, `WALL_GATE`, …) or by usage role instead of guessing integers
- **Maps**: `map_create` (always 64×64 — see [Other notes](#other-notes)), `map_list`, `map_get`, `map_rename`, `map_delete`, `map_duplicate`, `map_set_spawn`
- **Tiles**: `tile_paint`, `tile_fill_rect`, `tile_get`, `tiletype_set`, `tiletype_get`, `tile_tint_set`, `room_outline` (assembles a wall/corner/floor room instead of placing wall pieces one at a time)
- **Pixel-level tile editing**: `tile_pixels_set`, `tile_pixel_paint`, `tile_pixel_fill`, `tile_pixels_get`, `tile_pixels_clear`, `tile_duplicate`, `tile_create_blank`
- **NPCs**: `npc_add`, `npc_update`, `npc_delete`, `npc_list`, `npc_template_create`, `npc_template_list`, `npc_template_delete`
- **Triggers**: `trigger_add`, `trigger_update`, `trigger_delete`, `trigger_list` (event types: `dialog`, `cameraPan`, `tileChange`, `setTimeOfDay`, `transitionToMap`)
- **Items**: `item_add`, `item_update`, `item_delete`, `item_list`, `item_template_create`, `item_template_list`, `item_template_delete`
- **Exits**: `exit_add`, `exit_delete`, `exit_list`
- **Music**: `music_track_add`, `music_track_remove`, `music_list`
- **Recipes**: `recipe_create`, `recipe_list`, `recipe_delete`
- **Object stamps**: `object_template_create` (category/description/tileCount), `object_template_list`, `object_template_find`, `object_template_delete`, `object_stamp`
- **Structure guidance**: `structure_guide` — minimum-tile-count conventions for trees/forests/houses/rooms

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

### Not every tile is a complete object

This is the single most important thing to get right, and the easiest to get wrong: **some
bundled tiles are already a whole object, and some are one piece of a bigger structure that
only looks right once several are assembled together.** Placing a single `WALL_C` tile does
not give you "a wall" any more than placing a single brick gives you a house — it just looks
like a stray gray square. Every tile in the catalog has a `role` telling you which kind it is
(returned by `tile_catalog_list`/`find`/`by_role`):

| role | meaning | how to place it |
|---|---|---|
| `structure` | already a complete object (a whole tree, a whole little house — `HOUSE_A`..`HOUSE_F` are six *complete* building styles, not building parts) | one `tile_paint` call, done |
| `prop` | a complete single-tile decoration (chest, table, barrel, gravestone, a character sprite...) | one `tile_paint` call, done |
| `terrain` | seamless ground cover (grass, path, water, floor...) | `tile_fill_rect` over an area |
| `wall` | one PIECE of a wall run — plain segment, corner, pillar, window, arch, bars, gate | assemble into an outline, e.g. `room_outline`, or a custom layout via `object_template_create` + `object_stamp` — never place alone, never `tile_fill_rect` |
| `door` | a doorway insert placed where a wall run has a gap | goes in the wall row itself (see `room_outline`'s `doorCol`) |
| `linear` | placed as a repeated line, not a fill and not a standalone object (fence, bridge, railing) | a row of `tile_paint` calls along the boundary |
| `icon` | a small UI/decorative glyph (heart, cross, sparkle) | rarely what you want as actual map scenery |

For the common case — a room or building interior — call `room_outline` instead of hand-placing
wall pieces: it paints a correct corner+wall top edge with a floor fill beneath, which is the
convention this tileset actually draws (only the north-facing wall — top-down RPGs traditionally
leave south/side walls undrawn so they don't block the view of what's inside). For anything more
elaborate (a custom room shape, a specific prop layout), build it once with `object_template_create`
from tiles picked via `tile_catalog_by_role`, then reuse it anywhere with `object_stamp`.

### How many tiles does "a house" need?

It depends which house you mean, and that's exactly the point — call `structure_guide` before
placing scenery for a rule of thumb per concept (a tree is 1 tile; a forest patch wants 4+; a
plain background house is 1 `structure`-role tile; a large, detailed building is a hand-built
multi-tile composite with no single correct answer). The important habit this is meant to build:

1. Check `object_template_find({ category: "building" })` (or `"vegetation"`, etc.) before
   building something from scratch — it may already exist in this world.
2. If it doesn't, compose it from role-correct tiles (`tile_catalog_by_role`) and save it with
   `object_template_create`, passing `category` and a `description` that records *why* it's built
   the way it is (tile counts, which pieces go where) — that annotation is what makes it
   discoverable and reusable later, by you or another agent, instead of every session
   re-deriving the same layout (or worse, guessing tile ids that turn out wrong).
3. Reuse it anywhere with `object_stamp` instead of hand-placing the same tiles again.

This server doesn't ship a verified "large house" template — the exact roof/wall tile ids for a
detailed multi-tile building need a quick visual check in the editor (hover a palette tile to see
its name) before they're trustworthy to reuse. Build one, confirm it looks right, then register it
so it doesn't need re-deriving.

## Other notes

- Maps are always the editor's 64×64 grid. `map_create` no longer takes `cols`/`rows` —
  `editor.html` hardcodes `MAP_ROWS`/`MAP_COLS` = 64 in ~80 places and a map's own `cols`/`rows`
  fields are never read for the actual grid (only for multi-tile object stamps), so a
  different-sized map's `tileMap` doesn't match what the editor expects and breaks
  switching/rendering/deleting in the UI. `world_validate` flags any map that isn't 64×64 (e.g.
  from a hand-edited or foreign `world.json`) before you open it in the editor.
- Pixel-level tile edits (`tile_pixel_paint`/`tile_pixel_fill`/`tile_pixels_set`) write to
  the same `customTiles[id] = { base, pixels }` structure editor.html and game.html read
  directly — `base` is the sheet tile drawn underneath (-1 for none), `pixels` is a 16×16
  RGBA overlay drawn on top, matching the editor's pixel-editor semantics exactly.
