# Gridrun

A browser time-trial racer built around block tracks and arcade driving physics. Race eight campaign tracks for medals, chase your own ghost, and build your own tracks in the editor.

## Play

It's a static site with no build step. Serve the folder with any static server and open `index.html`:

```sh
npx http-server -c-1 -p 8080 .
# then open http://localhost:8080
```

It also works on GitHub Pages: point Pages at the repository root.

## Controls

| Key | Action |
| --- | --- |
| ↑ / W | Accelerate |
| ↓ / S | Brake, then reverse |
| ← → / A D | Steer (in the air: turn the car) |
| Brake + steer | Start a drift above ~80 km/h |
| Enter | Respawn at the last checkpoint, keeping the speed you had there |
| Backspace | Restart |
| C, 1 2 3 | Camera |
| G / M | Ghost on/off, mute |
| Esc | Pause |

Gamepads work too: the stick steers, RT/A accelerates, LT/X brakes, B respawns. On touch screens, on-screen buttons appear.

## What's in it

- **Driving:** a rigid-body car on four raycast springs (with bump stops) plus an arcade tyre model. It has very high grip, speed-dependent downforce, brake-to-drift, turbo and super-turbo pads, air control, and a 1000 km/h cap.
- **Surfaces:** road, dirt (slides), ice (barely grips), grass (slow).
- **Effect pads:** engine off, no steering, and reset.
- **Pieces:** straights; tight, medium and wide turns; banked turns and wall turns; slopes; kickers and gaps; air checkpoints; and a helical loop. The editor also has raise/lower tools to change the height of the next piece.
- **Racing:** a countdown, a timer to the millisecond, checkpoint splits against your best run, multi-lap circuits, respawns, ghosts, and author/gold/silver/bronze medals.
- **Editor:** chain pieces from a start block, insert after any piece, change surfaces and borders, undo, and test drive. Your test-drive finish sets the author time. You can save tracks to the browser or share them as a code.

## Layout

```
index.html        page, HUD and menus
src/math.js       vectors and quaternions
src/pieces.js     piece catalogue and track layout on the block grid
src/geometry.js   collision triangles, render buffers, gates, bot line
src/collision.js  spatial hash, raycasts, sphere contacts
src/car.js        car physics
src/race.js       timer, checkpoints, laps, respawn, ghost recording
src/bot.js        centreline driver used for testing and medal times
src/render.js     three.js scene, car model, cameras
src/editor.js     track editor
src/main.js       app flow, HUD, finish screen
src/tracks.js     campaign tracks
tools/sim.mjs     headless bot run of every campaign track (`--write` stores author times)
tools/map.mjs     ASCII map of a track layout, to spot overlaps
```

The physics modules have no browser dependencies, so `node tools/sim.mjs` drives every track headlessly and checks that each one can be finished.
