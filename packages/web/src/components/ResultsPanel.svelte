<script lang="ts">
  import { state, update, runSolve, runConvergence, removeSupportAtNode, removeLoadAtNode } from "../lib/store";
  import { colorMap, rgbCss, engineering } from "../lib/colormap";

  let customSeeds = "0.1, 0.067, 0.05, 0.033, 0.025";

  const fieldName: Record<string, string> = {
    sx: "σx",
    sy: "σy",
    ty: "τxy",
    vonMises: "von Mises",
  };

  $: result = $state.result;
  $: mesh = $state.mesh;

  // 当前云图值范围（节点平均应力）
  $: fieldRange = (() => {
    if (!result) return { min: 0, max: 1 };
    const vals = result.nodalStresses.map((n) => n[$state.field]);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  })();

  $: supportCount = $state.supports.length;
  $: loadCount = $state.loads.length;

  async function doConvergence() {
    const seeds = customSeeds
      .split(/[\s,]+/)
      .map((s) => Number(s.trim()))
      .filter((x) => x > 0)
      .sort((a, b) => b - a);
    if (seeds.length < 2) {
      update({ error: "请输入至少 2 个由大到小的种子间距，用逗号分隔" });
      return;
    }
    await runConvergence(seeds);
  }

  $: convPoints = ($state.convergence ?? []).map((p) => p);
  void convPoints;
</script>

