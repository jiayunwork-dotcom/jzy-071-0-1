/**
 * 稀疏对称线性方程组求解器：K·u = F。
 *
 * 采用 Map 稀疏存储 + 左看（left-looking）LDLᵀ 分解，无需第三方数值库。
 * 有限元刚度矩阵每行非零元很少（每节点只与相邻节点耦合），
 * 即使不做 RCM 排序填充也很少，教学规模（数千节点）下足够快。
 *
 * 分解：K = L·D·Lᵀ，L 为单位下三角，D 为对角。
 * 求解顺序：L·y=F → y/=D → Lᵀ·u=y。
 */

export interface SparseMatrix {
  n: number;
  /**
   * 对称矩阵按「上三角」存储：cols[j] 为列 j 中行号 i<=j 的非零元 Map<i,val>。
   * K[i][j]（i>j）对称地从 cols[i].get(j) 读取。
   */
  cols: Map<number, number>[];
}

export function createSparseMatrix(n: number): SparseMatrix {
  const cols: Map<number, number>[] = new Array(n);
  for (let j = 0; j < n; j++) cols[j] = new Map();
  return { n, cols };
}

/** 往指定 (i0,j0) 位置累加标量（自动折到上三角） */
export function addScalar(K: SparseMatrix, i0: number, j0: number, val: number) {
  const i = Math.min(i0, j0), j = Math.max(i0, j0);
  K.cols[j].set(i, (K.cols[j].get(i) ?? 0) + val);
}

/** 累加一个稠密小块（如单元 6×6 刚度，rows 为全局自由度编号） */
export function addBlock(K: SparseMatrix, rows: number[], block: number[][]) {
  for (let a = 0; a < rows.length; a++) {
    for (let b = 0; b < rows.length; b++) {
      // 只存上三角：必须按「全局自由度编号」比较，不能用块内下标
      const ga = rows[a], gb = rows[b];
      if (ga <= gb) K.cols[gb].set(ga, (K.cols[gb].get(ga) ?? 0) + block[a][b]);
    }
  }
}

export class SparseLdlError extends Error {
  pivot: number;
  scale: number;
  constructor(pivot: number, scale: number) {
    super(`LDLᵀ 分解在第 ${pivot} 个主元处失败：主元趋近于 0，刚度矩阵奇异（约束不足或存在机构）`);
    this.name = "SparseLdlError";
    this.pivot = pivot;
    this.scale = scale;
  }
}

export interface LDLResult {
  diag: Float64Array;
  /** lowerCols[j]: 列 j 严格下方的 L 因子 Map<i, L_ij>，i>j */
  lowerCols: Map<number, number>[];
  /** lowerRows[i]: 行 i 严格左方的 L 因子 Map<j, L_ij>，j<i（与 lowerCols 互为转置索引） */
  lowerRows: Map<number, number>[];
}

/** 结构邻接：由 K 的上三角结构构造每个自由度 j 的相邻行集合 {i>j : K[i][j]!=0} */
export function buildStructure(K: SparseMatrix): Set<number>[] {
  const n = K.n;
  const adj: Set<number>[] = new Array(n);
  for (let j = 0; j < n; j++) adj[j] = new Set<number>();
  for (let col = 0; col < n; col++) {
    for (const row of K.cols[col].keys()) {
      if (row < col) adj[row].add(col);
    }
  }
  return adj;
}

/**
 * LDLᵀ 分解。
 * @param structAdj 结构邻接（buildStructure 的结果）
 * @param pivotTol  主元相对阈值（相对全局对角尺度归一化）
 */
export function ldltDecompose(
  K: SparseMatrix,
  structAdj: Set<number>[],
  pivotTol = 1e-10
): LDLResult {
  const n = K.n;
  const diag = new Float64Array(n);
  const lowerCols: Map<number, number>[] = new Array(n);
  const lowerRows: Map<number, number>[] = new Array(n);
  for (let i = 0; i < n; i++) lowerRows[i] = new Map();

  let globalScale = 1e-300;
  for (let j = 0; j < n; j++) globalScale = Math.max(globalScale, Math.abs(K.cols[j].get(j) ?? 0));

  for (let j = 0; j < n; j++) {
    const lrowJ = lowerRows[j]; // 行 j 上所有 L[j][k], k<j

    // 主元：D[j] = K[j][j] - Σ_{k<j} L[j][k]²·D[k]
    let djj = K.cols[j].get(j) ?? 0;
    for (const [k, ljk] of lrowJ) djj -= ljk * ljk * diag[k];

    if (!(Math.abs(djj) > pivotTol * globalScale)) {
      throw new SparseLdlError(j, globalScale);
    }
    diag[j] = djj;

    // 第 j 列 L 因子：L[i][j] = (K[i][j] - Σ_{k<j} L[i][k]·L[j][k]·D[k]) / D[j]
    // 非零行集合（全部严格满足 i>j）= 结构邻接行 ∪ 填充行
    const rows = new Set<number>();
    for (const i of structAdj[j]) if (i > j) rows.add(i);
    for (const k of lrowJ.keys()) {
      for (const i of lowerCols[k].keys()) {
        if (i > j) rows.add(i); // 只收集严格下方行，避免旧行污染
      }
    }

    const lcol = new Map<number, number>();
    for (const i of rows) {
      let aij = K.cols[i].get(j) ?? 0; // 对称读取原始 K[i][j]
      const lrowI = lowerRows[i];
      for (const [k, lik] of lrowI) {
        const ljk = lrowJ.get(k);
        if (ljk !== undefined) aij -= lik * ljk * diag[k];
      }
      const lij = aij / djj;
      if (lij !== 0) {
        lcol.set(i, lij);
        lrowI.set(j, lij);
      }
    }
    lowerCols[j] = lcol;
  }
  return { diag, lowerCols, lowerRows };
}

/** 前向/对角/后向代入 */
export function solveLDL(ldl: LDLResult, b: ArrayLike<number>): Float64Array {
  const n = ldl.diag.length;
  const y = new Float64Array(n);

  // L·y = b（L 单位对角）：y[j] = b[j] - Σ_{k<j} L[j][k]·y[k]
  for (let j = 0; j < n; j++) {
    let s = b[j];
    for (const [k, ljk] of ldl.lowerRows[j]) s -= ljk * y[k];
    y[j] = s;
  }
  // y /= D
  for (let j = 0; j < n; y[j] /= ldl.diag[j], j++);
  // Lᵀ·u = y：u[j] = y[j] - Σ_{i>j} L[i][j]·u[i]
  for (let j = n - 1; j >= 0; j--) {
    let s = y[j];
    for (const [i, lij] of ldl.lowerCols[j]) s -= lij * y[i];
    y[j] = s;
  }
  return y;
}

/** 一步完成分解与代入 */
export function solveSparse(K: SparseMatrix, b: ArrayLike<number>, pivotTol = 1e-10): Float64Array {
  const ldl = ldltDecompose(K, buildStructure(K), pivotTol);
  return solveLDL(ldl, b);
}
