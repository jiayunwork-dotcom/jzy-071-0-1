/**
 * FEM 2D 后端 HTTP 服务（Node 内置 http，无第三方 Web 框架依赖）。
 *
 * 路由：
 *   GET  /api/health            健康检查
 *   POST /api/mesh              三角剖分 + 网格统计
 *   POST /api/solve             装配、求解、应力后处理
 *   POST /api/convergence       网格无关性研究（多密度批量求解）
 *   GET  /api/examples          内置标准算例列表（含解析参考解）
 *   GET  /                     静态托管前端构建产物
 *
 * 所有计算复用 @fem2d/core 内核，保证前后端与测试同源。
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  generateMesh,
  solve,
  convergenceStudy,
  allExamples,
  templateLoops,
  instantiatePreset,
  SingularMatrixError,
  type MeshingRequest,
  type SolveRequest,
  type ConvergenceRequest,
} from "@fem2d/core";

// 打包为 ESM（dist/server.mjs），用 import.meta.url 定位静态目录
const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const WEB_DIST = process.env.WEB_DIST ?? join(here, "../../web/dist");

interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error("请求体过大（上限 20 MB）"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 把内核异常映射为结构化错误，避免进程崩溃 */
function mapError(err: unknown): { status: number; body: ApiError } {
  if (err instanceof SingularMatrixError) {
    return {
      status: 422,
      body: {
        error: err.message,
        code: "SINGULAR_MATRIX",
        details: { unstableNodes: err.unstableNodes, rigidBodyModes: err.rigidBodyModes },
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 400, body: { error: message, code: "BAD_REQUEST" } };
}

function handleApi(route: string, body: unknown): { status: number; body: unknown } {
  switch (route) {
    case "/api/mesh": {
      const { mesh, stats } = generateMesh(body as MeshingRequest);
      return { status: 200, body: { mesh, stats } };
    }
    case "/api/solve": {
      const req = body as SolveRequest;
      const result = solve(req.model);
      return { status: 200, body: { result } };
    }
    case "/api/convergence": {
      const req = body as ConvergenceRequest;
      return { status: 200, body: convergenceStudy(req) };
    }
    case "/api/examples": {
      // 附带每个算例在推荐种子下实例化所需的全部信息
      return {
        status: 200,
        body: {
          examples: allExamples().map((ex) => ({
            ...ex,
            loops: templateLoops(ex.template),
          })),
        },
      };
    }
    default:
      return { status: 404, body: { error: `未知接口：${route}`, code: "NOT_FOUND" } };
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  // 防路径穿越
  const filePath = join(WEB_DIST, urlPath);
  if (!filePath.startsWith(WEB_DIST) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA 回退
    const index = join(WEB_DIST, "index.html");
    if (existsSync(index)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(index));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("前端尚未构建（packages/web/dist 不存在）");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const route = (req.url ?? "/").split("?")[0];

  if (req.method === "GET" && route === "/api/health") {
    sendJson(res, 200, { ok: true, service: "fem2d", time: new Date().toISOString() });
    return;
  }

  if (req.method === "GET" && route === "/api/examples") {
    try {
      sendJson(res, 200, handleApi("/api/examples", null).body);
    } catch (e) {
      const { status, body } = mapError(e);
      sendJson(res, status, body);
    }
    return;
  }

  if (req.method === "POST" && ["/api/mesh", "/api/solve", "/api/convergence"].includes(route)) {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const out = handleApi(route, body);
      sendJson(res, out.status, out.body);
    } catch (e) {
      const { status, body } = mapError(e);
      sendJson(res, status, body);
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "方法不允许", code: "METHOD_NOT_ALLOWED" });
});

server.listen(PORT, () => {
  console.log(`[fem2d-server] 监听 http://0.0.0.0:${PORT}`);
  console.log(`[fem2d-server] 前端静态目录：${WEB_DIST}`);
});

// 供测试/编程式使用
export { instantiatePreset };