<div class="panel">
  <div class="load-input">
    <h3>载荷输入（在「加力」工具下点击节点）</h3>
    <div class="row">
      <label>fx (N)
        <input
          type="number"
          step="any"
          value={$state.draftLoad.fx}
          on:change={(e) => update({ draftLoad: { ...$state.draftLoad, fx: Number(e.currentTarget.value) } })}
        />
      </label>
      <label>fy (N)
        <input
          type="number"
          step="any"
          value={$state.draftLoad.fy}
          on:change={(e) => update({ draftLoad: { ...$state.draftLoad, fy: Number(e.currentTarget.value) } })}
        />
      </label>
    </div>
    <label class="check body">
      <input
        type="checkbox"
        checked={$state.useBodyForce}
        on:change={(e) => update({ useBodyForce: e.currentTarget.checked })}
      />
      全域体力（如重力）
    </label>
    {#if $state.useBodyForce}
      <div class="row">
        <label>bx (N/m³)
          <input type="number" step="any" value={$state.bodyForce.bx}
            on:change={(e) => update({ bodyForce: { ...$state.bodyForce, bx: Number(e.currentTarget.value) } })} />
        </label>
        <label>by (N/m³)
          <input type="number" step="any" value={$state.bodyForce.by}
            on:change={(e) => update({ bodyForce: { ...$state.bodyForce, by: Number(e.currentTarget.value) } })} />
        </label>
      </div>
    {/if}
  </div>

  <div class="counts">
    <span>支座 <b>{supportCount}</b></span>
    <span>集中力 <b>{loadCount}</b></span>
  </div>

  <button class="solve" disabled={!mesh || !!$state.busy} on:click={runSolve}>
    {$state.busy === "solve" ? "求解中…" : "▶ 求解 Ku = F"}
  </button>

  {#if $state.error}
    <div class="error">
      <b>求解失败</b>
      <p>{$state.error}</p>
    </div>
  {/if}

  {#if result}
    <h3>结果摘要</h3>
    <div class="results">
      <div><span>最大位移</span><b>{engineering(result.maxDisplacement.value)} m</b></div>
      <div><span>最大 von Mises</span><b>{engineering(result.maxVonMises.value)} Pa</b></div>
      <div><span>自由度数</span><b>{result.freeDofCount}</b></div>
      <div class="balance"><span>支座反力合力</span>
        <b>Σfx={engineering(result.reactions.reduce((s, r) => s + r.fx, 0))} N，
           Σfy={engineering(result.reactions.reduce((s, r) => s + r.fy, 0))} N</b>
      </div>
    </div>

    {#if $state.selectedNode !== null && mesh}
      {@const n = $state.selectedNode}
      <div class="nodeinfo">
        <h4>节点 #{n} （{mesh.nodes[n].map((x) => x.toFixed(3)).join(", ")}）</h4>
        <div>位移 ux={engineering(result.displacements[n][0])} m，uy={engineering(result.displacements[n][1])} m</div>
        <div>节点应力 σx={engineering(result.nodalStresses[n].sx)} Pa，σy={engineering(result.nodalStresses[n].sy)} Pa，τ={engineering(result.nodalStresses[n].ty)} Pa</div>
        {#if $state.supports.some((s) => s.node === n)}
          <button class="mini" on:click={() => removeSupportAtNode(n)}>删除该节点支座</button>
        {/if}
        {#if $state.loads.some((l) => l.node === n)}
          <button class="mini" on:click={() => removeLoadAtNode(n)}>删除该节点载荷</button>
        {/if}
      </div>
    {/if}

    <h3>云图图例 · {fieldName[$state.field]}（Pa）</h3>
    <div class="legend">
      <div class="bar"></div>
      <div class="ticks">
        <span>{engineering(fieldRange.min)}</span>
        <span>{engineering((fieldRange.min + fieldRange.max) / 2)}</span>
        <span>{engineering(fieldRange.max)}</span>
      </div>
    </div>
  {/if}

  <h3>网格无关性验证</h3>
  <label class="seeds">种子间距序列（m，由疏到密）
    <input type="text" bind:value={customSeeds} />
  </label>
  <button class="conv" disabled={!mesh || !!$state.busy} on:click={doConvergence}>
    {$state.busy === "convergence" ? "批量求解中…" : "运行多密度求解并绘制收敛曲线"}
  </button>

  {#if $state.convergence && $state.convergence.length > 1}
    {@const pts = $state.convergence}
    {@const maxVM = Math.max(...pts.map((p) => p.maxVonMises))}
    {@const minVM = Math.min(...pts.map((p) => p.maxVonMises))}
    {@const maxN = Math.max(...pts.map((p) => p.elementCount))}
    <svg viewBox="0 0 260 150" class="chart">
      {#each pts as p, i}
        {@const x = 30 + (p.elementCount / maxN) * 215}
        {@const y = 130 - ((p.maxVonMises - minVM) / Math.max(1e-30, maxVM - minVM)) * 110}
        {#if i > 0}
          {@const p0 = pts[i - 1]}
          {@const x0 = 30 + (p0.elementCount / maxN) * 215}
          {@const y0 = 130 - ((p0.maxVonMises - minVM) / Math.max(1e-30, maxVM - minVM)) * 110}
          <line x1={x0} y1={y0} x2={x} y2={y} stroke="#38bdf8" stroke-width="1.5" />
        {/if}
        <circle cx={x} cy={y} r="3" fill="#fbbf24" />
        <text x={x} y="144" font-size="7" fill="#94a3b8" text-anchor="middle">{p.elementCount}</text>
      {/each}
      <line x1="30" y1="130" x2="250" y2="130" stroke="#475569" />
      <line x1="30" y1="20" x2="30" y2="130" stroke="#475569" />
      <text x="140" y="12" font-size="8" fill="#cbd5e1" text-anchor="middle">单元数 → 最大 von Mises 应力（Pa）</text>
    </svg>
    <table class="conv-table">
      <tr><th>单元数</th><th>最大位移(m)</th><th>最大应力(Pa)</th></tr>
      {#each pts as p}
        <tr><td>{p.elementCount}</td><td>{engineering(p.maxAbsDisplacement)}</td><td>{engineering(p.maxVonMises)}</td></tr>
      {/each}
    </table>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 7px; }
  h3 { margin: 10px 0 2px; font-size: 12px; color: #7dd3fc; text-transform: uppercase; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: #cbd5e1; }
  input { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 5px; padding: 5px 7px; font-size: 12px; }
  .check { flex-direction: row; align-items: center; gap: 6px; }
  .counts { display: flex; gap: 16px; font-size: 12px; color: #94a3b8; }
  .counts b { color: #e2e8f0; }
  .solve { background: #1d4ed8; border: 1px solid #3b82f6; color: white; border-radius: 6px; padding: 10px; cursor: pointer; font-size: 14px; font-weight: 600; }
  .solve:hover { background: #2563eb; }
  .solve:disabled { opacity: 0.5; cursor: not-allowed; }
  .conv { background: #0f172a; border: 1px solid #38bdf8; color: #7dd3fc; border-radius: 6px; padding: 8px; cursor: pointer; font-size: 12px; }
  .conv:disabled { opacity: 0.5; }
  .error { background: #450a0a; border: 1px solid #ef4444; color: #fecaca; border-radius: 6px; padding: 8px 10px; font-size: 12px; }
  .error p { margin: 4px 0 0; line-height: 1.5; }
  .results { display: flex; flex-direction: column; gap: 4px; background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 8px 10px; }
  .results div { display: flex; justify-content: space-between; font-size: 12px; gap: 8px; }
  .results span { color: #94a3b8; }
  .results b { color: #e2e8f0; text-align: right; }
  .balance { flex-direction: column; }
  .nodeinfo { background: #082f49; border: 1px solid #0369a1; border-radius: 6px; padding: 8px 10px; font-size: 11px; color: #bae6fd; display: flex; flex-direction: column; gap: 3px; }
  .nodeinfo h4 { margin: 0; font-size: 12px; }
  .mini { margin-top: 4px; background: transparent; border: 1px solid #f87171; color: #fca5a5; border-radius: 4px; padding: 3px 6px; cursor: pointer; font-size: 11px; align-self: flex-start; }
  .legend .bar {
    height: 12px; border-radius: 3px;
    background: linear-gradient(to right,
      rgb(48,18,59), rgb(32,90,170), rgb(20,190,200),
      rgb(80,210,90), rgb(240,210,40), rgb(235,110,30), rgb(150,20,20));
  }
  .legend .ticks { display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; margin-top: 2px; }
  .seeds input { margin-top: 3px; }
  .chart { background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; width: 100%; }
  .conv-table { width: 100%; border-collapse: collapse; font-size: 10px; color: #cbd5e1; }
  .conv-table th, .conv-table td { border: 1px solid #1e293b; padding: 3px 4px; text-align: right; }
  .conv-table th { color: #7dd3fc; }
</style>
