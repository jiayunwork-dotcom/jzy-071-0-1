import type { Vec2 } from "./types.js";
import { triArea } from "./geometry.js";
import { constitutiveMatrix, matVec3 } from "./material.js";
import type { Material } from "./types.js";

/**
 * 三节点线性三角形单元（CST, Constant Strain Triangle）。
 *
 * 形函数 Ni = (ai + bi·x + ci·y) / (2A)，其中
 *   b_i = yj - yk,  c_i = xk - xj（i,j,k 轮换）
 * 梯度 ∂Ni/∂x = bi/(2A)，∂Ni/∂y = ci/(2A)。
 *
 * 应变 ε = [εx, εy, γxy]ᵀ = B·u_e
 *   B = 1/(2A) [b1 0  b2 0  b3 0 ]
 *              [0  c1 0  c2 0  c3]
 *              [c1 b1 c2 b2 c3 b3]
 */
export interface ElementData {
  /** 单元面积（正值） */
  area: number;
  b: [number, number, number];
  c: [number, number, number];
  B: number[][]; // 3×6
  D: number[][]; // 3×3
  /** 单元刚度矩阵 6×6：Ke = t·A·Bᵀ·D·B */
  Ke: number[][];
  /** Ke/B 实际采用的节点编号（已保证 CCW），6 个行/列自由度对应此顺序 */
  nodeIds: number[];
}

function shapeGradCoeffs(p: Vec2[], ids: number[]) {
  // 节点顺序保证 CCW
  const [i, j, k] = ids;
  const xi = p[i][0], yi = p[i][1];
  const xj = p[j][0], yj = p[j][1];
  const xk = p[k][0], yk = p[k][1];
  const b: [number, number, number] = [yj - yk, yk - yi, yi - yj];
  const c: [number, number, number] = [xk - xj, xi - xk, xj - xi];
  const signedA = triArea(p[i], p[j], p[k]);
  return { b, c, area: Math.abs(signedA), ccw: signedA >= 0 };
}

export function buildB(
  b: [number, number, number],
  c: [number, number, number],
  twoA: number
): number[][] {
  const inv = 1 / twoA;
  return [
    [b[0] * inv, 0, b[1] * inv, 0, b[2] * inv, 0],
    [0, c[0] * inv, 0, c[1] * inv, 0, c[2] * inv],
    [c[0] * inv, b[0] * inv, c[1] * inv, b[1] * inv, c[2] * inv, b[2] * inv],
  ];
}

/** 构造单个单元的全部数据（B、D、Ke）。要求 conn 节点顺序为逆时针（CCW）。 */
export function buildElement(nodes: Vec2[], conn: number[], mat: Material): ElementData {
  const ids = [...conn];
  const s = triArea(nodes[ids[0]], nodes[ids[1]], nodes[ids[2]]);
  if (s === 0) throw new Error("存在零面积（退化）三角形单元，无法构造刚度");
  if (s < 0) throw new Error("单元节点必须按逆时针（CCW）顺序传入");

  const { b, c, area } = shapeGradCoeffs(nodes, ids);
  const B = buildB(b, c, 2 * area);
  const D = constitutiveMatrix(mat);

  // Ke = t·A·Bᵀ D B
  const DB = mul(D, B); // 3×6
  const BtDB = mulT(B, DB); // 6×6
  const Ke = BtDB.map((row) => row.map((x) => x * mat.thickness * area));

  return { area, b, c, B, D, Ke, nodeIds: ids };
}

function mul(a: number[][], b: number[][]): number[][] {
  const m = a.length, n = b[0].length, k = b.length;
  const r: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let p = 0; p < k; p++)
      if (a[i][p] !== 0)
        for (let j = 0; j < n; j++) r[i][j] += a[i][p] * b[p][j];
  return r;
}

/** Bᵀ(6×3) × (3×6) => 6×6，其中 B 为 3×6 */
function mulT(B: number[][], DB: number[][]): number[][] {
  const r: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let sum = 0;
      for (let p = 0; p < 3; p++) sum += B[p][i] * DB[p][j];
      r[i][j] = sum;
    }
  }
  return r;
}

/**
 * 体力 [bx, by]（N/m³）的等效节点力。
 * 常体力下由形函数精确积分，每个节点分得 t·A/3·[bx,by]。
 */
export function bodyForceLoad(area: number, thickness: number, bx: number, by: number): number[] {
  const q = (thickness * area) / 3;
  return [bx * q, by * q, bx * q, by * q, bx * q, by * q];
}

/** 由单元节点位移求应力 σ = D B u_e（CST 单元内为常数） */
export function elementStress(ed: ElementData, ue: number[]) {
  const strain = matVec3(ed.B, ue);
  const stress = matVec3(ed.D, strain);
  const [sx, sy, ty] = stress;
  // 平面问题 von Mises：sqrt(σx² - σxσy + σy² + 3τxy²)
  const vonMises = Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * ty * ty);
  return { sx, sy, ty, vonMises };
}
