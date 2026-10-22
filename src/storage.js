// localStorage wrappers. Everything here is optional: if storage is blocked
// the game still runs, it just forgets records between visits.

const NS = 'gridrun.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch { return false; }
}
export function remove(key) {
  try { localStorage.removeItem(NS + key); } catch { /* ignore */ }
}

// A track's identity for records: campaign id, or a hash of its layout.
export function trackKey(track) {
  if (track.campaignId) return 'c' + track.campaignId;
  const s = JSON.stringify([track.start, track.laps, track.pieces.map((p) => [p.type, p.surf, p.walls])]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'u' + (h >>> 0).toString(36);
}

export const getPB = (key) => load('pb.' + key, null);
export const setPB = (key, rec) => save('pb.' + key, rec);
export const getSettings = () => ({ ghost: true, sound: true, camera: 0, ...load('settings', {}) });
export const setSettings = (s) => save('settings', s);
export const getUserTracks = () => load('tracks', []);
export const setUserTracks = (list) => save('tracks', list);

// Medal thresholds derived from an author time
export function medalsFor(author) {
  if (!author) return null;
  const up = (x, step) => Math.ceil(x / step - 1e-9) * step;
  return {
    author,
    gold: up(author * 1.08, 0.5),
    silver: up(author * 1.25, 1),
    bronze: up(author * 1.6, 1),
  };
}
export function medalOf(time, medals) {
  if (time == null || !medals) return null;
  if (time <= medals.author) return 'author';
  if (time <= medals.gold) return 'gold';
  if (time <= medals.silver) return 'silver';
  if (time <= medals.bronze) return 'bronze';
  return null;
}

export function fmtTime(t, sign = false) {
  if (t == null || !isFinite(t)) return '-:--.---';
  const neg = t < 0;
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  const ms = Math.floor((a * 1000 + 1e-6) % 1000);
  const body = (m ? m + ':' + String(s).padStart(2, '0') : String(s)) + '.' + String(ms).padStart(3, '0');
  return (neg ? '-' : sign ? '+' : '') + body;
}
