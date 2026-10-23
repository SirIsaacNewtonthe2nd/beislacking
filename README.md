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
| ↓ / S | Brake; hold at a standstill to reverse |
| ← → / A D | Steer |
| In the air | Throttle lifts the nose, brake drops it (wheel inertia) |
| Enter | Respawn at the last checkpoint, keeping the speed you had there |
| Backspace | Restart |
| C, 1 2 3 | Camera |
| G / M | Ghost on/off, mute |
| Esc | Pause |

Gamepads work too: the stick steers, RT/A accelerates, LT/X brakes, B respawns. On touch screens, on-screen buttons appear.

## What's in it

- **Driving physics (SI units):**
  - Car: a 750 kg rigid body with a real inertia tensor, real gravity and conserved angular momentum.
  - Suspension: four raycast corners with springs, separate bump and rebound damping, anti-roll bars and bump stops.
  - Tyres: each wheel spins on its own with a combined-slip, load-sensitive Pacejka-style model, so grip is shared between braking, driving and cornering. Weight transfer comes out of the physics.
  - Engine and gearbox: torque curve, rev limiter, engine braking, launch clutch, 7-speed automatic with reverse, and a limited-slip rear differential.
  - Brakes and aero: brakes with front bias; front and rear wing downforce and body drag. Downforce adds grip at speed and shortens jumps.
  - Driving aids (on by default, toggle in the menu): ABS, traction control, stability control (brakes a single front wheel) and speed-sensitive steering.
  - Rough figures: 0-100 km/h in about 2 s, top speed about 300 km/h, 200-0 km/h in about 70 m, 1.5 g of cornering grip at low speed rising to 2.6 g at 250 km/h.
- **Surfaces:** road, dirt (slides), ice (barely grips), grass (slow).
- **Effect pads:** engine off, no steering, and reset.
- **Pieces:** straights; tight, medium and wide turns; banked turns (they tilt about the centre line, so they need a level of height beneath them) and wall turns; slopes; jump ramps with a straight lip; gaps; air checkpoints; and a loop with clothoid entry and exit. The editor also has raise/lower tools to change the height of the next piece.
- **Racing:** a countdown, a timer to the millisecond, checkpoint splits against your best run, multi-lap circuits, respawns, ghosts, and author/gold/silver/bronze medals.
- **Editor:** chain pieces from a start block, insert after any piece, change surfaces and borders, undo, and test drive. Your test-drive finish sets the author time. You can save tracks to the browser or share them as a code.

## Layout

```
index.html        page, HUD and menus
src/math.js       vectors and quaternions
src/pieces.js     piece catalogue and track layout on the block grid
src/geometry.js   collision triangles, render buffers, gates, bot line
src/collision.js  spatial hash, raycasts, sphere contacts
src/car.js        car physics: suspension, tyres, powertrain, aero, driver aids
src/race.js       timer, checkpoints, laps, respawn, ghost recording
src/bot.js        centreline driver used for testing and medal times (plans speeds from friction, load and downforce)
src/render.js     three.js scene, car model, cameras
src/editor.js     track editor
src/main.js       app flow, HUD, finish screen
src/tracks.js     campaign tracks
tools/sim.mjs     headless bot run of every campaign track (`--write` stores author times)
tools/map.mjs     ASCII map of a track layout, to spot overlaps
```

The physics modules have no browser dependencies, so `node tools/sim.mjs` drives every track headlessly and checks that each one can be finished.
