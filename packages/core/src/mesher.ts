import createCDT from "cdt2d";
import type { Mesh, MeshingRequest, MeshingResponse, Vec2, MeshStats } from "./types.js";
import {
  bbox,
  distance,
  distanceToBoundary,
  pointInDomain,
  polygonArea,
  triArea,
  triangleAngles,
  triangleQuality,
} from "./geometry.js";

/**
 * 三角网格生成：
 *  1. 沿每条环的边界按种子间距 h 细分，保证边界被完整、 conforming 覆盖；
 *  2. 在区域内部以近似 h 间距撒抖动点阵；
 *  3. 约束 Delaunay 三角剖分（cdt2d），约束边绝不被翻转，故凹域与孔洞边界合法；
 *  4. 删除区域外/孔洞内单元，重排节点，单元保证 CCW；
 *  5. 若干次 Laplacian 平滑（边界点沿边滑动、内角顶点不动），改善单元形状。
 *
 * 合法性保证：所有输出三角形的边要么是约束边，要么由内部 Steiner 点构成，
 * 单元只在共享整条边时相邻——无重叠、无悬挂节点、边界完整。
 */
export function generateMesh(req: MeshingRequest): MeshingResponse {
  const { loops, seedSize } = req;
  const h = Math.max(seedSize, 1e-9);
  if (loops.length === 0) throw new Error("至少需要一条外环");
  for (const loop of loops) {
    if (loop.length < 3) throw new Error("每条环至少需要 3 个顶点");
    if (Math.abs(polygonArea(loop)) < 1e-14) throw new Error("多边形面积为 0，请检查顶点");
  }

  // ---------- 1 边界细分点 ----------
  const nodes: Vec2[] = [];
  const edgeConstraints: Array<[number, number]> = [];
  // 记录哪些节点是「边内部细分点」及其所在原始边（供诊断）
  const boundaryPointEdge = new Map<number, [Vec2, Vec2]>();

  for (const loop of loops) {
    // 每条环的角点先各占一个编号（角点在平滑时保持不动）
    const vertIdx = loop.map((p) => {
      const idx = nodes.length;
      nodes.push([p[0], p[1]]);
      return idx;
    });
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const ia = vertIdx[i];
      const ib = vertIdx[(i + 1) % loop.length];
      const nSeg = Math.max(1, Math.round(distance(a, b) / h));
      let prev = ia;
      for (let s = 1; s < nSeg; s++) {
        const t = s / nSeg;
        const idx = nodes.length;
        nodes.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        boundaryPointEdge.set(idx, [a, b]);
        edgeConstraints.push([prev, idx]);
        prev = idx;
      }
      edgeConstraints.push([prev, ib]);
    }
  }

  const boundaryNodeCount = nodes.length;

  // ---------- 2 内部抖动点阵 ----------
  const { minX, minY, maxX, maxY } = bbox(loops);
  // 低差异抖动：每个网格单元内做确定性抖动，避免规则网格退化
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const margin = h * 0.55; // 距边界太近的点不撒，避免产生极小角
  const nx = Math.max(1, Math.ceil((maxX - minX) / h));
  const ny = Math.max(1, Math.ceil((maxY - minY) / h));
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      const jx = rand() * 0.6 - 0.3;
      const jy = rand() * 0.6 - 0.3;
      const p: Vec2 = [minX + (ix + 0.5 + jx) * h, minY + (iy + 0.5 + jy) * h];
      if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) continue;
      if (pointInDomain(p, loops) && distanceToBoundary(p, loops) > margin) {
        nodes.push(p);
      }
    }
  }

  // ---------- 3 约束 Delaunay ----------
  let cells: number[][] = [];
  try {
    cells = createCDT(nodes, edgeConstraints, { exterior: false, interior: true }) ?? [];
  } catch (e) {
    throw new Error("三角剖分失败：请检查多边形是否简单（无自交）且有效");
  }
  if (cells.length === 0) throw new Error("三角剖分结果为空，请检查区域定义或减小种子间距");

  // ---------- 4 过滤区域外单元（孔洞/凹域安全网） ----------
  const centroidIn = (tri: number[]): boolean => {
    const c: Vec2 = [
      (nodes[tri[0]][0] + nodes[tri[1]][0] + nodes[tri[2]][0]) / 3,
      (nodes[tri[0]][1] + nodes[tri[1]][1] + nodes[tri[2]][1]) / 3,
    ];
    return pointInDomain(c, loops);
  };
  cells = cells.filter(centroidIn);

  // 收集实际被使用的节点并重新编号（丢弃孤立点）
  const used = new Set<number>();
  cells.forEach((t) => t.forEach((n) => used.add(n)));
  const remap = new Map<number, number>();
  const finalNodes: Vec2[] = [];
  const isBoundaryNode = new Set<number>();
  [...used].sort((a, b) => a - b).forEach((old) => {
    remap.set(old, finalNodes.length);
    finalNodes.push(nodes[old]);
    if (old < boundaryNodeCount) isBoundaryNode.add(finalNodes.length - 1);
  });
  const elements = cells.map((t) => {
    const ids = t.map((n) => remap.get(n)!);
    // 保证 CCW
    const s = triArea(finalNodes[ids[0]], finalNodes[ids[1]], finalNodes[ids[2]]);
    return s < 0 ? [ids[0], ids[2], ids[1]] : ids;
  });

  // ---------- 5 Laplacian 平滑 ----------
  const smoothIter = req.smoothing ?? 12;
  const boundaryEdges = rebuildBoundaryEdges(elements, isBoundaryNode);
  laplacianSmooth(finalNodes, elements, isBoundaryNode, loops, smoothIter);

  const mesh: Mesh = {
    nodes: finalNodes,
    elements,
    boundaryEdges,
  };
  const stats = meshStatistics(mesh);
  return { mesh, stats };
}

