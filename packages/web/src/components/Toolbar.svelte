<script lang="ts">
  import { state, update, clearAll } from "../lib/store";
  import type { Tool } from "../lib/store";

  const tools: Array<{ id: Tool; label: string; title: string }> = [
    { id: "draw", label: "✏️ 画多边形", title: "逐点点击勾勒封闭区域" },
    { id: "drag", label: "✥ 拖顶点", title: "拖动多边形顶点微调" },
    { id: "fixed", label: "🔺 固定", title: "固定支座（ux=uy=0）" },
    { id: "rollerX", label: "═→ 水平滑", title: "沿 x 方向滚动（uy=0）" },
    { id: "rollerY", label: "∥ 竖直滑", title: "沿 y 方向滚动（ux=0）" },
    { id: "load", label: "➡ 加力", title: "在节点施加集中力" },
    { id: "inspect", label: "🔍 查看", title: "点选节点查看位移/应力" },
  ];
</script>

<div class="toolbar">
  <div class="brand">
    <span class="logo">FEM2D</span>
    <span class="sub">二维有限元静力分析教学工具</span>
  </div>
  <div class="tools">
    {#each tools as t}
      <button
        class="tool"
        class:active={$state.tool === t.id}
        title={t.title}
        on:click={() => update({ tool: t.id })}
      >
        {t.label}
      </button>
    {/each}
  </div>
  <button class="clear" on:click={clearAll}>清空重来</button>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    background: #0b1220;
    border-bottom: 1px solid #1e293b;
    flex-wrap: wrap;
  }
  .brand { display: flex; align-items: baseline; gap: 8px; }
  .logo { font-weight: 700; color: #38bdf8; font-size: 18px; letter-spacing: 0.04em; }
  .sub { color: #64748b; font-size: 12px; }
  .tools { display: flex; gap: 4px; flex-wrap: wrap; }
  .tool {
    background: #0f172a; border: 1px solid #334155; color: #cbd5e1;
    border-radius: 6px; padding: 6px 9px; cursor: pointer; font-size: 12px;
  }
  .tool:hover { border-color: #38bdf8; }
  .tool.active { background: #0369a1; border-color: #38bdf8; color: #fff; }
  .clear { margin-left: auto; background: #1c1917; border: 1px solid #7f1d1d; color: #fca5a5; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
</style>
