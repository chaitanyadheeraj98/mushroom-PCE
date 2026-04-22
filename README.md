# Mushroom PCE

Mushroom PCE is a VS Code extension that helps you understand code faster with AI explanations and an interactive Circuit Mode.

![Mushroom PCE Circuit Mode](images/feature-circuit.png)

## Key Features

- File analysis from the active editor in two modes:
  - Developer Mode: AI explanation with structured sections.
  - List Mode: deterministic static inventory (no model call).
- Symbol-aware output with clickable links (`Go To Function`).
- Blueprint Planner (plain-English feature planning workspace):
  - Planner chat that is grounded in scanned `src/` structure + known functions/exports.
  - Reuse-first planning suggestions before proposing new files/functions.
  - Generates both a structured JSON spec and a plain-text implementation prompt.
  - Saves artifacts to `docs/feature-plans/*.md`.
  - Resizable sections (`Blueprint Planner Chat`, `JSON Spec`, `Prompt Output`).
  - One-click copy buttons for chat transcript, JSON spec, and prompt output.
- Circuit Mode for architecture/runtime exploration:
  - Current File graph
  - Full Architecture graph
  - Runtime CodeFlow graph
  - Skeleton subgraph focus mode
- Node Details panel with node-scoped chat.
- Copyable AI output in Node Details (copy icons for answer/code blocks).

## AI-Enhanced Circuit Mode

- AI Insights for selected graph scope.
- AI edge suggestions overlay:
  - Dashed suggested edges
  - Confidence display
  - Apply/Reject all
  - Per-edge Apply/Reject controls
- Relation Explain workflow:
  - Dedicated HUD controls: `Set From`, `Set To`, `Explain`, `Reset`
  - Quick-pick relation state and AI explanation for the selected pair
- HUD polish:
  - Compact HUD sizing
  - Scrollable HUD cards
  - Better visibility of graph behind controls

## Circuit HUD Guide

This section explains every control visible in the Circuit Mode HUD, how they differ, and when to use each one.

### Feature-by-feature reference

