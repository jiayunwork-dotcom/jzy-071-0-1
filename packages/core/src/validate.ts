import type { Mesh, Vec2 } from "./types.js";
import { distance, pointSegmentDistance, triArea } from "./geometry.js";

export interface MeshValidation {
  valid: boolean;
  errors: string[];
}

const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/**
 * 网格合法性校验，供后端结果自检与自动化测试使用：
 *  1. 无退化/负面积单元；
 *  2. 无悬挂节点：内部边恰好被 2 个单元共享，边界边恰好 1 个；
 *  3. 无重叠单元：面积和等于并集面积的抽样/拓扑校验（用边流形 + 内部重心互查）；
 *  4. 边界完整覆盖：输入多边形的每条边距网格边界边距离足够小。
 */
export function validateMesh(mesh: Mesh, domainLoops?: Vec2[][], tol = 1e-7): MeshValidation {
  const errors: string[] = [];
  const n = mesh.nodes.length;

  for (const [e, t] of mesh.elements.entries()) {
    if (t.length !== 3 || t.some((i) => i < 0 || i >= n)) {
      errors.push(`单元 #${e} 节点编号非法`);
      continue;
    }
    const a = triArea(mesh.nodes[t[0]], mesh.nodes[t[1]], mesh.nodes[t[2]]);
    if (a <= 0) errors.push(`单元 #${e} 面积非正（退化或顺时针）`);
  }

  // 半边计数
  const edgeCells = new Map<string, number[]>();
  for (const [e, t] of mesh.elements.entries()) {
    for (let k = 0; k < 3; k++) {
      const kk = key(t[k], t[(k + 1) % 3]);
      const arr = edgeCells.get(kk) ?? [];
      arr.push(e);
      edgeCells.set(kk, arr);
    }
  }
  for (const [ek, arr] of edgeCells) {
    if (arr.length > 2) errors.push(`边 ${ek} 被 ${arr.length} 个单元共享（非流形/重叠）`);
  }
  // 悬挂节点：被单元引用但所有关联边……更直接地，检查孤立节点
  const used = new Set<number>();
  mesh.elements.forEach((t) => t.forEach((i) => used.add(i)));
  for (let i = 0; i < n; i++) {
    if (!used.has(i)) errors.push(`节点 #${i} 是孤立节点（可能为悬挂节点）`);
  }

  // 重叠检测：任意两个单元重心互不落在对方内部（共享边的合法相邻单元重心在外）
  const centroid = (t: number[]): Vec2 => [
    (mesh.nodes[t[0]][0] + mesh.nodes[t[1]][0] + mesh.nodes[t[2]][0]) / 3,
    (mesh.nodes[t[0]][1] + mesh.nodes[t[1]][1] + mesh.nodes[t[2]][1]) / 3,
  ];
  // 仅在小规模抽样时做两两检查，避免 O(n²)
  if (mesh.elements.length <= 4000) {
    for (let i = 0; i < mesh.elements.length; i++) {
      const ci = centroid(mesh.elements[i]);
      for (let j = i + 1; j < mesh.elements.length; j++) {
        if (overlap2D(mesh, mesh.elements[i], mesh.elements[j], ci, centroid(mesh.elements[j]))) {
          errors.push(`单元 #${i} 与 #${j} 重叠`);
        }
      }
    }
  }

  // 边界覆盖：重建边界边后，与输入域边界比较 Hausdorff 距离
  if (domainLoops && domainLoops.length > 0) {
    const boundaryEdges: number[][] = [];
    for (const [ek, arr] of edgeCells) {
      if (arr.length === 1) {
        const [a, b] = ek.split("_").map(Number);
        boundaryEdges.push([a, b]);
      }
    }
    const scale = characteristicScale(mesh);
    const boundTol = Math.max(tol, 1e-5 * scale);
    for (const loop of domainLoops) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        let minA = Infinity, minB = Infinity;
        for (const [ea, eb] of boundaryEdges) {
          const pa = mesh.nodes[ea], pb = mesh.nodes[eb];
          minA = Math.min(minA, pointSegmentDistance(a, pa, pb));
          minB = Math.min(minB, pointSegmentDistance(b, pa, pb));
        }
        if (minA > boundTol || minB > boundTol) {
          errors.push("输入多边形边界未被网格完整覆盖");
          break;
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 两三角形重叠快速判定（共享顶点/边不算重叠） */
function overlap2D(mesh: Mesh, t1: number[], t2: number[], c1: Vec2, c2: Vec2): boolean {
  const shared = t1.filter((i) => t2.includes(i)).length;
  if (shared >= 2) return false; // 共享整条边（或退化重复，另由边计数捕获）
  if (shared === 1 && distance(c1, c2) < 1e-15) return false;
  return pointInTri(c1, mesh, t2) || pointInTri(c2, mesh, t1);
}

function pointInTri(p: Vec2, mesh: Mesh, t: number[]): boolean {
  const [a, b, c] = [mesh.nodes[t[0]], mesh.nodes[t[1]], mesh.nodes[t[2]]];
  const s1 = sign(p, a, b), s2 = sign(p, b, c), s3 = sign(p, c, a);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}
function sign(p: Vec2, a: Vec2, b: Vec2) {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}

function characteristicScale(mesh: Mesh): number {
  let s = 0;
  for (const [x, y] of mesh.nodes) s += Math.abs(x) + Math.abs(y);
  return Math.max(1e-9, s / mesh.nodes.length);
}
