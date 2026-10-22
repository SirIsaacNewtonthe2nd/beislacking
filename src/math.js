// Small vector / quaternion helpers. Plain arrays [x, y, z] and [x, y, z, w]
// keep the physics code free of any rendering library so it also runs in Node.

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vclone = (a) => [a[0], a[1], a[2]];
export const vset = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
export const vcopy = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vaddScaled = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vlenSq = (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const vnorm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// In-place variants for hot loops
export const vaddi = (o, b) => { o[0] += b[0]; o[1] += b[1]; o[2] += b[2]; return o; };
export const vaddScaledi = (o, b, s) => { o[0] += b[0] * s; o[1] += b[1] * s; o[2] += b[2] * s; return o; };
export const vscalei = (o, s) => { o[0] *= s; o[1] *= s; o[2] *= s; return o; };

// Rotate vector v around unit axis k by angle a (Rodrigues)
export function vrotAxis(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = vcross(k, v);
  const d = vdot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * d,
    v[1] * c + kv[1] * s + k[1] * d,
    v[2] * c + kv[2] * s + k[2] * d,
  ];
}

// Quaternions [x, y, z, w]
export const qident = () => [0, 0, 0, 1];
export function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qfromAxisAngle(axis, a) {
  const s = Math.sin(a / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)];
}
export function qrot(q, v) {
  // v' = v + 2w(u×v) + 2u×(u×v)
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
// Build a quaternion from an orthonormal basis (right, up, forward) where the
// local axes are x = -right (three.js convention: facing +z, right is -x), y = up, z = forward.
export function qfromBasis(right, up, fwd) {
  const xAxis = [-right[0], -right[1], -right[2]];
  const m00 = xAxis[0], m01 = up[0], m02 = fwd[0];
  const m10 = xAxis[1], m11 = up[1], m12 = fwd[1];
  const m20 = xAxis[2], m21 = up[2], m22 = fwd[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qnorm(q);
}
export function qslerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (cos > 0.9995) {
    return qnorm([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  }
  const th = Math.acos(cos), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const approach = (x, target, step) => (x < target ? Math.min(x + step, target) : Math.max(x - step, target));
