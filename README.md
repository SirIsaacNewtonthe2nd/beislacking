# Gridrun

A browser time-trial racer built around block tracks and arcade driving physics. Race twelve campaign tracks for medals, play endless random tracks, chase your own ghost, watch an AI learn the fastest time on any track and race its ghost, and build your own tracks in the editor.

## Play

It's a static site with no build step. Serve the folder with any static server and open `index.html`:

```sh
npx http-server -c-1 -p 8080 .
# then open http://localhost:8080
```

It also works on GitHub Pages: point Pages at the repository root. three.js is included in `vendor/`, so the page loads no scripts from other sites.

## Security

The game uses no API keys, accounts or servers; it keeps best times, ghosts, tracks and settings in the browser's local storage.

- A Content-Security-Policy in `index.html` only runs scripts from the site itself and blocks all outgoing requests (`connect-src 'none'`), so injected code couldn't send data anywhere.
- Pasted share codes are reduced to known pieces, surfaces and numbers, and track names are only shown as text.
- `.gitignore` excludes `.env` and key files.

Don't put an API key in this or any static site: everything the browser downloads is public. Keys belong on a server. GitHub Pages serves all of a user's repositories from one origin (`<user>.github.io`), so those pages share local storage too.

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
  - Car: a 700 kg, ~900 kW high-downforce racer; a rigid body with a real inertia tensor, real gravity and conserved angular momentum. A wide track and low centre of mass keep it from tipping at its grip limit.
  - Suspension: four raycast corners with springs, separate bump and rebound damping, anti-roll bars and bump stops.
  - Tyres: each wheel spins on its own with a combined-slip, load-sensitive Pacejka-style model, so grip is shared between braking, driving and cornering. Weight transfer comes out of the physics.
  - Engine and gearbox: torque curve, rev limiter, engine braking, launch clutch, 7-speed automatic with reverse, and a limited-slip rear differential.
  - Brakes and aero: brakes with front bias; front and rear wing downforce (stalling beyond 3x the car's weight) and body drag. Downforce adds grip at speed and shortens jumps.
  - Driving aids (on by default, toggle in the menu): ABS, traction control, stability control (brakes a single front wheel) and speed-sensitive steering.
  - Rough figures: 0-100 km/h in 1.7 s, 0-200 km/h in 3.1 s, top speed about 400 km/h, 200-0 km/h in about 33 m, cornering grip of about 2 g at 40 km/h rising to about 6.8 g at 250 km/h.
  - Handling balance (front/rear tyre grip, anti-roll bars, aero split) lives in `SETUP` in `src/car.js`; `tools/handling.mjs` checks it for spins and can grid-search it.
- **Surfaces:** road, dirt (slides), ice (barely grips), grass (slow).
- **Effect pads:** engine off, no steering, and reset.
- **Pieces:** straights; tight, medium and wide turns; banked turns (they tilt about the centre line, so they need a level of height beneath them) and wall turns; slopes; jump ramps with a straight lip; gaps; air checkpoints; and a loop with clothoid entry and exit. The editor also has raise/lower tools to change the height of the next piece.
- **Random tracks:** the menu's Random track button lays out a new track (jumps, loops, turbos, banked and wall turns), has the bot drive it to set the author time, and starts the race. Save the ones you like to My tracks. `tools/gen.mjs` checks how often generated tracks can be finished.
- **AI driver:** press AI on a campaign card or saved track, or Watch the AI from the pause and finish screens. The AI drives with the same controls as you. Its policy is a racing line plus how hard to push each stretch, and it learns by trial and error (an evolution strategy): it starts with a tightened line at a few overall grip levels, then repeatedly changes a short stretch, drives it, and keeps the change if the lap gets faster. Attempts restart from a saved state just before the changed stretch and stop once they fall behind or rejoin the best run, so it gets through several attempts a second. Training runs in a Web Worker (or on the page if workers are blocked). Its best run replays as a purple ghost with its line drawn on the road, and **Race the AI** puts that ghost on the track with you. The AI's best run is saved per track, so it carries on from there next time. `tools/ai.mjs` trains it from the command line.
- **Feel:** skid marks, tyre smoke and dust, sparks off walls, a boost flame with a wider view, speed lines, camera shake on landings and crashes, air-time callouts, confetti for new medals, and sounds for wind, boosts, landings, crashes and scraping.
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
src/fx.js         skid marks, smoke, sparks, boost flame, speed lines
src/generator.js  random track generator
src/ai.js         AI driver: racing-line policy, driver and trainer
src/ai-worker.js  runs the trainer off the main thread
src/editor.js     track editor
src/main.js       app flow, HUD, finish screen
src/tracks.js     campaign tracks
tools/sim.mjs     headless bot run of every campaign track (`--write` stores author times)
tools/map.mjs     ASCII map of a track layout, to spot overlaps
tools/handling.mjs  skid-pad stability check and setup search
tools/gen.mjs     generates random tracks and drives them with the bot
tools/ai.mjs      trains the AI driver on a campaign track and prints its progress
vendor/           three.js r128 (MIT)
```

The physics modules have no browser dependencies, so `node tools/sim.mjs` drives every track headlessly and checks that each one can be finished.
