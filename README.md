# City Smash

An arcade monster-destruction game in the browser. You are a 15-metre silverback gorilla loose in a living city: punch holes in skyscrapers, bring them down floor by floor, eat fleeing pedestrians to heal, and swat the helicopters, tanks and soldiers sent to stop you.

Built with **Three.js**, **Vite** and **Rapier** physics. Every asset is procedural: the gorilla is sculpted from signed-distance primitives at load time, buildings are shaded procedurally, and all sound is synthesised with WebAudio. There are no downloaded models, textures or audio files.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173) in a desktop Chrome, Edge or Firefox. Click **CLICK TO RAMPAGE**, or press **A / ✕** on a controller.

`npm run build` writes a static build to `dist/`.

## Controls

| Action | Controller (standard layout) | Keyboard + mouse |
| --- | --- | --- |
| Move (analog speed) | Left stick | WASD |
| Camera | Right stick (R3 recentres) | Mouse |
| Sprint | LB, or click L3 | Shift |
| Jump | A / ✕ | Space |
| Punch (combo) | RT | Left mouse |
| Heavy two-handed smash / ground slam (in the air) | LT | Right mouse |
| Ground stomp | B / ○ | F |
| Grab · eat · throw | X / □ | E |
| Climb / let go | Y / △ | C |
| Chest-beat roar (rage: +50% damage) | RB | Q |
| Pause | Start | Esc |
| Restart | Back / Select | R |

Controllers get rumble on hits, collapses and damage. The camera drifts in behind you while running if you are not using the right stick. When you hold something, RT throws it toward the centre of the screen.

## Goal

Destroy **60%** of the city before the military takes you down. Military response escalates with destruction and time: infantry first, then helicopters, then tanks, up to six levels. Eating civilians or soldiers restores health. Press restart at any time to start over instantly.

## How the destruction works

* **Cells.** Each building is a grid of storey-sized cells (4 m × 4 m × 4 m), drawn as one instanced mesh per building. A facade shader decides per pixel whether it is looking at original exterior (windows, brick, glass curtain wall, roof) or an interior surface exposed by damage (floor slabs, dark rooms, rebar). Per-cell damage drives cracks, soot and shattered windows. Fully enclosed cells are hidden, and only exposed cells get physics colliders.
* **Structure.** After damage, each floor's load-bearing ratio is compared with a threshold that rises with the weight above it. A failing floor detaches everything above it as a collapse section. The section sags, tilts toward the side whose supports are missing, then drops, crushing cells into debris, dust and rubble. Heavy sections pancake the floors below them, so smashing the base brings down the whole tower while smashing the top drops only the top. Unsupported islands also fall. Toppling sections can crash into neighbouring buildings.
* **Debris budget.** A few hundred pooled Rapier bodies handle the big chunks. When they settle they are baked into a static instanced rubble field that piles up and can be walked on. Glass shards and concrete chips are cheap CPU-integrated instanced pieces. Per-frame effect budgets keep big collapses smooth.

## Project layout

```
src/
  core/        Game loop, input (keyboard/mouse/gamepad), physics, camera, combat routing, thrown objects
  monster/     SDF sculpting + surface nets (sdf.js), gorilla model/skinning, procedural animation, controller
  world/       City layout, destructible Building, facade shader, street & roof props
  destruction/ Collapse sections, debris pool, rubble field
  city/        Pedestrians (instanced tiny humans), traffic
  enemies/     Military director, soldiers, tanks, helicopters, enemy fire
  fx/          Particles (dust/smoke/fire), glass & chips
  audio/       Procedural WebAudio sound design
  ui/          HUD
tools/         Dev tools: screenshot helper, virtual-gamepad play test
```

To add another monster, implement the same `update / damage / held` surface as `monster/Gorilla.js` and use `core/Combat.js` for attacks. New cities come from `world/City.js` layouts, and new enemy types plug into the `military` director's quotas.

## Dev tools

* `?low=1` uses smaller shadows and turns off bloom and MSAA (useful on weak GPUs).
* `?view=gorilla&poses=idle,walk:0.25,punch:0.45` opens a pose viewer for the gorilla rig.
* `node tools/padtest.mjs <outDir>` drives the game through a virtual gamepad in headless Chromium (needs the dev server running) and prints state after each step.