| HUD feature | What it does | Difference vs similar controls | Practical use case |
|---|---|---|---|
| `Lock view` | Freezes camera interaction so pan/zoom do not change the viewport. | This does not lock graph data or selection; it only locks camera movement. | Keep the scene stable while comparing node details or writing notes. |
| `Minimize HUD` | Collapses the HUD to reduce visual footprint. | Different from `Maximize HUD`; minimize hides density, maximize increases reading area. | When you want more canvas space while inspecting graph layout. |
| `Maximize HUD` | Expands HUD cards for easier reading of details/AI text. | Different from `Minimize HUD`; this is for readability, not canvas focus. | Reviewing longer AI insights or relation explanations. |
| `View Mode: Architecture` | Layer-oriented structural view. | Focuses on module/layer topology, not runtime call/data flow ports. | System design review, boundary checks, ownership mapping. |
| `View Mode: Runtime` | Function/data-flow oriented view with ports and flow edges. | Focuses on execution and movement flow, not layered architecture grouping. | Debugging flow path, tracing function sequence, finding runtime bottlenecks. |
| `Layout: Collapse All` | Collapses architecture layers/groups. | Opposite of `Expand All`. Mostly meaningful in Architecture view. | Reduce clutter to get a macro view quickly. |
| `Layout: Expand All` | Expands all collapsed layers/groups. | Opposite of `Collapse All`. Mostly meaningful in Architecture view. | Dive back into layer internals after high-level scan. |
| `Scope: Full Architecture` | Loads project-wide architectural graph. | Broader than `Current File`; less step-focused than `CodeFlow`. | Cross-file dependency and layering analysis. |
| `Scope: Current File` | Restricts graph to active file context. | Narrowest scope; fastest and least noisy. | Local refactor, one-file deep dive, quick comprehension. |
| `Scope: CodeFlow` | Runtime-oriented step graph with codeflow edges. | More sequence/flow oriented than the other scopes. | "What happens next" analysis and path walkthroughs. |
| `Dependencies: Imports/Exports` | Shows dependency graph using import/export relations. | Structural dependency only; no call hierarchy enrichment. | Clean dependency map for architecture hygiene. |
| `Dependencies: + Call Hierarchy` | Adds call hierarchy signals on top of imports/exports. | Richer but noisier than Imports/Exports-only mode. | Impact analysis before changing shared functions. |
| `Edges: All` | Shows all eligible edges under current filters. | Broadest edge visibility. | Exploration and discovery when you need full context. |
| `Edges: API-high` | Filters to high-confidence API edges (plus key context edges). | Higher precision, lower recall than `All`. | Reduce noise when validating trustworthy links. |
| `AI Insights` | Requests AI summarization/enrichment for current graph context. | This generates analysis; it does not change edges by itself. | Fast orientation in unfamiliar areas of code. |
| `Apply AI` | Applies pending AI-suggested edges to the graph. | Commits suggestions; opposite intent of `Reject AI`. | Keep useful suggested links after validation. |
| `Reject AI` | Discards pending AI-suggested edges. | Removes suggestion queue; opposite intent of `Apply AI`. | Reset noisy suggestions and keep graph strict/manual. |
| `Relation Explain: Set From` | Pins current selection as source node for relation query. | Source endpoint only; pair with `Set To`. | Build repeatable A -> B relation checks. |
| `Relation Explain: Set To` | Pins current selection as target node for relation query. | Target endpoint only; pair with `Set From`. | Confirm destination impact or dependency rationale. |
| `Relation Explain: Explain` | Requests AI explanation for the current `From -> To` pair. | Consumes pinned relation state; does not auto-select nodes. | "Why are these connected?" and path explanation. |
| `Relation Explain: Reset` | Clears the pinned `From/To` relation state. | Clears relation context only, not graph or selection. | Start a fresh relation query without stale endpoints. |
| `Selection: Include external neighbors` | Expands focused selection with connected hidden neighbors. | Adds context around selected node, not global scope switch. | Grow local neighborhood without jumping to full architecture. |
| `Selection: Disconnect connection` | Disconnects selected node from Context Bot if connected. | Context Bot edge operation only. | Clean up temporary context wiring in Runtime CodeFlow. |
| `+` FAB -> `Context Bot` | Adds Context Bot node in Runtime CodeFlow. | Runtime utility node for context aggregation, not a source-code symbol. | Build ad-hoc context bundles from multiple nodes. |
| Runtime interaction: click output port -> click Context Bot | Connects selected node output into Context Bot context input; repeat to detach. | Port-based wiring flow specific to Runtime CodeFlow. | Assemble multi-node context before asking AI in Node Details. |
| Runtime interaction: `Ctrl+click node`, then `Ctrl+click Context Bot` | Fast toggle connect/disconnect between a node and Context Bot. | Shortcut path for the same context-bot connection intent. | Rapid connect/disconnect during iterative tracing. |
| Canvas interaction: double-click background | Toggles Hand mode (pan behavior). | Navigation mode switch, not data/filter mode. | Comfortable camera movement in dense graphs. |
| Canvas interaction: drag/scroll | Drag nodes to rearrange, scroll to zoom. | Visual organization/navigation only; graph semantics unchanged. | Reduce overlap and improve readability while investigating. |

### What users often mix up

| Pair | Difference |
|---|---|
| `View Mode` vs `Scope` | `View Mode` changes how nodes/edges are interpreted visually (architecture vs runtime). `Scope` changes which graph dataset is loaded (current file vs project vs codeflow). |
| `Dependencies` vs `Edges` | `Dependencies` chooses dependency signal type (imports only vs imports+calls). `Edges` chooses visibility strictness (all vs API-high). |
| `Relation Explain` vs Context Bot wiring | `Relation Explain` is an AI reasoning workflow over a selected pair. Context Bot wiring is runtime context aggregation for node chat/context workflows. |
| `Minimize/Maximize HUD` vs `Lock view` | Min/max are HUD layout controls. Lock view controls camera motion. |

### Practical mix-and-match recipes

1. Architecture review for a large repo: `View Mode: Architecture` + `Scope: Full Architecture` + `Dependencies: Imports/Exports` + `Edges: API-high`.
2. Impact analysis before editing a function: `View Mode: Architecture` + `Scope: Full Architecture` + `Dependencies: + Call Hierarchy` + `Edges: All`.
3. Focused refactor in one file: `Scope: Current File` + `View Mode: Runtime` + `Edges: All` + `Include external neighbors` when needed.
4. Runtime path debugging: `Scope: CodeFlow` + `View Mode: Runtime` + Context Bot wiring (output port -> Context Bot) + Node Details chat.
5. Relationship explanation workflow: click node A -> `Set From`, click node B -> `Set To`, then `Explain`, and `Reset` before testing a different pair.
6. Low-noise AI-assisted exploration: `Scope: Full Architecture` + `Edges: API-high` + `AI Insights`, then selectively `Apply AI` only when suggestions look credible.

