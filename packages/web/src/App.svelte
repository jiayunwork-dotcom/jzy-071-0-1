<script lang="ts">
  import Toolbar from "./components/Toolbar.svelte";
  import FEMCanvas from "./components/FEMCanvas.svelte";
  import ControlPanel from "./components/ControlPanel.svelte";
  import ResultsPanel from "./components/ResultsPanel.svelte";
  import TemplatesPanel from "./components/TemplatesPanel.svelte";
  import ExamplesPanel from "./components/ExamplesPanel.svelte";
  import { state } from "./lib/store";
</script>

<div class="app">
  <Toolbar />
  <div class="body">
    <aside class="left">
      <TemplatesPanel />
      <ExamplesPanel />
    </aside>
    <main class="center">
      <FEMCanvas />
      {#if $state.busy}
        <div class="busy-overlay">{$state.busy === "mesh" ? "正在剖分网格…" : $state.busy === "solve" ? "正在装配与求解…" : $state.busy === "convergence" ? "网格无关性批量求解…" : "处理中…"}</div>
      {/if}
    </main>
    <aside class="right">
      <ControlPanel />
      <ResultsPanel />
    </aside>
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: #0f1420;
    color: #e2e8f0;
    font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    overflow: hidden;
  }
  .body { display: flex; flex: 1; min-height: 0; }
  aside {
    width: 290px;
    min-width: 290px;
    overflow-y: auto;
    padding: 10px 12px;
    background: #0b1220;
    border-right: 1px solid #1e293b;
  }
  .right { border-right: none; border-left: 1px solid #1e293b; }
  aside.right { width: 310px; min-width: 310px; }
  .center { flex: 1; position: relative; min-width: 0; }
  .busy-overlay {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    background: rgba(3, 105, 161, 0.92); color: white; padding: 7px 16px;
    border-radius: 20px; font-size: 13px; pointer-events: none;
  }
</style>
