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

Controllers get rumble on hits, collapses and damage. The camera drifts in behind you while running if you are not using the right stick. With a controller, **aim assist** steers punches and throws toward the nearest helicopter, tank or soldier in front of the camera: jump (A) and punch (RT) to swat a low chopper. When you hold something, RT throws it at the assisted target, or toward the centre of the screen.

### On a building

Climbing is a full mode. Press **Y / C** next to any wall (or in mid-air, or at a roof edge to climb down).

| Action | Controller | Keyboard + mouse |
| --- | --- | --- |
| Climb up / down | Left stick ↑ / ↓ (LB to scramble faster) | W / S (Shift) |
| Traverse the facade, round corners | Left stick ← / → | A / D |
| Punch the wall at your height (aim higher/lower with the camera), or backhand a passing chopper | RT | Left mouse |
| Structural smash: tears out the floor you're hanging on | LT | Right mouse |
| Double kick into the floor below | B | F |
| Reach into a window and grab a person (or a hovering chopper), then eat | X | E |
| Leap off the wall (toward a chopper if one is in view) | A | Space |
| Let go | Y | C |
| Roar from the side of the tower | RB | Q |

You can stop and hang at any height. You haul yourself onto roofs and setback ledges when your hands run out of wall. Steering into a wall in mid-air grabs it again. If the wall you're holding is smashed or collapses, you slip, regrip or fall. People come to the windows near you, waving for help. Punch their window and they tumble out; reach in and they're a snack. Helicopters fly at your altitude in front of the facade and make close passes you can swat. Tanks can't elevate their guns high enough to reach you near the top of a tower.

## Goal

Destroy **60%** of the city before the military takes you down. Military response escalates with destruction and time: infantry first, then helicopters, then tanks, up to six levels. Eating civilians or soldiers restores health. Press restart at any time to start over instantly.

## Look

Daylight uses AgX tone mapping with a physically based sun, hemisphere light and sky environment. The sky shader is scaled into the same brightness range as the city, with drifting clouds. Half-resolution ground-truth ambient occlusion (GTAO) adds contact shadows. Bloom only fires on genuinely hot pixels (fire, explosions, tracers). A display-space grade adds saturation, contrast and a vignette. The facade shader controls sky reflection separately for glass and walls, so windows read as glass without flattening the walls. Tuning lives in `LOOK` in `src/render/Renderer.js`. Add `?ao=0` to the URL to turn the AO pass off.

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
* `?test=1` runs a deterministic mode: there is no animation loop, and time advances only through `window.__game.tick(frames)` / `renderOnce()`.
* `node tools/elevtest.mjs <outDir>` is the vertical play-test, driven by a virtual gamepad. It covers these steps: attach to a skyscraper, climb to the 10th floor, hold, traverse, punch a hole at that height (checking that only floors 9–11 break), grab and eat a person from a window, keep climbing, swat a helicopter, leap at another and punch it mid-air, re-grab the tower, climb onto the roof, and jump back down to the street. At every step it checks that the camera is not inside geometry, the gorilla is not occluded, and the camera is on the open side of the wall.
* `node tools/looktest.mjs <outDir>` renders fixed street, aerial, close-up and collapse viewpoints for lighting review.
* `node tools/padtest.mjs <outDir>` drives the game in test mode through a virtual gamepad in headless Chromium (needs the dev server running). It moves, sprints, turns the camera, punches, smashes, stomps, collapses a tower, eats, throws a car, swats a helicopter and pauses/restarts, printing game state after each step.
