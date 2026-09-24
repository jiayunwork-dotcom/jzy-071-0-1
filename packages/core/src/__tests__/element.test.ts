import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildElement,
  constitutiveMatrix,
  defaultMaterial,
  type Material,
  type Vec2,
} from "../index.js";

// 一个任意（非等边）CCW 三角形
const nodes: Vec2[] = [
  [0, 0],
  [1.2, 0.1],
  [0.3, 0.9],
];

const mat: Material = { ...defaultMaterial("stress"), thickness: 0.02 };

test("单元刚度矩阵对称", () => {
  const ed = buildElement(nodes, [0, 1, 2], mat);
  const K = ed.Ke;
  assert.equal(K.length, 6);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      assert.ok(Math.abs(K[i][j] - K[j][i]) < 1e-6 * (1 + Math.abs(K[i][j])),
        `Ke[${i}][${j}] 不对称`);
    }
  }
});

test("单元刚度半正定：主元非负（无负特征值）", () => {
  // 高斯消元不交换，对角主元应全部 >= 0
  const ed = buildElement(nodes, [0, 1, 2], mat);
  const K = ed.Ke.map((r) => [...r]);
  const n = 6;
  for (let k = 0; k < n; k++) {
    assert.ok(K[k][k] >= -1e-6 * Math.abs(K[0][0] || 1), `主元 ${k} 为负`);
    for (let i = k + 1; i < n; i++) {
      const f = K[i][k] / (K[k][k] || 1);
      for (let j = k; j < n; j++) K[i][j] -= f * K[k][j];
    }
  }
});

/**
 * 刚体零能模式：Ke·u_rigid = 0。
 * 二维单元有 3 个刚体模态：
 *  - x 平移 (1,0,1,0,1,0)
 *  - y 平移 (0,1,0,1,0,1)
 *  - 绕原点小转动 θ：位移 (-θy, θx)，取 θ=1
 */
test("单元存在三个刚体零能模式（Ke·u=0）", () => {
  const ed = buildElement(nodes, [0, 1, 2], mat);
  const modes = [
    [1, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 1],
    nodes.flatMap((p) => [-p[1], p[0]]),
  ];
  const scale = Math.abs(ed.Ke[0][0]) || 1;
  for (const u of modes) {
    for (let i = 0; i < 6; i++) {
      let s = 0;
      for (let j = 0; j < 6; j++) s += ed.Ke[i][j] * u[j];
      assert.ok(Math.abs(s) < 1e-6 * scale, `刚体模态能量不为零（行 ${i} 残差 ${s}）`);
    }
  }
});

test("常应变单元对均匀应变产生正确的常应力", () => {
  // 单单元 + 强制位移 u = (εx·x, -ν·εx·y)（单向拉伸），应得 σx≈E·εx（平面应力）
  const ed = buildElement(nodes, [0, 1, 2], mat);
  const eps = 1e-4;
  const ue: number[] = [];
  for (const p of nodes) ue.push(eps * p[0], -mat.poissonRatio * eps * p[1]);
  const strain = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    strain[r] = ed.B[r].reduce((acc, b, k) => acc + b * ue[k], 0);
  }
  assert.ok(Math.abs(strain[0] - eps) < 1e-9, `εx=${strain[0]}`);
  assert.ok(Math.abs(strain[1] + mat.poissonRatio * eps) < 1e-9);
  assert.ok(Math.abs(strain[2]) < 1e-9);
});

test("平面应力与平面应变的 D 矩阵不同", () => {
  const Ds = constitutiveMatrix({ ...mat, mode: "stress" });
  const Dn = constitutiveMatrix({ ...mat, mode: "strain" });
  // 11 分量：E/(1-ν²) vs E(1-ν)/((1+ν)(1-2ν))
  assert.notEqual(Ds[0][0], Dn[0][0]);
  assert.ok(Dn[0][0] > Ds[0][0]); // 平面应变约束更刚
});
