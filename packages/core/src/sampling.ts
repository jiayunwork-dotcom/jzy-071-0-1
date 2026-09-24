import type { Mesh, SolveResult } from "./types.js";

export interface StressSample {
  sx: number;
  sy: number;
  ty: number;
  vonMises: number;
}

/**
 * 按单元质心落在矩形区域 [x0,x1]×[y0,y1] 内采样应力（CST 单元内应力为常数）。
 * 用于避开固定端角点、集中力作用点等应力奇异性，取「截面内部」的代表性应力。
 */
export function sampleStressInBox(
  mesh: Mesh,
  result: SolveResult,
  box: { x0: number; x1: number; y0: number; y1: number }
): StressSample[] {
  const out: StressSample[] = [];
  result.elementStresses.forEach((s, e) => {
    const t = mesh.elements[e];
    const cx = (mesh.nodes[t[0]][0] + mesh.nodes[t[1]][0] + mesh.nodes[t[2]][0]) / 3;
    const cy = (mesh.nodes[t[0]][1] + mesh.nodes[t[1]][1] + mesh.nodes[t[2]][1]) / 3;
    if (cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1) {
      out.push({ sx: s.sx, sy: s.sy, ty: s.ty, vonMises: s.vonMises });
    }
  });
  return out;
}

export function mean(samples: StressSample[], key: keyof StressSample): number {
  if (samples.length === 0) return NaN;
  return samples.reduce((s, x) => s + x[key], 0) / samples.length;
}

export function maxAbs(samples: StressSample[], key: keyof StressSample): number {
  return samples.reduce((m, x) => Math.max(m, Math.abs(x[key])), 0);
}
