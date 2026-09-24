<script lang="ts">
  import { onMount } from "svelte";
  import type { Vec2 } from "@fem2d/core";
  import { state, activeLoops, domainBBox, update, applyToolAtNode, generate, invalidateResult } from "../lib/store";
  import { ViewTransform } from "../lib/view";
  import { colorMap, rgbCss } from "../lib/colormap";

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  const view = new ViewTransform();
  let hover: Vec2 | null = null;
  let dragVertex: { loop: number; index: number } | null = null;
  let mouseDown: { x: number; y: number } | null = null;
  let fitted = false;

  $: loops = $activeLoops;
  $: bbox = $domainBBox;

  // 几何变化后自适应视图（仅在首次或清空时）
  $: if (loops.length > 0 && loops[0].length > 0 && canvas && !fitted) {
    requestAnimationFrame(() => doFit());
  }
  $: if (loops.length === 0) fitted = false;

  function doFit() {
    if (!canvas) return;
    view.fit(bbox, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
    fitted = true;
    draw();
  }

  function resize() {
    if (!canvas || !wrap) return;
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function worldFromEvent(e: MouseEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    return view.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  const HIT_PX = 9;

  function hitVertexAt(w: Vec2): { loop: number; index: number } | null {
    const all = $state.loops;
    for (let li = 0; li < all.length; li++) {
      for (let i = 0; i < all[li].length; i++) {
        if (Math.hypot(w[0] - all[li][i][0], w[1] - all[li][i][1]) * view.scale < HIT_PX) {
          return { loop: li, index: i };
        }
      }
    }
    return null;
  }

  function hitNode(w: Vec2): number | null {
    const mesh = $state.mesh;
    if (!mesh) return null;
    let best = -1, bd = Infinity;
    mesh.nodes.forEach((p, i) => {
      const d = Math.hypot(p[0] - w[0], p[1] - w[1]);
      if (d < bd) { bd = d; best = i; }
    });
    return bd * view.scale < HIT_PX ? best : null;
  }

  function onMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    hover = worldFromEvent(e);

    if (dragVertex) {
      const w = hover;
      const next = $state.loops.map((loop) => loop.map((p) => [...p] as Vec2));
      next[dragVertex.loop][dragVertex.index] = [w[0], w[1]];
      update({ loops: next });
      invalidateResult();
    }
    draw();
  }

  function onDown(e: MouseEvent) {
    mouseDown = { x: e.clientX, y: e.clientY };
    if ($state.tool === "drag") {
      const hv = hitVertexAt(worldFromEvent(e));
      if (hv) {
        dragVertex = hv;
        e.preventDefault();
      }
    }
  }

  function onUp(e: MouseEvent) {
    dragVertex = null;
    if (!mouseDown) return;
    const moved = Math.hypot(e.clientX - mouseDown.x, e.clientY - mouseDown.y);
    mouseDown = null;
    if (moved > 5) return; // 是拖拽，不算点击

    const w = worldFromEvent(e);

    if ($state.tool === "draw") {
      // 点击靠近第一个点 => 闭合
      const d = $state.drawing;
      if (d.length >= 3) {
        if (Math.hypot(w[0] - d[0][0], w[1] - d[1][1]) * view.scale < HIT_PX + 2) {
          void generate([d]);
          return;
        }
      }
      update({ drawing: [...d, w] });
      draw();
      return;
    }

    const node = hitNode(w);
    if (node !== null) applyToolAtNode(node);
    draw();
  }

  function onDblClick() {
    // 双击在绘制模式下也闭合
    if ($state.tool === "draw" && $state.drawing.length >= 3) {
      void generate([$state.drawing]);
    }
  }

  // 滚轮缩放（以光标为中心）
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const before = view.toWorld(mx, my);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.scale *= factor;
    view.ox = mx - before[0] * view.scale;
    view.oy = my + before[1] * view.scale;
    draw();
  }

  function undoPoint() {
    if ($state.drawing.length > 0) update({ drawing: $state.drawing.slice(0, -1) });
    draw();
  }

  // ---------- 渲染 ----------
  function draw() {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0f1420";
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H);

    const s = $state;

    // 应力云图（变形后的单元）
    if (s.result && s.showContour) drawContour(ctx);

    // 网格线（原始 + 变形）
    if (s.mesh && s.showMesh) drawMesh(ctx, false, "rgba(148,163,184,0.55)", 0.6);
    if (s.mesh && s.result && s.showDeformed) drawMesh(ctx, true, "rgba(251,191,36,0.95)", 1.2);

    // 编辑中的多边形
    drawLoops(ctx);

    // 支座/载荷符号
    if (s.mesh && s.showSymbols) {
      drawSupports(ctx);
      drawLoads(ctx);
    }

    // 不稳定节点高亮（奇异诊断）
    if (s.unstableNodes.length && s.mesh) {
      for (const n of s.unstableNodes) {
        const [x, y] = view.toPixel(s.mesh.nodes[n]);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // 选中节点
    if (s.selectedNode !== null && s.mesh) {
      const [x, y] = view.toPixel(s.mesh.nodes[s.selectedNode]);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 悬停提示点
    if (hover && s.tool === "draw" && s.drawing.length > 0) {
      const [fx, fy] = view.toPixel(s.drawing[0]);
      if (Math.hypot(hover[0] - s.drawing[0][0], hover[1] - s.drawing[0][1]) * view.scale < 14) {
        ctx.beginPath();
        ctx.arc(fx, fy, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "#34d399";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
    // 简易坐标十字
    const [ox, oy] = view.toPixel([0, 0]);
    ctx.strokeStyle = "rgba(100,116,139,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ox > 0 && ox < W) { ctx.moveTo(ox, 0); ctx.lineTo(ox, H); }
    if (oy > 0 && oy < H) { ctx.moveTo(0, oy); ctx.lineTo(W, oy); }
    ctx.stroke();
  }

  function deformedNode(node: number): Vec2 {
    const s = $state;
    const p = s.mesh!.nodes[node];
    if (!s.result) return p;
    const u = s.result.displacements[node];
    const amp = currentScale();
    return [p[0] + u[0] * amp, p[1] + u[1] * amp];
  }

  let _autoAmp = 1;
  function currentScale(): number {
    const s = $state;
    if (s.autoDeformation && s.result && s.mesh) {
      const maxU = s.result.maxDisplacement.value;
      const b = $domainBBox;
      const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      _autoAmp = maxU > 0 ? 0.1 * span / maxU : 1;
      return _autoAmp;
    }
    return s.deformationScale;
  }

  function drawContour(ctx: CanvasRenderingContext2D) {
    const s = $state;
    const mesh = s.mesh!;
    const result = s.result!;
    // 用节点平均应力做逐顶点插值（CST 内线性），跨单元连续
    const vals = result.nodalStresses.map((n) => n[s.field]);
    let vmin = Infinity, vmax = -Infinity;
    for (const v of vals) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    if (vmax - vmin < 1e-30) { vmin -= 1; vmax += 1; }
    for (const t of mesh.elements) {
      const pts = [deformedNode(t[0]), deformedNode(t[1]), deformedNode(t[2])];
      const vs = [vals[t[0]], vals[t[1]], vals[t[2]]];
      // 用重心平均色（CST 单元应力本为常数，节点平均后用中心值即可，平滑且稳定）
      const meanV = (vs[0] + vs[1] + vs[2]) / 3;
      const tt = (meanV - vmin) / (vmax - vmin);
      ctx.beginPath();
      const [x0, y0] = view.toPixel(pts[0]);
      ctx.moveTo(x0, y0);
      for (let k = 1; k < 3; k++) {
        const [x, y] = view.toPixel(pts[k]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = rgbCss(colorMap(tt), 0.92);
      ctx.fill();
    }
  }

  function drawMesh(ctx: CanvasRenderingContext2D, deformed: boolean, color: string, lw: number) {
    const mesh = $state.mesh!;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    const P = (n: number) => view.toPixel(deformed ? deformedNode(n) : mesh.nodes[n]);
    for (const t of mesh.elements) {
      const [x0, y0] = P(t[0]);
      const [x1, y1] = P(t[1]);
      const [x2, y2] = P(t[2]);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
    }
    ctx.stroke();
  }

  function drawLoops(ctx: CanvasRenderingContext2D) {
    const s = $state;
    if (s.drawing.length > 0) {
      const d = s.drawing;
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      d.forEach((p, i) => {
        const [x, y] = view.toPixel(p);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      d.forEach((p, i) => {
        const [x, y] = view.toPixel(p);
        ctx.beginPath();
        ctx.arc(x, y, i === 0 ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 && d.length >= 3 ? "#34d399" : "#38bdf8";
        ctx.fill();
      });
    } else if (s.loops.length > 0 && !s.mesh) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.6;
      for (const loop of s.loops) {
        ctx.beginPath();
        loop.forEach((p, i) => {
          const [x, y] = view.toPixel(p);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
        loop.forEach((p) => {
          const [x, y] = view.toPixel(p);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#38bdf8";
          ctx.fill();
        });
      }
    }
    // 拖动模式下显示模板顶点把手
    if (s.tool === "drag" && s.loops.length > 0) {
      for (const loop of s.loops) {
        for (const p of loop) {
          const [x, y] = view.toPixel(p);
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "#fbbf24";
          ctx.fill();
        }
      }
    }
  }

  function drawSupports(ctx: CanvasRenderingContext2D) {
    const s = $state;
    for (const sup of s.supports) {
      const [x, y] = view.toPixel(deformedNode(sup.node));
      if (sup.type === "fixed") {
        // 固定：填充三角形 + 斜线地基
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 9, y + 11);
        ctx.lineTo(x + 9, y + 11);
        ctx.closePath();
        ctx.fillStyle = "#f472b6";
        ctx.fill();
        ctx.strokeStyle = "#f9a8d4";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (sup.type === "rollerX") {
        // 沿 x 滚：uy=0，画水平地基 + 滚轮
        drawRoller(ctx, x, y, true);
      } else {
        drawRoller(ctx, x, y, false);
      }
    }
  }

  function drawRoller(ctx: CanvasRenderingContext2D, x: number, y: number, horizontal: boolean) {
    ctx.fillStyle = "#a78bfa";
    ctx.strokeStyle = "#ddd6fe";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (horizontal) {
      ctx.beginPath(); ctx.arc(x - 5, y + 7, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 5, y + 7, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 9, y + 10); ctx.lineTo(x + 9, y + 10); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x - 8, y - 4, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x - 8, y + 4, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 11, y - 8); ctx.lineTo(x - 11, y + 8); ctx.stroke();
    }
  }

  function drawLoads(ctx: CanvasRenderingContext2D) {
    const s = $state;
    if (s.loads.length === 0) return;
    const maxF = Math.max(...s.loads.map((l) => Math.hypot(l.fx, l.fy)), 1);
    const refLen = 46; // 最大力箭头像素长度
    for (const l of s.loads) {
      const [x, y] = view.toPixel(deformedNode(l.node));
      const mag = Math.hypot(l.fx, l.fy);
      if (mag < 1e-12) continue;
      const len = refLen * Math.sqrt(mag / maxF);
      const ux = l.fx / mag, uy = -l.fy / mag; // 屏幕 y 翻转
      const ex = x + ux * len, ey = y + uy * len;
      ctx.strokeStyle = "#fb7185";
      ctx.fillStyle = "#fb7185";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // 箭头
      const ang = Math.atan2(ey - y, ex - x);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 8 * Math.cos(ang - 0.4), ey - 8 * Math.sin(ang - 0.4));
      ctx.lineTo(ex - 8 * Math.cos(ang + 0.4), ey - 8 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
    }
  }

  // 订阅 store 变化重绘
  import { afterUpdate } from "svelte";
  state.subscribe(() => afterUpdate(draw));
  activeLoops.subscribe(() => afterUpdate(draw));

  onMount(() => {
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  export { doFit, undoPoint };
</script>

<div class="canvas-wrap" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    on:mousemove={onMove}
    on:mousedown={onDown}
    on:mouseup={onUp}
    on:dblclick={onDblClick}
    on:wheel={onWheel}
    aria-label="有限元画布"
  ></canvas>
  {#if $state.tool === "draw"}
    <div class="hint">
      逐点点击勾勒多边形，点击首点或双击闭合 ·
      <button on:click={undoPoint}>撤销点</button>
    </div>
  {/if}
</div>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  canvas {
    display: block;
    cursor: crosshair;
  }
  .hint {
    position: absolute;
    left: 12px;
    bottom: 12px;
    background: rgba(15, 23, 42, 0.82);
    color: #cbd5e1;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(148, 163, 184, 0.25);
  }
  .hint button {
    background: transparent;
    color: #7dd3fc;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    font-size: 12px;
  }
</style>