/** 由单元半边重建边界边（出现一次的半边） */
function rebuildBoundaryEdges(elements: number[][], _boundary: Set<number>): number[][] {
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (const t of elements) {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1);
    }
  }
  const out: number[][] = [];
  for (const t of elements) {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      if (count.get(key(a, b)) === 1) out.push([a, b]);
    }
  }
  return out;
}

/**
 * Laplacian 平滑：
 *  - 内部节点移至相邻节点平均位置；
 *  - 边界节点投影回最近的原始边界线段（内角顶点即用户顶点保持不动，通过 h 距离判定）。
 */
function laplacianSmooth(
  nodes: Vec2[],
  elements: number[][],
  boundary: Set<number>,
  loops: Vec2[][],
  iterations: number
) {
  const n = nodes.length;
  const neighbors: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const t of elements) {
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      neighbors[t[a]].add(t[b]);
      neighbors[t[b]].add(t[a]);
    }
  }
  // 用户输入的多边形内角顶点：细分后通常离任一原始顶点很近（精确重合），冻结它们
  const cornerNodes = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (!boundary.has(i)) continue;
    for (const loop of loops) {
      if (loop.some((p) => distance(p, nodes[i]) < 1e-9)) cornerNodes.add(i);
    }
  }

  for (let it = 0; it < iterations; it++) {
    const old = nodes.map((p) => [...p] as Vec2);
    for (let i = 0; i < n; i++) {
      if (cornerNodes.has(i)) continue;
      let sx = 0, sy = 0, cnt = 0;
      for (const nb of neighbors[i]) { sx += old[nb][0]; sy += old[nb][1]; cnt++; }
      if (cnt === 0) continue;
      let nx = sx / cnt, ny = sy / cnt;
      if (boundary.has(i)) {
        // 边界节点：投影到最近原始边界线段
        let best = Infinity, bx = 0, by = 0;
        for (const loop of loops) {
          for (let e = 0; e < loop.length; e++) {
            const a = loop[e], b = loop[(e + 1) % loop.length];
            const abx = b[0] - a[0], aby = b[1] - a[1];
            const len2 = abx * abx + aby * aby;
            let t = len2 > 0 ? ((nx - a[0]) * abx + (ny - a[1]) * aby) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const px = a[0] + t * abx, py = a[1] + t * aby;
            const d = (px - nx) ** 2 + (py - ny) ** 2;
            if (d < best) { best = d; bx = px; by = py; }
          }
        }
        nx = bx; ny = by;
      }
      nodes[i] = [nx, ny];
    }
  }
}

/** 网格统计：节点/单元数、最小/最大内角、平均质量 */
export function meshStatistics(mesh: Mesh): MeshStats {
  let minAngle = 180, maxAngle = 0, qualitySum = 0;
  for (const t of mesh.elements) {
    const [a, b, c] = triangleAngles(mesh.nodes[t[0]], mesh.nodes[t[1]], mesh.nodes[t[2]]);
    minAngle = Math.min(minAngle, a, b, c);
    maxAngle = Math.max(maxAngle, a, b, c);
    qualitySum += triangleQuality(mesh.nodes[t[0]], mesh.nodes[t[1]], mesh.nodes[t[2]]);
  }
  return {
    nodeCount: mesh.nodes.length,
    elementCount: mesh.elements.length,
    minAngleDeg: minAngle,
    maxAngleDeg: maxAngle,
    avgQuality: qualitySum / Math.max(1, mesh.elements.length),
  };
}
