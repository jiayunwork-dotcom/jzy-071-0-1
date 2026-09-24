import type {
  AnchoredLoad,
  AnchoredSupport,
  EdgeSupport,
  EdgeTraction,
  FiniteElementModel,
  Material,
  Mesh,
  NodalLoad,
  Support,
  TemplateParams,
  Vec2,
} from "./types.js";
import { templateLoops } from "./templates.js";
import { generateMesh } from "./mesher.js";
import { applyEdgeSupport, applyEdgeTraction } from "./boundary.js";

/**
 * 内置可复现标准算例。锚点坐标与模板几何严格对应，
 * 网格重剖分后仍能自动匹配到同一物理位置的节点。
 */
export interface ExamplePreset {
  id: string;
  name: string;
  description: string;
  template: TemplateParams;
  loopsHint: Vec2[][];
  material: Material;
  supports: AnchoredSupport[];
  loads: AnchoredLoad[];
  /** 参考解的文字说明（用于界面展示） */
  reference: {
    /** 端部最大挠度公式与数值（m） */
    tipDeflection?: { formula: string; value: number };
    /** 固定端最大弯曲应力（Pa） */
    maxBendingStress?: { formula: string; value: number };
    /** 理论依据说明 */
    note: string;
  };
  /** 建议的网格种子（m），收敛研究序列 */
  convergenceSeeds: number[];
  /** 边线支座（网格无关，优先于锚点支座使用） */
  edgeSupports?: EdgeSupport[];
  /** 边线均布力（网格无关）；与锚点集中力叠加 */
  edgeTractions?: EdgeTraction[];
  /** 服务端展开后的几何环（前端直接用） */
  loops?: Vec2[][];
}

const steel = (thickness = 0.05): Material => ({
  youngsModulus: 210e9,
  poissonRatio: 0.3,
  mode: "stress",
  thickness,
});

/**
 * 算例 1：悬臂梁（端部集中力）
 *  L=2 m, H=0.4 m, t=0.05 m, P=10 kN（端部中点），左端全截面固定。
 *
 *  梁理论（Euler-Bernoulli，矩形截面）：
 *    I = t·H³/12,  δ = P·L³/(3·E·I)
 *    σ_max = M·c/I = (P·L)·(H/2)/I
 */
export function cantileverExample(): ExamplePreset {
  const L = 2, H = 0.4, t = 0.05, P = 10_000, E = 210e9;
  const I = (t * H ** 3) / 12;
  const delta = (P * L ** 3) / (3 * E * I);
  const sigmaMax = (P * L * (H / 2)) / I;
  return {
    id: "cantilever",
    name: "悬臂梁（端部集中力）",
    description:
      "左端全截面固定，右端中点施加向下 10 kN 集中力。与 Euler-Bernoulli 梁理论解对照，随网格加密位移与应力趋于理论值。",
    template: { kind: "rectangle", length: L, height: H },
    loopsHint: [],
    material: steel(t),
    supports: [
      { x: 0, y: 0, type: "fixed" },
      { x: 0, y: H / 2, type: "fixed" },
      { x: 0, y: H, type: "fixed" },
    ],
    loads: [{ x: L, y: H / 2, fx: 0, fy: -P }],
    edgeSupports: [{ ax: 0, ay: 0, bx: 0, by: H, type: "fixed" }],
    reference: {
      tipDeflection: {
        formula: "δ = P·L³/(3·E·I)，I=t·H³/12",
        value: delta,
      },
      maxBendingStress: {
        formula: "σ_max = P·L·(H/2)/I",
        value: sigmaMax,
      },
      note:
        "CST 单元模拟纯弯偏刚（剪切闭锁效应），粗网格位移偏小；网格加密后逐步逼近梁理论。固定端弯曲应力理论值 150 MPa（注意固定端角点存在约束应力集中，比较时取截面内部应力），端部挠度约 0.238 mm。",
    },
    convergenceSeeds: [0.1, 0.067, 0.05, 0.033, 0.025],
  };
}

/**
 * 算例 2：单向受拉矩形板（patch test / 均匀应力）
 *  1 m × 0.5 m × 0.01 m，右端 100 MPa 均布面力，左端固定。
 *  理论：远离固定端处 σx=100 MPa（常应力场），
 *  应变 εx=σ/E，端部伸长 ΔL=σ·L/E。
 *  这是常应变单元应当精确满足的“补丁试验”。
 */
