import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMesh,
  templateLoops,
  validateMesh,
  solve,
  defaultMaterial,
  getExample,
  convergenceStudy,
  instantiatePreset,
  type Vec2,
} from "../index.js";

test("矩形网格合法：无重叠、无悬挂、CCW、统计量合理", () => {
  const loops = templateLoops({ kind: "rectangle", length: 2, height: 0.4 });
  const { mesh, stats } = generateMesh({ loops, seedSize: 0.1 });
  const v = validateMesh(mesh, loops);
  assert.ok(v.valid, v.errors.join("; "));
  assert.ok(stats.nodeCount > 10);
  assert.ok(stats.elementCount > 10);
  assert.ok(stats.minAngleDeg > 15, `最小角过小: ${stats.minAngleDeg}`);
  assert.ok(stats.maxAngleDeg < 160, `最大角过大: ${stats.maxAngleDeg}`);
  assert.ok(stats.avgQuality > 0.7, `平均质量过低: ${stats.avgQuality}`);
});

test("L 形（凹多边形）网格合法", () => {
  const loops = templateLoops({ kind: "lbeam", width: 1, thickness: 0.3 });
  const { mesh } = generateMesh({ loops, seedSize: 0.08 });
  const v = validateMesh(mesh, loops);
  assert.ok(v.valid, v.errors.join("; "));
  // 凹角附近至少有一个小角
  assert.ok(mesh.elements.length > 20);
});

test("带孔板（多连通域）网格合法，孔边界存在", () => {
  const loops = templateLoops({ kind: "holePlate", plateWidth: 1, plateHeight: 1, holeRadius: 0.15 });
  const { mesh } = generateMesh({ loops, seedSize: 0.07 });
  const v = validateMesh(mesh, loops);
  assert.ok(v.valid, v.errors.join("; "));
  // 孔周节点存在：有节点距圆心 ≈ r
  const onHole = mesh.nodes.filter(
    (p) => Math.abs(Math.hypot(p[0], p[1]) - 0.15) < 0.02
  );
  assert.ok(onHole.length >= 12, "圆孔边界节点不足");
  // 没有单元跨进孔内：所有单元质心到圆心距离 > r
  for (const t of mesh.elements) {
    const c: Vec2 = [
      (mesh.nodes[t[0]][0] + mesh.nodes[t[1]][0] + mesh.nodes[t[2]][0]) / 3,
      (mesh.nodes[t[0]][1] + mesh.nodes[t[1]][1] + mesh.nodes[t[2]][1]) / 3,
    ];
    assert.ok(Math.hypot(c[0], c[1]) > 0.15 - 1e-6, "有单元侵入孔内");
  }
});

test("网格加密时单元数显著增加、最小角保持可接受", () => {
  const loops = templateLoops({ kind: "rectangle", length: 1, height: 0.5 });
  const c1 = generateMesh({ loops, seedSize: 0.15 });
  const c2 = generateMesh({ loops, seedSize: 0.05 });
  assert.ok(c2.stats.elementCount > 2.5 * c1.stats.elementCount);
  assert.ok(c2.stats.minAngleDeg > 15);
});

test("自定义不规则四边形网格合法", () => {
  const loops: Vec2[][] = [
    [
      [0, 0],
      [1.5, 0.1],
      [1.2, 0.8],
      [0.2, 1.0],
    ],
  ];
  const { mesh } = generateMesh({ loops, seedSize: 0.12 });
  assert.ok(validateMesh(mesh, loops).valid);
});

