<script lang="ts">
  import { templateLoops, type TemplateKind, type TemplateParams } from "@fem2d/core";
  import { state, update, generate } from "../lib/store";

  let kind: TemplateKind = "rectangle";
  let length = 2, height = 0.4;
  let width = 1, thickness = 0.3;
  let plateWidth = 1, plateHeight = 1, holeRadius = 0.15;

  function applyTemplate() {
    let params: TemplateParams;
    if (kind === "rectangle") params = { kind, length, height };
    else if (kind === "lbeam") params = { kind, width, thickness };
    else params = { kind, plateWidth, plateHeight, holeRadius };
    const loops = templateLoops(params);
    update({
      loops,
      drawing: [],
      seedSize: kind === "rectangle" ? Math.min(0.1, height / 4) : $state.seedSize,
    });
    void generate(loops);
  }
</script>

<div class="panel">
  <h3>参数化模板</h3>
  <div class="seg">
    <button class:active={kind === "rectangle"} on:click={() => (kind = "rectangle")}>矩形梁</button>
    <button class:active={kind === "lbeam"} on:click={() => (kind = "lbeam")}>L 形</button>
    <button class:active={kind === "holePlate"} on:click={() => (kind = "holePlate")}>带孔板</button>
  </div>

  {#if kind === "rectangle"}
    <label>长 L（m）<input type="number" step="any" bind:value={length} /></label>
    <label>高 H（m）<input type="number" step="any" bind:value={height} /></label>
  {:else if kind === "lbeam"}
    <label>外宽 W（m）<input type="number" step="any" bind:value={width} /></label>
    <label>壁厚 t（m）<input type="number" step="any" bind:value={thickness} /></label>
  {:else}
    <label>板宽（m）<input type="number" step="any" bind:value={plateWidth} /></label>
    <label>板高（m）<input type="number" step="any" bind:value={plateHeight} /></label>
    <label>孔半径（m）<input type="number" step="any" bind:value={holeRadius} /></label>
  {/if}

  <button class="go" on:click={applyTemplate}>生成模板几何并剖分</button>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 7px; }
  h3 { margin: 10px 0 2px; font-size: 12px; color: #7dd3fc; text-transform: uppercase; }
  .seg { display: flex; border: 1px solid #334155; border-radius: 6px; overflow: hidden; }
  .seg button { flex: 1; background: #0f172a; color: #94a3b8; border: none; padding: 6px; cursor: pointer; font-size: 12px; }
  .seg button.active { background: #0369a1; color: white; }
  label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #cbd5e1; }
  input { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 5px; padding: 5px 7px; }
  .go { background: #065f46; border: 1px solid #10b981; color: #d1fae5; border-radius: 6px; padding: 8px; cursor: pointer; font-size: 13px; }
  .go:hover { background: #047857; }
</style>
