# Mushroom PCE

Mushroom PCE is a VS Code extension that helps you understand code faster with AI explanations and an interactive Circuit Mode.

![Mushroom PCE Circuit Mode](images/feature-circuit.png)

## Key Features

- File analysis from the active editor in two modes:
  - Developer Mode: AI explanation with structured sections.
  - List Mode: deterministic static inventory (no model call).
- Symbol-aware output with clickable links (`Go To Function`).
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

## Commands

- `Mushroom PCE: Start Mushroom PCE` (`mushroom-pce.start`)
- `Mushroom PCE: Analyze Active File` (`mushroom-pce.analyzeActive`)
- `Mushroom PCE: Select Model` (`mushroom-pce.selectModel`)
- `Mushroom PCE: Set List Mode` (`mushroom-pce.setListMode`)
- `Mushroom PCE: Set Developer Mode` (`mushroom-pce.setDeveloperMode`)
- `Mushroom PCE: Open Circuit Mode` (`mushroom-pce.openCircuit`)
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
    analyzeActiveCommand.ts
    startPceCommand.ts
    selectModelCommand.ts
    setListModeCommand.ts
    setDeveloperModeCommand.ts
    goToSymbolCommand.ts
    openCircuitCommand.ts

  controllers/
    mushroom/
      MushroomPanelController.ts
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
- `npm run test`

## Notes

- Graph quality depends on language server symbol/call-hierarchy support.
- Large workspaces may take longer for Full Architecture/CodeFlow views.
- Some edges can be heuristic/fallback-labeled when high-confidence API data is unavailable.
