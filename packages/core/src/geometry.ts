import type { Vec2 } from "./types.js";

export const v = (x: number, y: number): Vec2 => [x, y];

export function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function scale(a: Vec2, s: number): Vec2 {
  return [a[0] * s, a[1] * s];
}

/** 多边形有向面积：逆时针为正，顺时针为负 */
export function polygonArea(loop: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** 三角形（带符号）面积，CCW 为正 */
export function triArea(a: Vec2, b: Vec2, c: Vec2): number {
  return ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

/** 三角形内角（度），i 指定返回哪个顶点的角 */
export function triangleAngles(a: Vec2, b: Vec2, c: Vec2): [number, number, number] {
  const ang = (p: Vec2, q: Vec2, r: Vec2) => {
    const v1 = sub(q, p);
    const v2 = sub(r, p);
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  };
  return [ang(a, b, c), ang(b, a, c), ang(c, a, b)];
}

/**
 * 单元质量指标：4√3·A / (l1²+l2²+l3²)
 * 等边三角形为 1，退化单元趋近 0。
 */
export function triangleQuality(a: Vec2, b: Vec2, c: Vec2): number {
  const area = Math.abs(triArea(a, b, c));
  const l2 =
    distance(a, b) ** 2 + distance(b, c) ** 2 + distance(c, a) ** 2;
  if (l2 === 0) return 0;
  return (4 * Math.sqrt(3) * area) / l2;
}

/** 点在多边形内判定（射线法），含内环孔洞语义由调用方组合 */
export function pointInPolygon(p: Vec2, loop: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i][0], yi = loop[i][1];
    const xj = loop[j][0], yj = loop[j][1];
    const intersect =
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 点到线段的最近距离 */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const apx = p[0] - a[0], apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(apx - t * abx, apy - t * aby);
}

/**
 * 点是否在带孔洞的区域内：在某条环内部（按有向面积自动判定外环/内环）。
 * 外环应为 CCW（面积>0），内环 CW（面积<0）。
 */
export function pointInDomain(p: Vec2, loops: Vec2[][]): boolean {
  let inside = false;
  for (const loop of loops) {
    const area = polygonArea(loop);
    const inLoop = pointInPolygon(p, loop);
    if (area > 0) {
      // 外环
      if (inLoop) inside = true;
    } else {
      // 内环孔洞
      if (inLoop) inside = false;
    }
  }
  return inside;
}

/** 点到任意环边界的最小距离 */
export function distanceToBoundary(p: Vec2, loops: Vec2[][]): number {
  let min = Infinity;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      min = Math.min(min, pointSegmentDistance(p, loop[i], loop[(i + 1) % loop.length]));
    }
  }
  return min;
}

/** 包围盒 */
export function bbox(loops: Vec2[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}