## Commands

- `Mushroom PCE: Start Mushroom PCE` (`mushroom-pce.start`)
- `Mushroom PCE: Analyze Active File` (`mushroom-pce.analyzeActive`)
- `Mushroom PCE: Select Model` (`mushroom-pce.selectModel`)
- `Mushroom PCE: Set List Mode` (`mushroom-pce.setListMode`)
- `Mushroom PCE: Set Developer Mode` (`mushroom-pce.setDeveloperMode`)
- `Mushroom PCE: Set Definition Mode` (`mushroom-pce.setDefinitionMode`)
- `Mushroom PCE: Toggle Graphify Context` (`mushroom-pce.toggleGraphifyContext`)
- `Mushroom PCE: Open Circuit Mode` (`mushroom-pce.openCircuit`)
- `Mushroom PCE: Open Blueprint` (`mushroom-pce.openBlueprint`)
- `Mushroom PCE: Go To Function` (`mushroom-pce.goToFunction`)

## Project Structure

```text
src/
  app/
    activate.ts
    state/
      analysisCache.ts
      modelState.ts

  commands/
    registerCommands.ts
    startPceCommand.ts
    openCircuitCommand.ts

  controllers/
    mushroom/
      MushroomPanelController.ts
    blueprint/
      BlueprintPanelController.ts
    circuit/
      CircuitPanelController.ts
      CircuitDetailsPanelController.ts

  services/
    ai/
      requestModelText.ts
    analysis/
      buildListModeOutput.ts
      frequency.ts
    language/
      detectLanguageWarning.ts
    prompts/
      buildPrompt.ts
    symbols/
      parseSymbolLocations.ts
    blueprint/
      buildBlueprintPlan.ts
      generateBlueprintCode.ts
      scanWorkspaceBlueprint.ts
    circuit/
      buildGraph.ts
      buildGraphHybrid.ts
      buildProjectArchitectureGraph.ts
      buildProjectGraph.ts
      buildCodeFlowGraph.ts
      buildSkeletonGraph.ts
      ai/
        enrichCircuitGraph.ts
        explainNodeRelation.ts

  views/
    mushroom/
      mushroomHtml.ts
      mushroomStyles.ts
    circuit/
      circuitHtml.ts
      circuitStyles.ts
    details/
      detailsHtml.ts
      detailsStyles.ts

  webview/
    circuit/
      circuitApp.ts

  shared/
    types/
      appTypes.ts
      circuitTypes.ts
    webview/
      messages.ts

  utils/
    escapeHtml.ts
    getNonce.ts
    markdownToHtml.ts
    markdownToChatHtml.ts
    regex.ts

  extension.ts
```

## Requirements

- VS Code `^1.110.0`
- Access to at least one VS Code chat/language model (Developer Mode, Node Chat, AI Circuit features)
- Node.js 18+ (development only)

## Development

```bash
npm install
npm run compile
```

Useful scripts:

- `npm run watch`
- `npm run check-types`
- `npm run lint`
- `npm run lint:fix`
- `npm run test`

Pre-commit quality gate:

- Husky + lint-staged is configured for this repo.
- On `git commit`, staged `*.ts`/`*.tsx` files run through `eslint --fix --max-warnings=0`.
- Commits are blocked if lint errors remain.

Reusable bootstrap for other projects:

- Run this from this repo and point it to any JS/TS project folder:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-quality.ps1 -ProjectPath "D:\path\to\your-project"
```
- What it does:
  - Installs `husky` + `lint-staged` as dev dependencies
  - Adds/updates `prepare` and `lint:fix` scripts in `package.json`
  - Adds a `lint-staged` rule for `*.{js,jsx,ts,tsx}`
  - Creates `.husky/pre-commit` with `npx lint-staged`
  - Sets `git config core.hooksPath .husky` when the target is a git repo

## Notes

- Graph quality depends on language server symbol/call-hierarchy support.
- Large workspaces may take longer for Full Architecture/CodeFlow views.
- Some edges can be heuristic/fallback-labeled when high-confidence API data is unavailable.
- Blueprint planning context is currently sourced from `src/` and sampled file insights.