export function tensionPlateExample(): ExamplePreset {
  const L = 1, H = 0.5, t = 0.01, sigma0 = 100e6, E = 210e9;
  return {
    id: "tension-plate",
    name: "单向受拉矩形板（均匀应力）",
    description:
      "右端施加 100 MPa 均布拉应力，左端全截面固定。远离端部全场 σx=100 MPa，右端位移 ΔL=σL/E≈0.476 mm。",
    template: { kind: "rectangle", length: L, height: H },
    loopsHint: [],
    material: steel(t),
    supports: [
      { x: 0, y: 0, type: "fixed" },
      { x: 0, y: H / 2, type: "fixed" },
      { x: 0, y: H, type: "fixed" },
    ],
    loads: [],
    // 补丁试验的标准约束：整条左边 ux=0（rollerY，可沿 y 滑移以允许泊松收缩），
    // 左下角再固定 uy，恰好消除 3 个刚体模态又不产生多余约束。
    edgeSupports: [
      { ax: 0, ay: 0, bx: 0, by: H, type: "rollerY" },
      { ax: 0, ay: 0, bx: 0, by: 0, type: "fixed" },
    ],
    edgeTractions: [{ ax: L, ay: 0, bx: L, by: H, tx: sigma0, ty: 0 }],
    reference: {
      tipDeflection: { formula: "ΔL = σ·L/E", value: (sigma0 * L) / E },
      maxBendingStress: { formula: "σx = F/A", value: sigma0 },
      note: "常应力场：CST 补丁试验，理论上远离固定端 σx 恒等于 100 MPa，适合核验内核正确性。",
    },
    convergenceSeeds: [0.1, 0.067, 0.05],
  };
}

export function allExamples(): ExamplePreset[] {
  return [cantileverExample(), tensionPlateExample()];
}

export function getExample(id: string): ExamplePreset | undefined {
  return allExamples().find((e) => e.id === id);
}

/**
 * 用指定种子网格实例化标准算例 → 可直接求解的有限元模型。
 * 边线支座/边线力会随网格自动匹配到边上所有节点。
 */
export function instantiatePreset(
  preset: ExamplePreset,
  seedSize: number
): { model: FiniteElementModel; mesh: Mesh } {
  const loops = templateLoops(preset.template);
  const { mesh } = generateMesh({ loops, seedSize, smoothing: 20 });
  const { supports, loads } = materializeBCs(preset, mesh);
  const model: FiniteElementModel = {
    mesh,
    material: preset.material,
    supports,
    loads,
  };
  return { model, mesh };
}

/**
 * 按一个已有网格把预设的边线/锚点边界条件实例化为节点支座与节点力。
 * 前端在反复改变种子重剖分时可直接复用，无需自行实现边线匹配。
 */
export function materializeBCs(
  preset: ExamplePreset,
  mesh: Mesh
): { supports: Support[]; loads: NodalLoad[] } {
  const supports: Support[] = [];
  if (preset.edgeSupports) {
    for (const es of preset.edgeSupports) supports.push(...applyEdgeSupport(mesh, es));
  } else {
    for (const a of preset.supports) {
      let best = 0, bd = Infinity;
      mesh.nodes.forEach((p, i) => {
        const d = Math.hypot(p[0] - a.x, p[1] - a.y);
        if (d < bd) { bd = d; best = i; }
      });
      supports.push({ node: best, type: a.type });
    }
  }

  const loads: NodalLoad[] = preset.loads.map((a) => {
    let best = 0, bd = Infinity;
    mesh.nodes.forEach((p, i) => {
      const d = Math.hypot(p[0] - a.x, p[1] - a.y);
      if (d < bd) { bd = d; best = i; }
    });
    return { node: best, fx: a.fx, fy: a.fy };
  });
  if (preset.edgeTractions) {
    for (const tr of preset.edgeTractions) {
      loads.push(...applyEdgeTraction(mesh, tr, preset.material.thickness));
    }
  }

  return { supports: mergeSupports(supports), loads: mergeLoads(loads) };
}

/** 同节点多个滚子（x、y 各一个）合并为 fixed；fixed 覆盖滚子 */
function mergeSupports(supports: Support[]): Support[] {
  const map = new Map<number, Set<Support["type"]>>();
  for (const s of supports) {
    if (!map.has(s.node)) map.set(s.node, new Set());
    map.get(s.node)!.add(s.type);
  }
  const out: Support[] = [];
  for (const [node, types] of map) {
    if (types.has("fixed") || (types.has("rollerX") && types.has("rollerY"))) {
      out.push({ node, type: "fixed" });
    } else if (types.has("rollerX")) {
      out.push({ node, type: "rollerX" });
    } else if (types.has("rollerY")) {
      out.push({ node, type: "rollerY" });
    }
  }
  return out;
}

function mergeLoads(loads: NodalLoad[]): NodalLoad[] {
  const map = new Map<number, NodalLoad>();
  for (const l of loads) {
    const cur = map.get(l.node) ?? { node: l.node, fx: 0, fy: 0 };
    cur.fx += l.fx; cur.fy += l.fy;
    map.set(l.node, cur);
  }
  return [...map.values()];
}
