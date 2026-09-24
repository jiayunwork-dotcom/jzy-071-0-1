import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMesh,
  solve,
  SingularMatrixError,
  defaultMaterial,
  templateLoops,
  type Material,
  type FiniteElementModel,
} from "../index.js";

const steel: Material = defaultMaterial("stress");

function cantileverMesh(h: number) {
  const loops = templateLoops({ kind: "rectangle", length: 2, height: 0.4 });
  return generateMesh({ loops, seedSize: h, smoothing: 20 });
}

test("无约束整体刚度奇异：抛出含刚体模态提示的 SingularMatrixError", () => {
  const { mesh } = cantileverMesh(0.08);
  const model: FiniteElementModel = {
    mesh,
    material: steel,
    supports: [],
    loads: [{ node: mesh.nodes.length - 1, fx: 100, fy: 0 }],
  };
  assert.throws(
    () => solve(model),
    (err: unknown) => {
      assert.ok(err instanceof SingularMatrixError);
      assert.ok(err.unstableNodes.length > 0, "应给出不稳定节点");
      assert.ok(err.rigidBodyModes.length >= 1, "应提示刚体模态");
      return true;
    }
  );
});

test("仅约束 x 方向（滚子）仍应因 y 平移/转动而奇异", () => {
  const { mesh } = cantileverMesh(0.08);
  // 全部左端节点只约束 ux（rollerY：只能沿 y 移动）
  const leftNodes = mesh.nodes.filter((p) => Math.abs(p[0]) < 1e-9);
  const model: FiniteElementModel = {
    mesh,
    material: steel,
    supports: leftNodes.map((p) => ({
      node: mesh.nodes.indexOf(p),
      type: "rollerY" as const, // ux=0，可沿 y 滑
    })),
    loads: [{ node: 10, fx: 0, fy: -1000 }],
  };
  assert.throws(() => solve(model), SingularMatrixError);
});

test("约束足够时可解，且位移关于载荷线性（放大 k 倍位移与应力等比放大）", () => {
  const { mesh } = cantileverMesh(0.08);
  const leftNodes = mesh.nodes
    .map((p, i) => ({ p, i }))
    .filter((o) => Math.abs(o.p[0]) < 1e-9);
  const tip = mesh.nodes.reduce(
    (best, p, i) =>
      p[0] > best.p[0] - 1e-9 && Math.abs(p[1] - 0.2) < Math.abs(mesh.nodes[best.i][1] - 0.2)
        ? { p, i }
        : best,
    { p: mesh.nodes[0], i: 0 }
  ).i;

  const mk = (P: number) =>
    solve({
      mesh,
      material: steel,
      supports: leftNodes.map((o) => ({ node: o.i, type: "fixed" as const })),
      loads: [{ node: tip, fx: 0, fy: -P }],
    });

  const r1 = mk(5000);
  const k = 3.7;
  const r2 = mk(5000 * k);

  const rel = (a: number, b: number) => Math.abs(a - b * k) / (Math.abs(a) + 1e-30);
  assert.ok(rel(r2.maxDisplacement.value, r1.maxDisplacement.value) < 1e-7, "位移未等比放大");
  assert.ok(rel(r2.maxVonMises.value, r1.maxVonMises.value) < 1e-7, "应力未等比放大");
  // 位移方向应向下
  assert.ok(r1.displacements[tip][1] < 0, "端部应向下挠曲");
});

test("同一模型平面应力与平面应变位移不同", () => {
  const { mesh } = cantileverMesh(0.08);
  const leftNodes = mesh.nodes
    .map((p, i) => ({ p, i }))
    .filter((o) => Math.abs(o.p[0]) < 1e-9);
  const tip = mesh.nodes.reduce(
    (best, p, i) =>
      p[0] > best.p[0] - 1e-9 && Math.abs(p[1] - 0.2) < Math.abs(mesh.nodes[best.i][1] - 0.2)
        ? { p, i }
        : best,
    { p: mesh.nodes[0], i: 0 }
  ).i;
  const base = {
    mesh,
    supports: leftNodes.map((o) => ({ node: o.i, type: "fixed" as const })),
    loads: [{ node: tip, fx: 0, fy: -8000 }],
  };
  const rs = solve({ ...base, material: { ...steel, mode: "stress" } });
  const rn = solve({ ...base, material: { ...steel, mode: "strain" } });
  // 平面应变更刚（ν=0.3 时等效模量更大），挠度更小
  assert.notEqual(rs.maxDisplacement.value, rn.maxDisplacement.value);
  assert.ok(rn.maxDisplacement.value < rs.maxDisplacement.value,
    "平面应变应比平面应力更刚");
  const relDiff = Math.abs(rs.maxDisplacement.value - rn.maxDisplacement.value) / rs.maxDisplacement.value;
  assert.ok(relDiff > 0.05, `两种假设差异过小：${relDiff}`);
});

test("体力（重力）作用下整体竖直反力与重力平衡", () => {
  const loops = templateLoops({ kind: "rectangle", length: 1, height: 1 });
  const { mesh } = generateMesh({ loops, seedSize: 0.1 });
  const topNodes = mesh.nodes
    .map((p, i) => ({ p, i }))
    .filter((o) => Math.abs(o.p[1] - 1) < 1e-9);
  const rho_g = 9.81 * 7850; // 钢材重度 ~77 kN/m³
  const mat = { ...steel, thickness: 1 };
  const r = solve({
    mesh,
    material: mat,
    supports: topNodes.map((o) => ({ node: o.i, type: "fixed" as const })),
    loads: [],
    bodyForce: { bx: 0, by: -rho_g },
  });
  const totalRy = r.reactions.reduce((s, q) => s + q.fy, 0);
  const weight = rho_g * 1 * 1 * 1; // 1m³
  assert.ok(Math.abs(totalRy - weight) / weight < 0.02,
    `支座反力 ${totalRy} 与重力 ${weight} 不平衡`);
});
