import type {
  AnchoredLoad,
  AnchoredSupport,
  ConvergenceRequest,
  ConvergenceResponse,
  Mesh,
  NodalLoad,
  Support,
  Vec2,
} from "./types.js";
import { distance } from "./geometry.js";
import { generateMesh } from "./mesher.js";
import { solve } from "./fem.js";
import { applyEdgeSupport, applyEdgeTraction, nearestNode } from "./boundary.js";

export { nearestNode };

/**
 * 网格无关性验证：
 * 同一几何与材料，按给定的递增网格密度序列逐次：
 *   重新剖分 → 把按坐标锚定/按边线定义的边界条件匹配到当前网格 → 求解 → 记录极值。
 * 随网格加密，最大应力应收敛到有限元极限值（曲线趋于平台）。
 */
export function convergenceStudy(req: ConvergenceRequest): ConvergenceResponse {
  const points = [];
  for (const seedSize of req.seedSizes) {
    const { mesh, stats } = generateMesh({ loops: req.loops, seedSize, smoothing: 20 });

    const supports: Support[] = buildSupports(req, mesh);
    const loads: NodalLoad[] = buildLoads(req, mesh);

    const result = solve({
      mesh,
      material: req.material,
      supports,
      loads,
      bodyForce: req.bodyForce,
    });

    points.push({
      seedSize,
      nodeCount: stats.nodeCount,
      elementCount: stats.elementCount,
      maxVonMises: result.maxVonMises.value,
      maxAbsDisplacement: result.maxDisplacement.value,
    });
  }
  return { points };
}

function buildSupports(req: ConvergenceRequest, mesh: Mesh): Support[] {
  if (req.edgeSupports && req.edgeSupports.length > 0) {
    const all: Support[] = [];
    for (const es of req.edgeSupports) all.push(...applyEdgeSupport(mesh, es));
    return mergeSupports(all);
  }
  return req.supports.map((a: AnchoredSupport) => ({
    node: nearestNode(mesh, [a.x, a.y] as Vec2),
    type: a.type,
  }));
}

function buildLoads(req: ConvergenceRequest, mesh: Mesh): NodalLoad[] {
  const loads: NodalLoad[] = req.loads.map((a: AnchoredLoad) => ({
    node: nearestNode(mesh, [a.x, a.y] as Vec2),
    fx: a.fx,
    fy: a.fy,
  }));
  if (req.edgeTractions) {
    for (const tr of req.edgeTractions) {
      loads.push(...applyEdgeTraction(mesh, tr, req.material.thickness));
    }
  }
  return loads;
}

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

// 避免 distance 被判定未使用（保留供外部工具复用）
void distance;
