import type {
  FiniteElementModel,
  SolveResult,
  Vec2,
  ElementStress,
  SingularMatrixError as TSing,
} from "./types.js";
import { SingularMatrixError } from "./types.js";
import { buildElement, bodyForceLoad, elementStress } from "./element.js";
import {
  createSparseMatrix,
  addBlock,
  ldltDecompose,
  buildStructure,
  solveLDL,
  SparseLdlError,
  type LDLResult,
} from "./solver-sparse.js";
import { rcmOrder, permuteMatrix } from "./ordering.js";

export { SingularMatrixError };

/**
 * 模型求解主流程：
 *  1. 逐单元构造 Ke
 *  2. 按全局自由度装配整体 K 与等效节点载荷 F
 *  3. 处理位移边界条件（固定/单向滑移），缩减自由度
 *  4. LDLᵀ 求解
 *  5. 恢复单元应力、节点平均应力、支座反力
 */
export function solve(model: FiniteElementModel): SolveResult {
  const { mesh, material, supports, loads, bodyForce } = model;
  const nn = mesh.nodes.length;
  const ndof = 2 * nn;

  // ---------- 1&2 装配 ----------
  // 网格单元已保证 CCW；Ke 的行/列顺序即 mesh.elements[e] 的节点顺序
  const Kfull = createSparseMatrix(ndof);
  const F = new Float64Array(ndof);
  const elementsData = mesh.elements.map((conn) => buildElement(mesh.nodes, conn, material));

  mesh.elements.forEach((conn, e) => {
    const dofs = [2 * conn[0], 2 * conn[0] + 1, 2 * conn[1], 2 * conn[1] + 1, 2 * conn[2], 2 * conn[2] + 1];
    addBlock(Kfull, dofs, elementsData[e].Ke);
    if (bodyForce) {
      const fe = bodyForceLoad(elementsData[e].area, material.thickness, bodyForce.bx, bodyForce.by);
      for (let i = 0; i < 6; i++) F[dofs[i]] += fe[i];
    }
  });

  for (const ld of loads) {
    F[2 * ld.node] += ld.fx;
    F[2 * ld.node + 1] += ld.fy;
  }

  // ---------- 3 边界条件 ----------
  // 约定：rollerX = 仅可沿 X 方向移动（约束 uy）；rollerY = 仅可沿 Y 方向移动（约束 ux）
  const fixed = new Set<number>();
  for (const s of supports) {
    if (s.node < 0 || s.node >= nn) throw new Error(`支座引用了不存在的节点 #${s.node}`);
    if (s.type === "fixed") {
      fixed.add(2 * s.node);
      fixed.add(2 * s.node + 1);
    } else if (s.type === "rollerX") {
      fixed.add(2 * s.node + 1);
    } else if (s.type === "rollerY") {
      fixed.add(2 * s.node);
    }
  }

  const free: number[] = [];
  const isFixed = new Uint8Array(ndof);
  for (const d of fixed) isFixed[d] = 1;
  for (let d = 0; d < ndof; d++) if (!isFixed[d]) free.push(d);
  const nf = free.length;

  if (nf === 0) {
    throw new SingularMatrixError("所有自由度都被约束，模型没有可求解的自由度");
  }

  // 缩减矩阵
  const Kr = createSparseMatrix(nf);
  const Fr = new Float64Array(nf);
  // 原自由度 -> 自由编号
  const freeIndex = new Int32Array(ndof).fill(-1);
  free.forEach((d, idx) => (freeIndex[d] = idx));

  for (let idx = 0; idx < nf; idx++) {
    const jd = free[idx];
    Fr[idx] = F[jd];
    // 上三角列 jd 中所有 i<=jd；只保留自由行
    for (const [id, val] of Kfull.cols[jd]) {
      if (isFixed[id]) continue;
      Kr.cols[idx].set(freeIndex[id], val);
    }
  }

  // ---------- 4 求解（RCM 排序 + LDLᵀ，带奇异诊断） ----------
  // 用 RCM 置换最小化带宽与填充；分解在排序后的矩阵上进行
  const rcm = rcmOrder(Kr);
  const Kp = permuteMatrix(Kr, rcm.inv);
  const Fp = new Float64Array(nf);
  for (let i = 0; i < nf; i++) Fp[rcm.inv[i]] = Fr[i];

  const structAdj = buildStructure(Kp);
  let ldl: LDLResult;
  try {
    ldl = ldltDecompose(Kp, structAdj, 1e-9);
  } catch (err) {
    if (err instanceof SparseLdlError) {
      throw diagnoseSingularity(model, Kfull, err);
    }
    throw err;
  }
  const up = solveLDL(ldl, Fp);
  const ur = new Float64Array(nf);
  for (let i = 0; i < nf; i++) ur[i] = up[rcm.inv[i]];

  // 展开回完整位移向量
  const U = new Float64Array(ndof);
  free.forEach((d, idx) => (U[d] = ur[idx]));

  // ---------- 5 应力恢复 ----------
  const elementStresses: ElementStress[] = elementsData.map((ed, e) => {
    const conn = mesh.elements[e];
    const ue = [U[2 * conn[0]], U[2 * conn[0] + 1], U[2 * conn[1]], U[2 * conn[1] + 1], U[2 * conn[2]], U[2 * conn[2] + 1]];
    return elementStress(ed, ue);
  });

  // 节点面积加权平均应力
  const nodalAcc = Array.from({ length: nn }, () => ({ sx: 0, sy: 0, ty: 0, w: 0 }));
  mesh.elements.forEach((conn, e) => {
    const a = elementsData[e].area;
    for (const nid of conn) {
      nodalAcc[nid].sx += elementStresses[e].sx * a;
      nodalAcc[nid].sy += elementStresses[e].sy * a;
      nodalAcc[nid].ty += elementStresses[e].ty * a;
      nodalAcc[nid].w += a;
    }
  });
  const nodalStresses = nodalAcc.map((n) => {
    const w = n.w || 1;
    const sx = n.sx / w, sy = n.sy / w, ty = n.ty / w;
    return { sx, sy, ty, vonMises: Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * ty * ty) };
  });

  // 最大位移 / 最大 von Mises
  let maxDisp = { value: 0, node: 0 };
  for (let i = 0; i < nn; i++) {
    const val = Math.hypot(U[2 * i], U[2 * i + 1]);
    if (val > maxDisp.value) maxDisp = { value: val, node: i };
  }
  let maxVM = { value: 0, element: 0 };
  elementStresses.forEach((s, e) => {
    if (s.vonMises > maxVM.value) maxVM = { value: s.vonMises, element: e };
  });

  // 支座反力：R = K·U - F（仅在约束自由度上非零；这里返回每个支座节点的合力）
  const reactions = supports.map((sup) => {
    const dofs = [2 * sup.node, 2 * sup.node + 1];
    let fx = 0, fy = 0;
    for (const d of dofs) {
      let ku = 0;
      // K[d][c]·U[c]：行 d 非零元在各列中
      for (const [i, val] of Kfull.cols[d]) ku += val * U[i]; // i<=d（上三角，行 i）
      for (let c = d + 1; c < ndof; c++) {
        const val = Kfull.cols[c].get(d);
        if (val !== undefined) ku += val * U[c];
      }
      const r = ku - F[d];
      if (d % 2 === 0) fx = r;
      else fy = r;
    }
    return { node: sup.node, fx, fy };
  });

  const displacements: Vec2[] = [];
  for (let i = 0; i < nn; i++) displacements.push([U[2 * i], U[2 * i + 1]]);

  return {
    displacements,
    displacementVector: Array.from(U),
    elementStresses,
    nodalStresses,
    reactions,
    maxDisplacement: maxDisp,
    maxVonMises: maxVM,
    freeDofCount: nf,
  };
}

