import type {
  EdgeSupport,
  EdgeTraction,
  Mesh,
  NodalLoad,
  Support,
  Vec2,
} from "./types.js";
import { pointSegmentDistance } from "./geometry.js";

/** 找到距给定点最近的节点（接受 [x,y]） */
export function nearestNode(mesh: Mesh, point: Vec2): number {
  const [x, y] = point;
  let best = 0, bestD = Infinity;
  mesh.nodes.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function meshScale(mesh: Mesh): number {
  let s = 0;
  for (const [x, y] of mesh.nodes) s += Math.abs(x) + Math.abs(y);
  return Math.max(1e-9, s / mesh.nodes.length);
}

/** 收集落在 a→b 线段上的节点（含端点），按从 a 到 b 的弧长排序 */
export function nodesOnSegment(
  mesh: Mesh,
  a: Vec2,
  b: Vec2,
  tol?: number
): Array<{ node: number; s: number }> {
  const T = tol ?? 1e-6 * meshScale(mesh);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out: Array<{ node: number; s: number }> = [];
  mesh.nodes.forEach((p, i) => {
    const d = pointSegmentDistance(p, a, b);
    if (d <= T) {
      // 投影弧长（0..len）
      const t = len > 0 ? ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len) : 0;
      if (t >= -1e-6 && t <= 1 + 1e-6) out.push({ node: i, s: Math.max(0, Math.min(len, t * len)) });
    }
  });
  out.sort((p, q) => p.s - q.s);
  return out;
}

/**
 * 边线均布力 → 等效节点力（梯形权重，对线性单元精确）。
 * 边总长 L，均布面力 t（N/m²），厚度 h：
 *  每段 [s_k, s_{k+1}] 的合力 t·h·Δs，平分（恒面力下等价于梯形权重）给两端；
 *  内部节点最终分到 h·t·(Δs_left+Δs_right)/2，角点分到 h·t·Δs/2。
 */
export function applyEdgeTraction(mesh: Mesh, tr: EdgeTraction, thickness: number): NodalLoad[] {
  const a: Vec2 = [tr.ax, tr.ay];
  const b: Vec2 = [tr.bx, tr.by];
  const onLine = nodesOnSegment(mesh, a, b);
  if (onLine.length < 2) return [];
  const force = new Map<number, { fx: number; fy: number }>();
  const add = (n: number, fx: number, fy: number) => {
    const cur = force.get(n) ?? { fx: 0, fy: 0 };
    cur.fx += fx; cur.fy += fy;
    force.set(n, cur);
  };
  for (let k = 0; k + 1 < onLine.length; k++) {
    const ds = onLine[k + 1].s - onLine[k].s;
    if (ds <= 0) continue;
    const fx = tr.tx * thickness * ds;
    const fy = tr.ty * thickness * ds;
    add(onLine[k].node, fx / 2, fy / 2);
    add(onLine[k + 1].node, fx / 2, fy / 2);
  }
  return [...force.entries()].map(([node, f]) => ({ node, fx: f.fx, fy: f.fy }));
}

/** 边线支座 → 节点支座 */
export function applyEdgeSupport(mesh: Mesh, es: EdgeSupport): Support[] {
  return nodesOnSegment(mesh, [es.ax, es.ay], [es.bx, es.by], es.tol).map((o) => ({
    node: o.node,
    type: es.type,
  }));
}
