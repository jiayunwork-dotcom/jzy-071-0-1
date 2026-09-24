<script lang="ts">
  import { materializeBCs, type ExamplePreset } from "@fem2d/core";
  import { api } from "../lib/api";
  import { state, update } from "../lib/store";
  import { engineering } from "../lib/colormap";

  let examples: ExamplePreset[] = [];
  let loaded: string | null = null;

  api
    .examples()
    .then((r) => (examples = r.examples as unknown as ExamplePreset[]))
    .catch(() => (examples = []));

  async function load(ex: ExamplePreset) {
    update({ busy: "example", error: null });
    try {
      const seedSize = Math.min(...ex.convergenceSeeds);
      const meshRes = await api.mesh({ loops: ex.loops!, seedSize, smoothing: 20 });
      const { supports, loads } = materializeBCs(ex, meshRes.mesh);
      update({
        loops: ex.loops!,
        drawing: [],
        mesh: meshRes.mesh,
        meshStats: meshRes.stats,
        material: ex.material,
        supports,
        loads,
        result: null,
        convergence: null,
        unstableNodes: [],
        seedSize,
      });
      loaded = ex.id;
    } catch (e) {
      update({ error: (e as Error).message });
    } finally {
      update({ busy: null });
    }
  }
</script>

<div class="panel">
  <h3>内置标准算例</h3>
  {#each examples as ex}
    <button class="example" class:active={loaded === ex.id} on:click={() => load(ex)}>
      <b>{ex.name}</b>
      <span>{ex.description}</span>
    </button>
  {/each}

  {#if loaded}
    {@const ex = examples.find((e) => e.id === loaded)}
    {#if ex}
      <div class="ref">
        <h4>参考解（理论）</h4>
        {#if ex.reference.tipDeflection}
          <div>
            端部位移 <code>{ex.reference.tipDeflection.formula}</code><br />
            = {engineering(ex.reference.tipDeflection.value)} m
          </div>
        {/if}
        {#if ex.reference.maxBendingStress}
          <div>
            特征应力 <code>{ex.reference.maxBendingStress.formula}</code><br />
            = {engineering(ex.reference.maxBendingStress.value)} Pa
          </div>
        {/if}
        <p>{ex.reference.note}</p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 7px; }
  h3 { margin: 10px 0 2px; font-size: 12px; color: #7dd3fc; text-transform: uppercase; }
  .example {
    text-align: left; display: flex; flex-direction: column; gap: 3px;
    background: #0f172a; border: 1px solid #334155; border-radius: 6px;
    padding: 8px 10px; cursor: pointer; color: #cbd5e1;
  }
  .example:hover { border-color: #38bdf8; }
  .example.active { border-color: #38bdf8; background: #082f49; }
  .example b { font-size: 13px; color: #e2e8f0; }
  .example span { font-size: 11px; color: #94a3b8; }
  .ref { background: #1c1917; border: 1px solid #57534e; border-radius: 6px; padding: 8px 10px; font-size: 11px; color: #d6d3d1; }
  .ref h4 { margin: 0 0 5px; color: #fbbf24; font-size: 11px; }
  .ref div { margin-bottom: 6px; line-height: 1.5; }
  .ref code { color: #7dd3fc; font-size: 10px; }
  .ref p { margin: 6px 0 0; color: #a8a29e; line-height: 1.5; }
</style>
