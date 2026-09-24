/**
 * 二维平面有限元静力分析 —— 公共类型定义
 *
 * 约定：
 *  - 几何坐标统一使用「真实坐标」：x 向右、y 向上，单位为米 (m)。
 *  - 前端屏幕像素坐标到真实坐标的换算只在前端做，内核不关心像素。
 *  - 应力单位 Pa，力单位 N，厚度单位 m。
 */

export type Vec2 = [number, number];

/** 平面应力 / 平面应变 */
export type PlaneMode = "stress" | "strain";

export interface Material {
  /** 弹性模量 E，单位 Pa */
  youngsModulus: number;
  /** 泊松比 ν，无量纲 */
  poissonRatio: number;
  mode: PlaneMode;
  /** 单元厚度 t（平面应力下直接使用；平面应变一般取 1 m），单位 m */
  thickness: number;
}

/** 约束类型：fixed=固定；rollerX=只能沿 x 滑移（uy=0）；rollerY=只能沿 y 滑移（ux=0） */
export type SupportType = "fixed" | "rollerX" | "rollerY";

export interface Support {
  node: number;
  type: SupportType;
}

/** 节点集中力，N */
export interface NodalLoad {
  node: number;
  fx: number;
  fy: number;
}

/** 全域体力（如重力 (0, -rho*g)），N/m^3 */
export interface BodyForce {
  bx: number;
  by: number;
}

/** 网格：三角形单元（节点编号顺序保证逆时针、面积为正） */
export interface Mesh {
  nodes: Vec2[];
  /** 每个单元为 3 个节点编号 [i, j, k]，CCW */
  elements: number[][];
  /** 边界半边 [节点a, 节点b]，可用于可视化 */
  boundaryEdges: number[][];
}

export interface MeshStats {
  nodeCount: number;
  elementCount: number;
  minAngleDeg: number;
  maxAngleDeg: number;
  /** 平均单元质量（基于面积与边长平方和的无量纲度量，等边三角形为 1） */
  avgQuality: number;
}

export interface FiniteElementModel {
  mesh: Mesh;
  material: Material;
  supports: Support[];
  loads: NodalLoad[];
  bodyForce?: BodyForce;
}

export interface ElementStress {
  /** 单元质心应力（CST 单元内应力为常数） */
  sx: number;
  sy: number;
  ty: number; // τxy
  vonMises: number;
}

export interface SolveResult {
  /** 每个节点的位移 [ux, uy]，单位 m */
  displacements: Vec2[];
  /** 位移向量（全局自由度顺序：节点 i -> [2i, 2i+1]） */
  displacementVector: number[];
  /** 每个单元的应力，Pa */
  elementStresses: ElementStress[];
  /** 节点平均应力（面积加权，供平滑云图使用） */
  nodalStresses: Array<{ sx: number; sy: number; ty: number; vonMises: number }>;
  reactions: Array<{ node: number; fx: number; fy: number }>;
  /** 最大位移大小与所在节点 */
  maxDisplacement: { value: number; node: number };
  /** 最大 von Mises 应力与所在单元 */
  maxVonMises: { value: number; element: number };
  /** 实际参与求解的自由度数 */
  freeDofCount: number;
}

/** 求解失败（如约束不足导致奇异）时抛出的错误 */
export class SingularMatrixError extends Error {
  /** 疑似未被约束住的节点编号（供前端高亮提示） */
  unstableNodes: number[];
  /** 刚度矩阵零空间诊断结果 */
  rigidBodyModes: string[];
  constructor(message: string, unstableNodes: number[] = [], rigidBodyModes: string[] = []) {
    super(message);
    this.name = "SingularMatrixError";
    this.unstableNodes = unstableNodes;
    this.rigidBodyModes = rigidBodyModes;
  }
}

// ---------- 前后端接口 ----------

export type TemplateKind = "rectangle" | "lbeam" | "holePlate";

export interface TemplateParams {
  kind: TemplateKind;
  /** 矩形/梁：长 m */
  length?: number;
  /** 矩形/梁：高 m */
  height?: number;
  /** L 形：总宽/总高 */
  width?: number;
  /** L 形：壁厚 */
  thickness?: number;
  /** 带孔板：宽、高、孔半径 */
  plateWidth?: number;
  plateHeight?: number;
  holeRadius?: number;
}

export interface MeshingRequest {
  /** 外环（逆时针）与内环孔洞（顺时针），每条环为闭合顶点序列（首尾不重复） */
  loops: Vec2[][];
  /** 全局种子间距 h，单位 m */
  seedSize: number;
  /** Laplacian 平滑迭代次数 */
  smoothing?: number;
}

export interface MeshingResponse {
  mesh: Mesh;
  stats: MeshStats;
}

export interface SolveRequest {
  model: FiniteElementModel;
}

export interface SolveResponse {
  result: SolveResult;
}

export interface ConvergencePoint {
  seedSize: number;
  nodeCount: number;
  elementCount: number;
  maxVonMises: number;
  maxAbsDisplacement: number;
}

/** 网格无关性研究：约束/载荷按坐标锚定，在多个网格密度上重新匹配最近节点 */
export interface AnchoredSupport {
  x: number;
  y: number;
  type: SupportType;
}
export interface AnchoredLoad {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

/** 边线均布力（traction，N/m²），作用于从 a 到 b 的直线边界段，按梯形权重分配到边上节点 */
export interface EdgeTraction {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tx: number;
  ty: number;
}

/** 边线支座：把 a→b 边上所有节点设为同一约束类型（用于一整条边固定/滚动） */
export interface EdgeSupport {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  type: SupportType;
  /** 距离阈值（相对坐标尺度），默认 1e-6 */
  tol?: number;
}

export interface ConvergenceRequest {
  loops: Vec2[][];
  material: Material;
  seedSizes: number[];
  supports: AnchoredSupport[];
  loads: AnchoredLoad[];
  bodyForce?: BodyForce;
  edgeSupports?: EdgeSupport[];
  edgeTractions?: EdgeTraction[];
}

export interface ConvergenceResponse {
  points: ConvergencePoint[];
}