/**
 * 刚度奇异时的教学诊断：
 *  用更松的阈值对「无约束整体刚度」做 LDLᵀ，统计近零主元个数。
 *  二维固体理论上恰好有 3 个刚体模态（x 平移、y 平移、平面转动）。
 *  - 近零主元恰为 3 个 → 典型的「完全没有约束」
 *  - 更多 → 存在机构/网格断裂（悬挂节点、重叠单元）
 *  同时找出位移未被任何支座「覆盖」的连通分量，给出疑似节点。
 */
function diagnoseSingularity(
  model: FiniteElementModel,
  Kfull: ReturnType<typeof createSparseMatrix>,
  _inner: SparseLdlError | null
): TSing {
  const nn = model.mesh.nodes.length;

  // 尝试在 RCM 排序后的无约束整体刚度上分解，确认确为零能模态导致的奇异
  const Kp = permuteMatrix(Kfull, rcmOrder(Kfull).inv);
  let firstBadPivot = -1;
  try {
    ldltDecompose(Kp, buildStructure(Kp), 1e-8);
  } catch (e) {
    if (e instanceof SparseLdlError) firstBadPivot = e.pivot;
  }

  // 基于网格邻接 + 支座覆盖找未约束连通分量
  const adj: Set<number>[] = Array.from({ length: nn }, () => new Set());
  for (const conn of model.mesh.elements) {
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      adj[conn[a]].add(conn[b]);
      adj[conn[b]].add(conn[a]);
    }
  }
  const visited = new Uint8Array(nn);
  const unstableNodes: number[] = [];
  const modes: string[] = [];
  for (let start = 0; start < nn; start++) {
    if (visited[start]) continue;
    const comp: number[] = [];
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const m of adj[n]) if (!visited[m]) { visited[m] = 1; stack.push(m); }
    }
    let fixX = false, fixY = false;
    for (const n of comp) {
      for (const s of model.supports) {
        if (s.node !== n) continue;
        if (s.type === "fixed" || s.type === "rollerY") fixX = true;
        if (s.type === "fixed" || s.type === "rollerX") fixY = true;
      }
    }
    if (!fixX || !fixY) {
      unstableNodes.push(...comp);
      if (!fixX) modes.push("x 方向刚体平移未被约束");
      if (!fixY) modes.push("y 方向刚体平移未被约束");
      if (!fixX && !fixY) modes.push("平面刚体转动未被约束");
    }
  }

  if (unstableNodes.length === nn && firstBadPivot >= 0) {
    modes.splice(0, modes.length, "整体 x 平移", "整体 y 平移", "整体平面转动");
  }

  const msg =
    unstableNodes.length > 0
      ? `模型约束不足，刚度矩阵奇异，无法求解。${[...new Set(modes)].join("；")}。请检查支座设置（固定支座约束两个方向，滚动支座只约束一个方向）。`
      : "刚度矩阵奇异，可能存在退化单元、重复节点或网格不连通。请检查网格质量后重试。";
  return new SingularMatrixError(msg, unstableNodes.slice(0, 200), [...new Set(modes)]);
}
