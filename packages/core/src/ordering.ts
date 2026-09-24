import type { SparseMatrix } from "./solver-sparse.js";

/**
 * Reverse Cuthill–McKee（RCM）排序：
 * 利用刚度矩阵的图结构重排自由度，使矩阵带宽最小化，
 * 显著减少 LDLᵀ 分解的填充，是有限元稀疏求解的标准前处理。
 *
 * 返回置换 perm：新编号 perm[i] 对应的原自由度；
 * 逆置换 inv：原自由度 d 的新编号 inv[d]。
 */
export interface Permutation {
  perm: Int32Array;
  inv: Int32Array;
}

export function rcmOrder(K: SparseMatrix): Permutation {
  const n = K.n;
  const adj: Set<number>[] = new Array(n);
  for (let j = 0; j < n; j++) adj[j] = new Set();
  for (let col = 0; col < n; col++) {
    for (const row of K.cols[col].keys()) {
      if (row !== col) {
        adj[row].add(col);
        adj[col].add(row);
      }
    }
  }

  const degree = (i: number) => adj[i].size;

  // 伪外围起始节点：从最小度节点做 BFS，取最远端点，迭代两次
  const pickStart = (): number => {
    let start = 0;
    for (let i = 1; i < n; i++) if (degree(i) < degree(start)) start = i;
    for (let round = 0; round < 2; round++) {
      const [order, levels] = bfsLevels(start, adj, degree);
      // 最后一层中度最小的节点作为新的候选
      let far = order[order.length - 1];
      const maxLevel = levels[far];
      for (const node of order) {
        if (levels[node] === maxLevel && degree(node) < degree(far)) far = node;
      }
      if (far === start) break;
      start = far;
    }
    return start;
  };

  // 处理可能不连通的图：逐分量 RCM
  const visited = new Uint8Array(n);
  const result: number[] = [];
  for (let comp = 0; comp < n; comp++) {
    let start = -1;
    // 在未访问节点中选度最小者作为该分量起点
    for (let i = 0; i < n; i++) {
      if (!visited[i] && (start === -1 || degree(i) < degree(start))) start = i;
    }
    if (start === -1) break;
    void pickStart;
    const [order] = bfsLevels(start, adj, degree, visited);
    // RCM：反转 Cuthill–McKee 序
    for (let i = order.length - 1; i >= 0; i--) result.push(order[i]);
  }

  const perm = Int32Array.from(result);
  const inv = new Int32Array(n);
  perm.forEach((old, neu) => (inv[old] = neu));
  return { perm, inv };
}

/** Cuthill–McKee BFS：邻居按度数升序入队 */
function bfsLevels(
  start: number,
  adj: Set<number>[],
  degree: (i: number) => number,
  globalVisited?: Uint8Array
): [number[], Int32Array] {
  const n = adj.length;
  const seen = new Uint8Array(n);
  const levels = new Int32Array(n).fill(-1);
  const order: number[] = [];
  const queue: number[] = [start];
  seen[start] = 1;
  levels[start] = 0;
  while (queue.length) {
    const node = queue.shift()!;
    order.push(node);
    if (globalVisited) globalVisited[node] = 1;
    const nbrs = [...adj[node]]
      .filter((m) => !seen[m] && !(globalVisited && globalVisited[m]))
      .sort((a, b) => degree(a) - degree(b));
    for (const m of nbrs) {
      seen[m] = 1;
      levels[m] = levels[node] + 1;
      queue.push(m);
    }
  }
  return [order, levels];
}

/** 按 RCM 置换重排稀疏对称矩阵：Kp = P K Pᵀ */
export function permuteMatrix(K: SparseMatrix, inv: Int32Array): SparseMatrix {
  const n = K.n;
  const Kp = {
    n,
    cols: new Array<Map<number, number>>(n),
  } as SparseMatrix;
  for (let j = 0; j < n; j++) Kp.cols[j] = new Map();
  for (let col = 0; col < n; col++) {
    const jNew = inv[col];
    for (const [row, val] of K.cols[col]) {
      const iNew = inv[row];
      const i = Math.min(iNew, jNew);
      const j = Math.max(iNew, jNew);
      Kp.cols[j].set(i, val);
    }
  }
  return Kp;
}
