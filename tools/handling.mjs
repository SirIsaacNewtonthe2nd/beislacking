// Handling checks on a flat skid pad.
//   node tools/handling.mjs current   full-lock and lift-off stability at several speeds
//   node tools/handling.mjs           grid-search the SETUP balance (front grip, anti-roll bars, aero split)
import { World } from '../src/collision.js';
import { Car, SETUP } from '../src/car.js';
import { SURF } from '../src/pieces.js';
import { vdot } from '../src/math.js';
const Y = 100, tris = [];
const quad = (x0, z0, x1, z1) => [
  { a: [x0, Y, z0], b: [x1, Y, z0], c: [x1, Y, z1], n: [0, 1, 0], surf: SURF.road, kind: 0 },
  { a: [x0, Y, z0], b: [x1, Y, z1], c: [x0, Y, z1], n: [0, 1, 0], surf: SURF.road, kind: 0 }];
for (let x = -600; x < 600; x += 100) for (let z = -600; z < 600; z += 100) tris.push(...quad(x, z, x + 100, z + 100));
const world = new World(tris);
// Full lock at a fixed speed; with liftOff the throttle snaps shut and the
// brake is stabbed mid-corner. A body slip over ~26 degrees counts as a spin.
function trial(kmh, liftOff) {
  const car = new Car(world); car.place([0, Y + 0.31, 0], [0, 0, 1], [0, 1, 0]);
  for (let i = 0; i < 400; i++) car.step({}, 1 / 200);
  car.v = [0, 0, kmh / 3.6]; car.wheels.forEach((w) => (w.omega = kmh / 3.6 / 0.34));
  let maxLat = 0, spun = false;
  for (let i = 0; i < 200 * 4; i++) {
    const sp = car.speed * 3.6;
    const th = liftOff && i > 400 ? 0 : sp < kmh ? 0.6 : 0;
    car.step({ steer: 1, throttle: th, brake: liftOff && i > 400 && i < 480 ? 1 : 0 }, 1 / 200);
    const b = car.basis();
    if (i > 300 && i < 400) maxLat = Math.max(maxLat, Math.abs(vdot(car.w, b.u)) * car.speed);
    if (Math.abs(Math.atan2(vdot(car.v, b.r), Math.abs(vdot(car.v, b.f)))) > 0.45) spun = true;
  }
  return { lat: maxLat / 9.81, spun };
}
const results = []; if (process.argv[2] === "current") { for (const kmh of [40, 80, 120, 160, 230, 300]) { const a = trial(kmh, false), b = trial(kmh, true); console.log(kmh, "km/h hold:", a.spun ? "SPUN" : "stable", " lift-off:", b.spun ? "SPUN" : "stable"); } process.exit(0); }
for (const fg of [1.0, 1.04, 1.08]) for (const arbF of [12000, 17000, 24000]) for (const arbR of [22000, 28000, 36000]) for (const wf of [1.85, 2.0]) {
  SETUP.axleGrip = [fg, 1]; SETUP.arb = [arbF, arbR]; SETUP.wingCla = [wf, 4.5 - wf];
  let score = 0, spins = 0;
  const lats = [];
  for (const kmh of [50, 100, 160, 230]) {
    const a = trial(kmh, false), b = trial(kmh, true);
    if (a.spun || b.spun) spins++;
    lats.push(a.lat.toFixed(2)); score += a.lat / Math.sqrt(kmh);
  }
  results.push({ fg, arbF, arbR, wf, spins, score, lats: lats.join(' ') });
}
results.sort((a, b) => a.spins - b.spins || b.score - a.score);
for (const r of results.slice(0, 12)) console.log(JSON.stringify(r));
