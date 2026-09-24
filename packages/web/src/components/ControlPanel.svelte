<script lang="ts">
  import { state, update, invalidateResult } from "../lib/store";

  const fieldLabels: Array<{ id: "sx" | "sy" | "ty" | "vonMises"; label: string }> = [
    { id: "sx", label: "σx 正应力" },
    { id: "sy", label: "σy 正应力" },
    { id: "ty", label: "τxy 剪应力" },
    { id: "vonMises", label: "von Mises" },
  ];

  function setMode(mode: "stress" | "strain") {
    update({ material: { ...$state.material, mode } });
    invalidateResult();
  }
  function setMat(patch: Partial<typeof $state.material>) {
    update({ material: { ...$state.material, ...patch } });
    invalidateResult();
  }
</script>

<div class="panel">
  <h3>材料本构</h3>
  <div class="seg">
    <button class:active={$state.material.mode === "stress"} on:click={() => setMode("stress")}>
      平面应力
    </button>
    <button class:active={$state.material.mode === "strain"} on:click={() => setMode("strain")}>
      平面应变
    </button>
  </div>
  <label>
    弹性模量 E（Pa）
    <input
      type="number"
      step="any"
      value={$state.material.youngsModulus}
      on:change={(e) => setMat({ youngsModulus: Number(e.currentTarget.value) })}
    />
  </label>
  <label>
    泊松比 ν
    <input
      type="number"
      step="0.01"
      min="-0.9"
      max="0.49"
      value={$state.material.poissonRatio}
      on:change={(e) => setMat({ poissonRatio: Number(e.currentTarget.value) })}
    />
  </label>
  <label>
    厚度 t（m，平面应变下不影响结果）
    <input
      type="number"
      step="any"
      value={$state.material.thickness}
      on:change={(e) => setMat({ thickness: Number(e.currentTarget.value) })}
    />
  </label>

  <h3>网格疏密</h3>
  <label class="seed">
    全局种子间距 h = <b>{$state.seedSize.toFixed(3)}</b> m
    <input
      type="range"
      min="0.01"
      max="0.3"
      step="0.005"
      value={$state.seedSize}
      on:input={(e) => update({ seedSize: Number(e.currentTarget.value) })}
    />
  </label>

  {#if $state.meshStats}
    <div class="stats">
      <div><span>节点数</span><b>{$state.meshStats.nodeCount}</b></div>
      <div><span>单元数</span><b>{$state.meshStats.elementCount}</b></div>
      <div><span>最小内角</span><b>{$state.meshStats.minAngleDeg.toFixed(1)}°</b></div>
      <div><span>最大内角</span><b>{$state.meshStats.maxAngleDeg.toFixed(1)}°</b></div>
      <div><span>平均质量</span><b>{$state.meshStats.avgQuality.toFixed(3)}</b></div>
    </div>
  {/if}

  <h3>后处理</h3>
  <div class="field-grid">
    {#each fieldLabels as f}
      <button class:active={$state.field === f.id} on:click={() => update({ field: f.id })}>
        {f.label}
      </button>
    {/each}
  </div>
  <label class="check">
    <input
      type="checkbox"
      checked={$state.autoDeformation}
      on:change={(e) => update({ autoDeformation: e.currentTarget.checked })}
    />
    自动变形放大（约 10% 几何尺寸）
  </label>
  {#if !$state.autoDeformation}
    <label>
      放大系数
      <input
        type="number"
        step="any"
        value={$state.deformationScale}
        on:input={(e) => update({ deformationScale: Number(e.currentTarget.value) })}
      />
    </label>
  {/if}
  <div class="toggles">
    <label class="check"><input type="checkbox" checked={$state.showMesh} on:change={(e) => update({ showMesh: e.currentTarget.checked })} /> 网格</label>
    <label class="check"><input type="checkbox" checked={$state.showDeformed} on:change={(e) => update({ showDeformed: e.currentTarget.checked })} /> 变形</label>
    <label class="check"><input type="checkbox" checked={$state.showContour} on:change={(e) => update({ showContour: e.currentTarget.checked })} /> 云图</label>
    <label class="check"><input type="checkbox" checked={$state.showSymbols} on:change={(e) => update({ showSymbols: e.currentTarget.checked })} /> 符号</label>
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 10px 0 2px; font-size: 12px; color: #7dd3fc; text-transform: uppercase; letter-spacing: 0.05em; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #cbd5e1; }
  input[type="number"] {
    background: #0f172a; border: 1px solid #334155; color: #e2e8f0;
    border-radius: 5px; padding: 5px 7px; font-size: 12px;
  }
  .seg { display: flex; gap: 0; border: 1px solid #334155; border-radius: 6px; overflow: hidden; }
  .seg button { flex: 1; background: #0f172a; color: #94a3b8; border: none; padding: 7px; cursor: pointer; font-size: 12px; }
  .seg button.active { background: #0369a1; color: white; }
  .seed input[type="range"] { width: 100%; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; background: #0f172a; padding: 8px 10px; border-radius: 6px; border: 1px solid #1e293b; }
  .stats div { display: flex; justify-content: space-between; font-size: 12px; }
  .stats span { color: #94a3b8; }
  .stats b { color: #e2e8f0; }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
  .field-grid button { background: #0f172a; border: 1px solid #334155; color: #cbd5e1; border-radius: 5px; padding: 6px; cursor: pointer; font-size: 12px; }
  .field-grid button.active { background: #7c2d12; border-color: #fb923c; color: #fff; }
  .check { flex-direction: row; align-items: center; gap: 6px; }
  .toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
</style>
