# Chronicles of the Forgotten Realm — Pixel Game Editor

A self-contained, browser-based RPG world builder and game engine. No installation, no server, no dependencies — open `editor.html` to build your world, click **▶ Preview** to play it instantly.

---

## Files

| File | Purpose |
|---|---|
| `editor.html` | World builder — design maps, place NPCs, set triggers, add music |
| `game.html` | Game engine — loads and plays the world you built |
| `world.json` | Your saved world (exported from the editor) |
| `music/` | Folder for background music files (`.mp3`, `.ogg`, `.wav`) |

---

## Editor Features

### Multi-Map Worlds
- Create unlimited named maps in a single world file
- Rename, duplicate, or delete maps from the left sidebar
- Each map is a 64×64 tile grid
- Set a **player spawn point** per map with the Spawn tool

### Tile Painting
- Two tileset sheets supported simultaneously (Sheet 1 + Sheet 2)
- Paint tiles on the **base layer** or **overlay layer**
- Overlay tiles render on top of the base and can act as walls (type: Overlay Block)
- **Undo / Redo** for all paint operations
- Adjustable zoom (1× – 8×) and optional grid overlay
- **Minimap** for navigating large maps

### Custom Tile Editor
- Click any tile in the palette to open the **pixel editor**
- Draw custom pixel edits on top of any tile (16×16 canvas)
- Assign a **tint color** to recolor any tile
- Set the **tile type** (Grass, Path, Floor, Wall, Water, Tree, etc.) to control collision and passability

### NPCs
- Place NPCs anywhere on the map with the NPC tool
- Configure per NPC:
  - **Name** and **dialog lines** (multi-line, press [E] per line)
  - **Sprite tile** from the palette
  - **Portrait image** (upload any image for dialog close-ups)
  - **Patrol behavior**: None (stationary), Wander (random radius), Waypoint (fixed path)
  - **Waypoint editor** — click cells on the map to define a patrol route
  - **Schedule** — time-of-day slots that move NPCs between maps automatically
- **NPC Templates** — save reusable NPC presets (tile + portrait) and apply them when placing
- NPCs list under each active map in the sidebar with quick edit and delete

### Triggers
- Place triggers on any cell, activated by:
  - **Walk** — fires when the player steps on the cell
  - **Interact [E]** — fires when the player presses E on the cell
  - **Map Load** — fires automatically when the map is entered
- **One-shot** option — trigger fires only once per session
- Each trigger can chain multiple **events** in sequence:

| Event | What it does |
|---|---|
| Dialog | Shows a text box with configurable lines |
| Camera Pan | Smoothly moves the camera to a target cell and back |
| Tile Change | Replaces specific tiles on the map (e.g. open a door) |
| Set Time of Day | Jumps the game clock to a chosen hour |
| Transition to Map | Teleports the player to another map at a chosen cell |

### Map Exits
- Draw exit zones that automatically transport the player to another map
- Configure entry row/col on the destination map

### Items
- Place collectible items on the map
- Pickup mode: **[E] Interact** or **Auto** (walk over)
- **Item Templates** — define reusable items with name, description, tile, and pickup mode
- Picked-up items appear in the player's **inventory**

### Crafting Recipes
- Define recipes that combine inventory items into new items
- Accessible via the crafting menu in-game

### Background Music
- Add multiple music tracks per map from the **🎵 Music** section in the sidebar
- Tracks are referenced by filename — place audio files in a `music/` folder next to `game.html`
- In-editor **▶ preview** button for each track (works in the same session the file was added)
- On map load the game shuffles the track list and plays them in sequence, looping

### Export & Import
- **Save** — exports the entire world as `world.json`
- **Load** — imports a previously saved `world.json`
- **▶ Preview** — opens `game.html` in a new tab and instantly loads the current world (uses BroadcastChannel, no file size limit)

---

## Game Features

### World Loading
- Load any `world.json` via the **🌍 World** button (top-right corner)
- Supports worlds with multiple maps, custom tilesets, NPCs, triggers, items, and music

### Player
- **WASD** movement with smooth collision against walls and overlay blocks
- **[E]** to interact with NPCs and items
- **[I]** to open the inventory
- **[C]** to open the crafting menu

### NPC Behavior
- Stationary, Wander, and Waypoint patrol modes
- Waypoint NPCs follow a fixed route with configurable wait times between points
- Wander NPCs roam within a radius, finding passable tiles
- **Schedule system** — NPCs move between maps at configured times of day
- NPCs freeze during player-initiated conversations

### Dialog System
- Multi-line dialog with NPC name label and portrait image
- Press [E] or click to advance lines

### Camera
- Smooth camera follow with world boundary clamping
- **Camera Pan** events animate the camera to any tile and optionally return
- Camera pre-snaps to the pan start position during fade-in (no visual jump)

### Trigger & Event System
- Walk, interact, and map-load triggers all supported in the game
- Full event chain execution: dialog → camera pan → tile changes → map transitions

### Map Transitions
- Smooth **fade-to-black** transition when moving between maps via exits or trigger events
- Player spawns at the configured entry point on the new map

### Day / Night Cycle
- Real-time day/night cycle with color overlay (full day ≈ 17 real-time minutes)
- Set time of day via trigger events or the clock progresses naturally

### Background Music
- Per-map music that shuffles and cycles through all assigned tracks
- Smooth **fade out / fade in** when switching between maps
- Audio unlocks on first user interaction (browser autoplay policy compliant)

### Inventory & Crafting
- Collected items stored in inventory with name, tile icon, and description
- Craft new items from the crafting menu using defined recipes

### Combat (Demo Mode)
- Skeleton and goblin enemies with chase and attack AI
- Player HP with hurt invincibility frames and a death screen
- Victory screen when all enemies are defeated

### Particle Effects & Lighting
- Animated torch lights with glowing radial gradients
- Particle system for combat hits and other events
- Floating damage/text numbers

---

## Quick Start

1. Open **`editor.html`** in Chrome or Edge
2. Load a tileset: go to the **Assets** tab → upload your spritesheet PNG
3. Paint tiles, place NPCs, add triggers
4. Click **▶ Preview** to test in the game immediately
5. Click **Save** to export `world.json` when you're happy
6. To play the saved world: open `game.html`, click **🌍 World**, load `world.json`

### Adding Background Music
1. Create a `music/` folder next to `game.html` and `editor.html`
2. Place `.mp3` / `.ogg` / `.wav` files inside it
3. In the editor sidebar, expand the **🎵 Music** section for a map
4. Click **+ Add Track** and select the same file — the filename is stored in the world
5. The game will load the track from `music/<filename>` at runtime

---

## Browser Compatibility

Requires a modern Chromium-based browser (Chrome 90+, Edge 90+). Firefox is supported for the game; the editor's pixel editor and BroadcastChannel preview work best in Chrome/Edge.

---

## License

MIT
