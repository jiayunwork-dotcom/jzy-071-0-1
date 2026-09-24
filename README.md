# FEM2D · 浏览器内二维有限元静力分析教学工具

一个前后端一体的 Web 应用，用于教学二维线弹性有限元：在画布上画出平面结构 →
Delaunay 三角剖分 → 施加约束与载荷 → 求解位移 → 观察应力云图，并做网格无关性验证。
聚焦 **平面应力 / 平面应变** 下的三节点线性三角形单元（CST）静力分析。

---

## 它能做什么

- **几何与网格**
  - 逐点点击勾勒封闭多边形，或选用参数化模板（矩形梁 / L 形 / 带圆孔板），模板顶点可拖动微调。
  - 约束 Delaunay 三角剖分（[`cdt2d`](https://www.npmjs.com/package/cdt2d)），全局种子间距可调，支持凹多边形与孔洞。
  - 输出统计：节点数、单元数、最小/最大内角、平均单元质量。
  - 网格经合法性校验：无重叠、无悬挂节点、边界完整覆盖（见 `core/src/validate.ts`）。
- **材料与边界条件**
  - 弹性模量 E、泊松比 ν（默认钢 E=210 GPa、ν=0.3）、厚度 t。
  - **平面应力 / 平面应变** 一键切换，本构矩阵 D 不同，结果随之改变。
  - 固定、沿 x / 沿 y 单向滚动支座；节点集中力；全域体力（重力）。
  - 支座与力按比例箭头/符号直观可视化；边线均布力（traction）按梯形权重等效。
- **计算内核**
  - 逐单元由三节点坐标计算面积、形函数梯度、应变矩阵 B，`Ke = t·A·Bᵀ·D·B`。
  - 按全局自由度装配整体刚度；RCM 排序 + 自研稀疏 **LDLᵀ** 求解器解 `Ku=F`。
  - 回代单元应力 σx、σy、τxy、von Mises，并做节点面积加权平均。
  - 约束不足导致刚度奇异时给出**清晰中文诊断**（刚体平移/转动模态、疑似未约束节点），不崩溃。
- **后处理与收敛**
  - 原始形状 vs 放大变形形状对照（放大系数可调或自动）。
  - σx / σy / τxy / von Mises 云图（连续渐变色带 + 数值图例）。
  - 网格无关性：同一几何用递增密度多次求解，绘制「单元数—最大应力」曲线与数据表。
- **内置可复现标准算例**
  - **悬臂梁（端部集中力）**：对照 Euler-Bernoulli 解 δ=PL³/(3EI)。
  - **单向受拉矩形板**：CST 补丁试验，内部 σx 恒为 100 MPa，端部位移 ΔL=σL/E。

---

## 目录结构（按职责拆分）

```
packages/
├── core/                 # 有限元计算内核（纯 TypeScript，可独立运行与测试）
│   └── src/
│       ├── types.ts        # 全部公共类型与前后端接口
│       ├── geometry.ts     # 向量/多边形/三角形几何、单元质量
│       ├── material.ts     # 平面应力/应变本构矩阵 D
│       ├── element.ts      # 形函数梯度、B 矩阵、单元刚度 Ke、单元应力
│       ├── solver-sparse.ts# 稀疏存储 + LDLᵀ 分解/代入
│       ├── ordering.ts     # RCM（Reverse Cuthill–McKee）带宽优化
│       ├── fem.ts          # 装配、边界条件、求解主流程、奇异诊断、应力恢复
│       ├── mesher.ts       # 边界细分 + Steiner 点 + 约束 Delaunay + 平滑 + 统计
│       ├── boundary.ts     # 边线 traction / 边线支座到节点的映射
│       ├── templates.ts    # 矩形梁 / L 形 / 带孔板参数化模板
│       ├── convergence.ts  # 网格无关性多密度求解
│       ├── validate.ts     # 网格合法性校验
│       ├── sampling.ts     # 区域应力采样（避开应力奇异点）
│       ├── presets.ts      # 标准算例（含解析参考解）
│       └── __tests__/      # node:test 自动化测试（24 个）
├── server/               # Node 后端 HTTP 服务（无 Web 框架，复用 core）
│   └── src/server.ts       # /api/mesh /api/solve /api/convergence /api/examples
└── web/                  # Svelte + TypeScript + Vite 前端
    └── src/
        ├── App.svelte
        ├── lib/            # store（状态）、api、view（坐标变换）、colormap
        └── components/     # FEMCanvas / Toolbar / ControlPanel / ResultsPanel
                            # TemplatesPanel / ExamplesPanel
```

---

## 本地运行

要求 Node.js ≥ 20。

```bash
# 1. 安装依赖（npm workspaces）
npm install

# 2. 一键构建 core / web / server
npm run build

# 3. 启动（后端同时托管前端静态产物）
npm start
# 打开 http://localhost:8080
```

### 开发模式（热更新）

```bash
npm run dev      # 并行启动 server(tsx watch, :8080) 与 vite(:5173)
# 打开 http://localhost:5173 ，/api 已代理到 8080
```

---

## 运行测试（可独立运行，不依赖前端/服务）

```bash
npm test
# 或：node --import tsx --test packages/core/src/__tests__/*.test.ts
```

测试覆盖任务书要求的正确性：

- 单个三角单元刚度矩阵**对称**、半正定；
- 单元/整体存在 3 个**刚体零能模式**（x、y 平移与平面转动）；无约束时整体刚度奇异并给出诊断；
- **悬臂梁**网格加密后最大挠度与梁理论解偏差落在合理带内（细网格 ~3%）；
- **平面应力与平面应变位移不同**（平面应变更刚）；
- 外载荷放大 k 倍，位移与应力**等比例放大**（线性）；
- 受拉板补丁试验内部 σx 恒为 100 MPa；
- 矩形 / L 形 / 带孔板网格合法性（无重叠、无悬挂、边界覆盖）；
- 体力（重力）反力平衡；边线 traction 合力正确。

---

## Docker 一键启动

```bash
docker compose up --build
# 打开 http://localhost:8080
```

多阶段构建：`node:20-bookworm-slim` 内构建前端与后端，运行镜像只含一个自包含的
`server.mjs` 与 `web/dist` 静态文件，无需保留 node_modules。
（本开发环境未安装 Docker 守护进程，故 Dockerfile 已按 Node 20 编写但未在此处实际构建。）

---

## 力学约定

- 坐标：x 向右、y 向上，单位米；应力 Pa、力 N、厚度 m。
- 自由度编号：节点 i → `(2i, 2i+1)` = `(ux, uy)`。
- `rollerX` = 仅可沿 X 移动（约束 uy）；`rollerY` = 仅可沿 Y 移动（约束 ux）。
- 平面应力 `D = E/(1-ν²)·[[1,ν,0],[ν,1,0],[0,0,(1-ν)/2]]`；
  平面应变用等效常数 `E'=E/(1-ν²)`、`ν'=ν/(1-ν)`。
- von Mises（平面）：`√(σx² − σxσy + σy² + 3τxy²)`。

> 教学提示：CST（常应变三角元）模拟纯弯偏刚（剪切闭锁），粗网格位移会偏小，
> 这正是「网格无关性验证」要展示的现象——随网格加密结果趋于梁理论值。
> 固定端角点、集中力作用点存在应力奇异性，比较特征应力时应取截面内部值。
