import { writable, derived, get } from "svelte/store";
import type {
  Vec2,
  Mesh,
  MeshStats,
  Material,
  SolveResult,
  SupportType,
  Support,
  NodalLoad,
  BodyForce,
  ConvergencePoint,
} from "@fem2d/core";
import { defaultMaterial } from "@fem2d/core";
import { loopsBBox } from "./view";
import { api } from "./api";

/** 交互工具 */
export type Tool =
  | "draw"        // 点击添加多边形顶点
  | "drag"        // 拖动顶点
  | "fixed"
  | "rollerX"
  | "rollerY"
  | "load"
  | "inspect";    // 点选节点查看

export type StressField = "sx" | "sy" | "ty" | "vonMises";

export interface UiState {
  tool: Tool;
  /** 是否已有封闭多边形（绘制完成或模板） */
  loops: Vec2[][];
  /** 编辑中的外环（未闭合） */
  drawing: Vec2[];
  mesh: Mesh | null;
  meshStats: MeshStats | null;
  seedSize: number;
  material: Material;
  /** 以网格节点编号为键的边界条件 */
  supports: Support[];
  loads: NodalLoad[];
  bodyForce: BodyForce;
  useBodyForce: boolean;
  result: SolveResult | null;
  /** 云图字段 */
  field: StressField;
  /** 变形放大系数（0 = 自动） */
  deformationScale: number;
  autoDeformation: boolean;
  showMesh: boolean;
  showDeformed: boolean;
  showContour: boolean;
  showSymbols: boolean;
  selectedNode: number | null;
  convergence: ConvergencePoint[] | null;
  busy: string | null;
  error: string | null;
  /** 奇异诊断里被高亮的不稳定节点 */
  unstableNodes: number[];
  /** 当前载荷输入（用于新点选） */
  draftLoad: { fx: number; fy: number };
}

const initialMaterial = defaultMaterial("stress");

export const state = writable<UiState>({
  tool: "draw",
  loops: [],
  drawing: [],
  mesh: null,
  meshStats: null,
  seedSize: 0.1,
  material: initialMaterial,
  supports: [],
  loads: [],
  bodyForce: { bx: 0, by: -77000 },
  useBodyForce: false,
  result: null,
  field: "vonMises",
  deformationScale: 1,
  autoDeformation: true,
  showMesh: true,
  showDeformed: true,
  showContour: true,
  showSymbols: true,
  selectedNode: null,
  convergence: null,
  busy: null,
  error: null,
  unstableNodes: [],
  draftLoad: { fx: 0, fy: -10000 },
});

// ---- 派生：当前几何（编辑中或已闭合）----
export const activeLoops = derived(state, ($s) =>
  $s.drawing.length > 0 ? [$s.drawing] : $s.loops
);

export const domainBBox = derived(state, ($s) => {
  const all = $s.drawing.length > 0 ? [$s.drawing] : $s.loops;
  if (all.length === 0 || all[0].length === 0) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return loopsBBox(all);
});

export function update(patch: Partial<UiState>) {
  state.update((s) => ({ ...s, ...patch }));
}

/** 清除求解相关结果（网格/边界变化时调用） */
export function invalidateResult() {
  update({ result: null, convergence: null, unstableNodes: [], selectedNode: null });
}

// ---- 动作 ----
export async function generate(loopsArg?: Vec2[][]) {
  const $s = get(state);
  const loops = loopsArg ?? ($s.drawing.length >= 3 ? [$s.drawing] : $s.loops);
  if (loops.length === 0 || loops[0].length < 3) {
    update({ error: "请先勾勒封闭多边形（至少 3 个顶点）或选用模板" });
    return;
  }
  update({ busy: "mesh", error: null });
  try {
    const res = await api.mesh({ loops, seedSize: $s.seedSize, smoothing: 16 });
    update({
      loops,
      drawing: [],
      mesh: res.mesh,
      meshStats: res.stats,
      supports: [],
      loads: [],
      result: null,
      convergence: null,
      unstableNodes: [],
      selectedNode: null,
    });
  } catch (e) {
    update({ error: (e as Error).message });
  } finally {
    update({ busy: null });
  }
}

export async function runSolve() {
  const $s = get(state);
  if (!$s.mesh) {
    update({ error: "请先生成网格" });
    return;
  }
  update({ busy: "solve", error: null, unstableNodes: [] });
  try {
    const res = await api.solve({
      model: {
        mesh: $s.mesh,
        material: $s.material,
        supports: $s.supports,
        loads: $s.loads,
        bodyForce: $s.useBodyForce ? $s.bodyForce : undefined,
      },
    });
    update({ result: res.result, error: null });
  } catch (e) {
    const err = e as import("./api").ApiError;
    update({
      result: null,
      error: err.message,
      unstableNodes: err.details?.unstableNodes ?? [],
    });
  } finally {
    update({ busy: null });
  }
}

export async function runConvergence(seeds: number[]) {
  const $s = get(state);
  if ($s.loops.length === 0) {
    update({ error: "收敛研究需要先建立几何（建议从标准算例载入）" });
    return;
  }
  update({ busy: "convergence", error: null });
  try {
    // 把当前节点边界条件转回坐标锚点，以便在每个新网格上重新匹配
    const mesh = $s.mesh;
    if (!mesh) throw new Error("请先生成网格");
    const anchorsSupports = $s.supports.map((s) => {
      const p = mesh.nodes[s.node];
      return { x: p[0], y: p[1], type: s.type as SupportType };
    });
    const anchorLoads = $s.loads.map((l) => {
      const p = mesh.nodes[l.node];
      return { x: p[0], y: p[1], fx: l.fx, fy: l.fy };
    });
    const res = await api.convergence({
      loops: $s.loops,
      material: $s.material,
      seedSizes: seeds,
      supports: anchorsSupports,
      loads: anchorLoads,
      bodyForce: $s.useBodyForce ? $s.bodyForce : undefined,
    });
    update({ convergence: res.points });
  } catch (e) {
    update({ error: (e as Error).message });
  } finally {
    update({ busy: null });
  }
}

export function clearAll() {
  state.set({
    ...get(state),
    loops: [],
    drawing: [],
    mesh: null,
    meshStats: null,
    supports: [],
    loads: [],
    result: null,
    convergence: null,
    unstableNodes: [],
    selectedNode: null,
    error: null,
    tool: "draw",
  });
}

/** 在最近节点上施加当前工具对应的边界条件 */
export function applyToolAtNode(node: number) {
  const $s = get(state);
  const tool = $s.tool;
  if (tool === "fixed" || tool === "rollerX" || tool === "rollerY") {
    const others = $s.supports.filter((s) => s.node !== node);
    update({
      supports: [...others, { node, type: tool }],
      selectedNode: node,
    });
    invalidateResult();
  } else if (tool === "load") {
    const others = $s.loads.filter((l) => l.node !== node);
    update({
      loads: [...others, { node, fx: $s.draftLoad.fx, fy: $s.draftLoad.fy }],
      selectedNode: node,
    });
    invalidateResult();
  } else if (tool === "inspect") {
    update({ selectedNode: node });
  }
}

export function removeSupportAtNode(node: number) {
  state.update(($s) => ({
    ...$s,
    supports: $s.supports.filter((s) => s.node !== node),
  }));
  invalidateResult();
}
export function removeLoadAtNode(node: number) {
  state.update(($s) => ({
    ...$s,
    loads: $s.loads.filter((l) => l.node !== node),
  }));
  invalidateResult();
}
