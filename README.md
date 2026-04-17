# Mushroom PCE

Mushroom PCE helps you understand code faster inside VS Code with:
- AI file explanations (Developer Mode)
- Deterministic code inventory output (List Mode)
- Interactive circuit-style graphs for architecture, runtime flow, and file dependencies
- Node-level Q&A with connected context (Context Bot)

![Mushroom PCE Circuit Mode](images/feature-circuit.png)

## What It Does

### File Analysis Panel
- Starts from the active editor file
- Streams an AI explanation in **Developer Mode**
- Or generates a structured static inventory in **List Mode** (no AI call)
- Converts detected symbols into clickable links so you can jump to definitions
- Warns when the file language mode appears mismatched with the code (for better analysis quality)

### Circuit Mode
- **Current File**: hybrid graph built from static analysis + call hierarchy enrichment
- **Full Architecture**: 1-hop file dependency map centered on the current file
  - `imports` mode: import/export relationships
  - `imports-calls` mode: import/export + call-hierarchy neighbors
- **CodeFlow**: ordered runtime-style flow blocks for top-level statements and declarations
- **Skeleton**: isolate a node and its one-hop neighborhood for focused exploration
- **Node Details**: inspect code snippets per node and ask node-scoped questions
- **Context Bot**: connect selected runtime outputs into a context node and ask targeted questions

## Commands

- `Mushroom PCE: Start Mushroom PCE` (`mushroom-pce.start`)
- `Mushroom PCE: Analyze Active File` (`mushroom-pce.analyzeActive`)
- `Mushroom PCE: Select Model` (`mushroom-pce.selectModel`)
- `Mushroom PCE: Set List Mode` (`mushroom-pce.setListMode`)
- `Mushroom PCE: Set Developer Mode` (`mushroom-pce.setDeveloperMode`)
- `Mushroom PCE: Open Circuit Mode` (`mushroom-pce.openCircuit`)
- `Mushroom PCE: Go To Function` (`mushroom-pce.goToFunction`) (used internally by clickable symbol links)

## Requirements

- VS Code `^1.110.0`
- Access to at least one VS Code chat/language model (for Developer Mode and node chat)
- Node.js 18+ (development only)

## Current Extension Settings

This version does **not** contribute user settings in `package.json`.
Mode/model selection is handled through commands and panel controls.

## Known Limitations

- Very large workspaces can take longer to build in Circuit Mode.
- Graph accuracy depends on available symbol/call-hierarchy providers for the current language.
- Some relationships are heuristic/fallback-labeled (for example `[fallback-medium]`) when high-confidence API data is unavailable.
- Full Architecture currently focuses on 1-hop neighbors from the active file.

## Development

```bash
npm install
npm run compile
```

Useful scripts:
- `npm run watch`
- `npm run lint`
- `npm run test`

## Why Use It

Mushroom PCE is designed for onboarding, debugging, and safe refactoring:
- Understand unfamiliar code paths quickly
- Visualize what calls what (and how files connect)
- Ask focused questions at node level with connected context
- Move from high-level architecture to concrete code lines in one workflow