test("悬臂梁：网格足够细时最大挠度与梁理论解偏差 < 15%", () => {
  const ex = getExample("cantilever")!;
  const { model } = instantiatePreset(ex, 0.02);
  const r = solve(model);
  // 端部中点（严格在 x=L 上，取最接近中高的节点）y 位移
  const L = (ex.template.length as number);
  const H = (ex.template.height as number);
  let tip = -1, bd = Infinity;
  model.mesh.nodes.forEach((p, i) => {
    if (Math.abs(p[0] - L) > 1e-9) return;
    const d = Math.abs(p[1] - H / 2);
    if (d < bd) { bd = d; tip = i; }
  });
  const delta = -r.displacements[tip][1];
  const theory = ex.reference.tipDeflection!.value;
  const ratio = delta / theory;
  assert.ok(
    ratio > 0.80 && ratio < 1.15,
    `端部挠度 ${delta.toExponential(3)} 与理论 ${theory.toExponential(3)} 比值 ${ratio.toFixed(3)} 超出合理范围`
  );
  // 应力应在理论弯曲应力的合理带内
  const vm = r.maxVonMises.value;
  const sigmaTh = ex.reference.maxBendingStress!.value;
  assert.ok(vm > 0.65 * sigmaTh && vm < 1.8 * sigmaTh,
    `最大应力 ${vm.toExponential(2)} 偏离理论 ${sigmaTh.toExponential(2)}`);
});

test("单向受拉板：内部 σx≈100 MPa（补丁试验）", () => {
  const ex = getExample("tension-plate")!;
  const { model } = instantiatePreset(ex, 0.1);
  const r = solve(model);
  const inner = r.elementStresses.filter((_, e) => {
    const t = model.mesh.elements[e];
    const cx = (model.mesh.nodes[t[0]][0] + model.mesh.nodes[t[1]][0] + model.mesh.nodes[t[2]][0]) / 3;
    return cx > 0.3 && cx < 0.8;
  });
  const mean = inner.reduce((s, x) => s + x.sx, 0) / inner.length;
  assert.ok(Math.abs(mean - 100e6) / 100e6 < 0.03, `内部平均 σx=${mean}`);
  const spread = Math.max(...inner.map((x) => Math.abs(x.sx - mean))) / 100e6;
  assert.ok(spread < 0.05, `σx 不均匀，偏差 ${spread}`);
  // 右端中点位移 ≈ σL/E（严格在右边缘 x=L 上选最接近中高的节点）
  const L = ex.template.length as number, H = ex.template.height as number;
  let tip = -1, bd = Infinity;
  model.mesh.nodes.forEach((p, i) => {
    if (Math.abs(p[0] - L) > 1e-9) return;
    const d = Math.abs(p[1] - H / 2);
    if (d < bd) { bd = d; tip = i; }
  });
  const d = r.displacements[tip][0];
  assert.ok(Math.abs(d - ex.reference.tipDeflection!.value) / ex.reference.tipDeflection!.value < 0.05);
});

test("网格无关性：加密序列上最大位移单调收敛、相邻结果趋稳", () => {
  const ex = getExample("cantilever")!;
  const loops = templateLoops(ex.template);
  const res = convergenceStudy({
    loops,
    material: ex.material,
    seedSizes: ex.convergenceSeeds,
    supports: ex.supports,
    loads: ex.loads,
    edgeSupports: ex.edgeSupports,
    edgeTractions: ex.edgeTractions,
  });
  assert.equal(res.points.length, ex.convergenceSeeds.length);
  // 最后两次位移相对变化 < 8%
  const d1 = res.points[res.points.length - 2].maxAbsDisplacement;
  const d2 = res.points[res.points.length - 1].maxAbsDisplacement;
  assert.ok(Math.abs(d2 - d1) / d2 < 0.08,
    `加密后位移变化 ${Math.abs(d2 - d1) / d2} 未趋稳`);
  // 单元数随加密单调增加
  for (let i = 1; i < res.points.length; i++) {
    assert.ok(res.points[i].elementCount > res.points[i - 1].elementCount);
  }
});

test("零面积/非法多边形给出明确报错而非崩溃", () => {
  assert.throws(() => generateMesh({ loops: [[[0, 0], [1, 1], [2, 2]]], seedSize: 0.1 }));
  assert.throws(() =>
    solve({
      mesh: { nodes: [[0, 0], [1, 0]] as Vec2[], elements: [], boundaryEdges: [] },
      material: defaultMaterial(),
      supports: [],
      loads: [],
    })
  );
});
