import type {
  MeshingRequest,
  MeshingResponse,
  SolveRequest,
  SolveResponse,
  ConvergenceRequest,
  ConvergenceResponse,
} from "@fem2d/core";

/** 后端错误结构（与 server mapError 对应） */
export interface ApiErrorPayload {
  error: string;
  code: string;
  details?: {
    unstableNodes?: number[];
    rigidBodyModes?: string[];
  };
}

export class ApiError extends Error {
  code: string;
  details?: ApiErrorPayload["details"];
  status: number;
  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error);
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

async function post<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

async function get<T>(route: string): Promise<T> {
  const res = await fetch(route);
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  mesh: (req: MeshingRequest) => post<MeshingResponse>("/api/mesh", req),
  solve: (req: SolveRequest) => post<SolveResponse>("/api/solve", req),
  convergence: (req: ConvergenceRequest) =>
    post<ConvergenceResponse>("/api/convergence", req),
  examples: () =>
    get<{
      examples: Array<{
        id: string;
        name: string;
        description: string;
        loops: import("@fem2d/core").Vec2[][];
        material: import("@fem2d/core").Material;
        template: import("@fem2d/core").TemplateParams;
        supports: import("@fem2d/core").AnchoredSupport[];
        loads: import("@fem2d/core").AnchoredLoad[];
        edgeSupports?: import("@fem2d/core").EdgeSupport[];
        edgeTractions?: import("@fem2d/core").EdgeTraction[];
        reference: {
          tipDeflection?: { formula: string; value: number };
          maxBendingStress?: { formula: string; value: number };
          note: string;
        };
        convergenceSeeds: number[];
      }>;
    }>("/api/examples"),
  health: () => get<{ ok: boolean }>("/api/health"),
};
