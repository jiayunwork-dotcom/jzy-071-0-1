import type { Material, PlaneMode } from "./types.js";

/**
 * 平面问题本构矩阵 D（3×3），应力排列 [σx, σy, τxy]。
 *
 * 平面应力：
 *   D = E/(1-ν²) [1   ν    0    ]
 *                [ν   1    0    ]
 *                [0   0  (1-ν)/2]
 *
 * 平面应变（单位厚度，等价弹性常数 E'=E/(1-ν²), ν'=ν/(1-ν)）：
 *   D = E(1-ν)/((1+ν)(1-2ν)) [1, ν/(1-ν), 0 ... ; 0,0,(1-2ν)/(2(1-ν))]
 */
export function constitutiveMatrix(mat: Material): number[][] {
  const E = mat.youngsModulus;
  const nu = mat.poissonRatio;
  if (E <= 0) throw new Error("弹性模量 E 必须为正数");
  if (nu <= -1 || nu >= 0.5) {
    // 平面应变下 ν=0.5 不可压会奇异，平面应力允许接近但仍需 < 0.5
    throw new Error("泊松比 ν 必须在 (-1, 0.5) 范围内（平面应变下 0.5 会导致体积锁死）");
  }
  if (mat.mode === "stress") {
    const f = E / (1 - nu * nu);
    return [
      [f, f * nu, 0],
      [f * nu, f, 0],
      [0, 0, f * (1 - nu) / 2],
    ];
  }
  // 平面应变
  const f = (E * (1 - nu)) / ((1 + nu) * (1 - 2 * nu));
  const g = nu / (1 - nu);
  return [
    [f, f * g, 0],
    [f * g, f, 0],
    [0, 0, f * (1 - 2 * nu) / (2 * (1 - nu))],
  ];
}

export function defaultMaterial(mode: PlaneMode = "stress"): Material {
  return {
    youngsModulus: 210e9, // 钢材 210 GPa
    poissonRatio: 0.3,
    mode,
    thickness: 0.01, // 默认 1 cm 厚板
  };
}

/** 通用稠密矩阵 × 向量（m×n 乘 n 维） */
export function matVec(m: number[][], x: number[]): number[] {
  return m.map((row) => row.reduce((acc, mij, j) => acc + mij * x[j], 0));
}

/** 3×3 对称矩阵 × 3 维向量 */
export function matVec3(m: number[][], x: number[]): number[] {
  return matVec(m, x);
}
