import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEdgeTraction,
  applyEdgeSupport,
  nodesOnSegment,
} from "../boundary.js";
import { generateMesh } from "../mesher.js";
import { templateLoops } from "../templates.js";
import { solve } from "../fem.js";
import { defaultMaterial } from "../material.js";
import type { Mesh } from "../types.js";

function plateMesh(h = 0.1) {
  return generateMesh({ loops: templateLoops({ kind: "rectangle", length: 1, height: 0.5 }), seedSize: h }).mesh;
}

test("边线节点识别：找到右边缘全部节点且按弧长有序", () => {
  const mesh = plateMesh(0.12);
  const nodes = nodesOnSegment(mesh, [1, 0], [1, 0.5]);
  assert.ok(nodes.length >= 4, `右边缘节点过少: ${nodes.length}`);
  for (let i = 1; i < nodes.length; i++) {
    assert.ok(nodes[i].s > nodes[i - 1].s, "节点应按弧长严格递增");
    assert.ok(Math.abs(mesh.nodes[nodes[i].node][0] - 1) < 1e-9);
  }
});

test("边线均布力的合力等于 应力×厚度×边长", () => {
  const mesh = plateMesh(0.1);
  const loads = applyEdgeTraction(mesh, { ax: 1, ay: 0, bx: 1, by: 0.5, tx: 1e8, ty: 0 }, 0.01);
  const fx = loads.reduce((s, l) => s + l.fx, 0);
  const expected = 1e8 * 0.01 * 0.5; // σ·t·H = 500 kN
  assert.ok(Math.abs(fx - expected) / expected < 1e-9, `合力 ${fx} ≠ ${expected}`);
});

test("边线支座覆盖整条边（左边缘节点数正确）", () => {
  const mesh = plateMesh(0.13);
  const supports = applyEdgeSupport(mesh, { ax: 0, ay: 0, bx: 0, by: 0.5, type: "rollerY" });
  const leftCount = mesh.nodes.filter((p) => Math.abs(p[0]) < 1e-9).length;
  assert.equal(supports.length, leftCount);
  assert.ok(supports.every((s) => s.type === "rollerY"));
});

test("整边 ux=0 + 角点 uy=0 恰好约束刚体模态且可解", () => {
  const mesh: Mesh = plateMesh(0.12);
  const edgeSupports = applyEdgeSupport(mesh, { ax: 0, ay: 0, bx: 0, by: 0.5, type: "rollerY" });
  // node0 额外固定（其 ux 已被 rollerY 约束，fem 内部按自由度去重）
  const supports = [...edgeSupports, { node: 0, type: "fixed" as const }];
  const loads = applyEdgeTraction(mesh, { ax: 1, ay: 0, bx: 1, by: 0.5, tx: 1e8, ty: 0 }, 0.01);
  const mat = { ...defaultMaterial("stress"), thickness: 0.01 };
  const r = solve({ mesh, material: mat, supports, loads });
  assert.ok(r.maxDisplacement.value > 0);
  // 左边缘所有节点 ux=0；左下角 uy=0（其余可泊松收缩）
  mesh.nodes.forEach((p, i) => {
    if (Math.abs(p[0]) < 1e-9) {
      assert.ok(Math.abs(r.displacements[i][0]) < 1e-12, `左边节点 ${i} ux≠0`);
    }
  });
  assert.ok(Math.abs(r.displacements[0][1]) < 1e-12);
  // 固定自由度数 = 左边节点数（ux）+ 1（node0 的 uy）
  const leftCount = mesh.nodes.filter((p) => Math.abs(p[0]) < 1e-9).length;
  assert.equal(r.freeDofCount, 2 * mesh.nodes.length - (leftCount + 1));
});

test("同节点 rollerX+rollerY 合并为 fixed（mergeSupports 行为由 solve 间接验证）", () => {
  const mesh = plateMesh(0.2);
  // 两个矛盾滚子约束同一节点 -> 等价固定，不应报错
  const supports = [
    { node: 0, type: "fixed" as const },
    { node: 1, type: "rollerX" as const },
    { node: 1, type: "rollerY" as const },
  ];
  // 构造一个静定：node0 fixed，node1 双向滚子（实际 fixed）——对单点足够约束吗？需要第三个约束防转动
  // 加上节点 2 fixed 形成稳定支撑
  supports.push({ node: 2, type: "fixed" as const });
  const r = solve({
    mesh,
    material: defaultMaterial("stress"),
    supports,
    loads: [{ node: mesh.nodes.length - 1, fx: 100, fy: -100 }],
  });
  assert.ok(r.maxDisplacement.value > 0);
});
