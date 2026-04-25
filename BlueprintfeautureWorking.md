# Blueprint Feature Working Notes (Debug Handbook)

Last updated: 2026-04-24

This document explains how the current Blueprint feature works end-to-end, which functions are responsible for each stage, and what to inspect when debugging.

## 1) Feature Behavior (Current)

Blueprint is a planning workflow inside the webview panel:

1. User chats in **Blueprint Planner Chat**.
2. Planner returns assistant text + unresolved questions.
3. User clicks **Generate JSON Spec + Prompt**.
4. Backend generates a structured spec from conversation + workspace snapshot (+ optional Graphify context).
5. Backend writes/updates feature tracking (`feature_id`) in `docs/.blueprint/feature-registry.json`.
6. UI shows:
   - JSON spec
   - Prompt output
   - Feature link confidence, mode, and override state
7. User clicks **Save Spec File** to save markdown in `docs/feature-plans/`.

Important current rules:

- Generate is blocked in UI if there is no chat history.
- Generate now hard-fails if planner output is invalid JSON (no silent fallback spec).
- Chat now shows raw model text with parse warning if chat JSON parse fails.
- Forced feature link override is persistent for the panel session until cleared.

## 2) Primary Files and Responsibilities

| File | Responsibility |
|---|---|
| `src/controllers/blueprint/BlueprintPanelController.ts` | Blueprint panel lifecycle, webview message contracts, UI event handling |
| `src/services/blueprint/generateBlueprintCode.ts` | Planner prompts, JSON parsing, spec normalization, implementation prompt synthesis |
| `src/services/blueprint/featureRegistry.ts` | Feature tracking registry CRUD-like behavior (upsert/list) + matching |
| `src/services/blueprint/scanWorkspaceBlueprint.ts` | Fast src/ workspace scan used as planner context |
| `src/services/graphify/blueprintGraphifyContext.ts` | Graphify context material for blueprint prompts |
| `src/app/activate.ts` | Orchestration glue: panel callbacks, model selection, generation/save integration |
| `src/services/ai/requestModelText.ts` | LLM response extraction used by planner/generator |

## 3) Runtime Flow (Generate Path)

1. Webview JS calls `vscode.postMessage({ type: 'blueprintGeneratePrompt', history, forcedFeatureId })`.
2. `BlueprintPanelController.handleGenerateArtifacts(...)` forwards request to callback.
3. `activate.ts` callback:
   - loads model
   - scans workspace (`scanSrcWorkspaceSnapshot`)
   - optionally builds Graphify context
   - runs `generateBlueprintPlanningArtifacts(...)`
   - runs `upsertBlueprintFeatureFromArtifacts(..., { status: 'draft', forcedFeatureId })`
4. Result returns to panel as `blueprintPromptGenerated`.
5. UI renders spec/prompt + tracking metadata.

## 4) Function Catalog (Roles + Behavior)

## 4.1 `src/services/blueprint/generateBlueprintCode.ts`

| Function | Role | Behavior Summary |
|---|---|---|
| `continueBlueprintPlanningTurn` | Chat planner turn | Builds planning prompt, calls model, parses chat envelope. On parse fail: returns raw text + `parseWarning` + no unresolved questions. |
| `generateBlueprintPlanningArtifacts` | Main generation entry | Builds artifacts prompt, calls model, requires valid JSON envelope (hard fail on parse miss), optionally refines with targeted code snippets, returns `{ spec, prompt }`. |
| `buildPlanningTurnPrompt` | Chat prompt builder | Assembles role instructions, rules, workspace snapshot, graphify context, and conversation tail. |
| `buildArtifactsPrompt` | Spec prompt builder | Assembles strict JSON schema instructions and constraints for final spec generation. |
| `refineSpecWithCodeContext` | Second-pass refinement | Uses targeted snippets for reuse/edit validation; requires valid JSON output (hard fail on parse miss). |
| `buildTargetedFunctionContext` | Snippet collection | Reads candidate files from reuse/edit function refs and extracts nearby code snippets. |
| `dedupeFunctionTargets` | Candidate sanitizer | Deduplicates function candidates by `path::name`. |
| `findFunctionSnippet` | Symbol locator heuristic | Regex-based attempt to find function/variable/method usage snippet. |
| `extractSnippetWindow` | Snippet windowing | Computes centered line-range snippet around matched anchor. |
| `buildLineStarts` | Text indexing helper | Precomputes line-start offsets. |
| `findLineNumberAtIndex` | Offset-to-line helper | Binary-searches line number from char index. |
| `getLineRange` | Safe slicing helper | Returns bounded snippet range with truncation marker. |
| `decodeUtf8` | Decode helper | Decodes file bytes to text safely. |
| `escapeRegExp` | Regex helper | Escapes dynamic symbol names for regex. |
| `renderWorkspaceContext` | Prompt context renderer | Serializes sampled paths/functions/exports into prompt context block. |
| `fallbackAssistantMessage` | Chat fallback text | Builds question-oriented fallback when parsed message field is empty. |
| `throwInvalidPlannerJsonResponse` | Hard-fail guard | Throws explicit parse error with remediation + debug snippet. |
| `normalizeSpec` | Spec normalization | Fills defaults and normalizes all list/object fields for safe downstream use. |
| `normalizeFunctions` | Function list normalizer | Validates and normalizes function refs (`reuse/create/edit`). |
| `normalizeFileActions` | File action normalizer | Normalizes create/edit file actions with reasons. |
| `normalizeStringList` | List sanitizer | Trims/deduplicates arrays with max bounds and fallback. |
| `normalizePath` | Path guard | Normalizes to `src/...`, blocks traversal (`..`). |
| `parseEnvelope` | JSON envelope parser | Attempts direct JSON, fenced JSON, and substring JSON extraction. |
| `safeJson` | JSON parse wrapper | Returns `undefined` on parse exceptions. |
| `buildImplementationPrompt` | Prompt generator | Converts normalized `spec` into markdown build prompt format for coding AI. |

## 4.2 `src/services/blueprint/featureRegistry.ts`

| Function | Role | Behavior Summary |
|---|---|---|
| `upsertBlueprintFeatureFromArtifacts` | Registry write/upsert | Loads registry, computes candidate record, applies forced-link if provided, matches existing feature or creates new, writes updated registry. |
| `listBlueprintFeatureOptions` | Registry read/list | Returns lightweight feature options for UI dropdown, sorted by `updatedAt` desc. |
| `loadBlueprintFeatureRegistry` | Registry loader | Reads `docs/.blueprint/feature-registry.json`, validates/coerces; falls back to empty registry on errors. |
| `saveBlueprintFeatureRegistry` | Registry persister | Writes formatted JSON registry under `docs/.blueprint/`. |
| `normalizeRecord` | Record validator | Coerces persisted record to valid internal shape. |
| `buildCandidateRecord` | Candidate projection | Builds feature candidate from generated artifacts (`files`, `functions`, summary, goal). |
| `findBestFeatureMatch` | Matching engine | Scores name + file overlap + function overlap; honors forced `featureId` if present. |
| `overlapRatio` | Similarity helper | Computes intersection/union ratio for string sets. |
| `generateFeatureId` | ID generator | Builds stable-ish `feat_<slug>_<hash>` with collision suffixing. |
| `fnv1a` | Hash helper | Hashes feature inputs for deterministic ID suffix. |
| `normalizeTrackedFiles` | File tracking normalizer | Cleans and dedupes tracked files/actions. |
| `normalizeTrackedFunctions` | Function tracking normalizer | Cleans and dedupes tracked function entries. |
| `normalizeStringList` | List helper | Trim/dedupe list strings with max count. |
| `normalizePath` | Path helper | Guards against invalid/traversal paths; ensures `src/` prefix. |
| `normalizeText` | Text helper | Lowercase/trim normalization. |
| `decodeUtf8` | Decode helper | Safe byte-to-text decode. |

## 4.3 `src/services/blueprint/scanWorkspaceBlueprint.ts`

| Function | Role | Behavior Summary |
|---|---|---|
| `scanSrcWorkspaceSnapshot` | Workspace scan entry | Walks `src/`, captures entries and per-file function/export insights with caps. |
| `readFileInsight` | File introspection | Reads a code file and extracts function/export names via regex patterns. |
| `captureAll` | Regex capture helper | Captures named groups from repeated regex matches. |
| `uniqueSorted` | Dedupe helper | Returns sorted unique values. |
| `extensionOf` | Extension helper | Lowercase extension extraction. |
| `decodeUtf8` | Decode helper | Safe UTF-8 decode. |

## 4.4 `src/services/graphify/blueprintGraphifyContext.ts`

| Function | Role | Behavior Summary |
|---|---|---|
| `buildBlueprintGraphifyContext` | Graphify context entry | Builds prompt-side graph context using report/graph/CLI query + path outputs. |
| `runBlueprintQueries` | Graphify query pass | Executes query list to gather related evidence text. |
| `runBlueprintPaths` | Graphify path pass | Executes path checks between important symbols/terms. |
| `buildGraphSnapshot` | Snapshot builder | Creates compact graph snapshot text for prompt context. |
| `extractFocusTerms` | Term extractor | Derives focus terms from feature request and conversation. |
| `runGraphifyGraphCommand` | CLI executor | Runs `graphify` command and captures stdout/stderr/timeout status. |
| `readFileIfExists` | File helper | Safe read helper for optional files. |
| `formatReason` | Error helper | Formats why query/path command failed. |
| `capText` | Prompt-size helper | Truncates long context sections. |
| `uniqueQueries` | Query dedupe | Deduplicates query terms preserving order. |
| `uniquePairs` | Pair dedupe | Deduplicates graph path pairs. |
| `normalizeFile` | Path normalization | Standardizes path formatting for comparisons. |
| `isDeclarationFilePath` | Filter helper | Excludes declaration files from high-signal context. |

## 4.5 `src/controllers/blueprint/BlueprintPanelController.ts`

### TypeScript class methods

| Method | Role | Behavior Summary |
|---|---|---|
| `BlueprintPanel.createOrShow` | Panel singleton manager | Creates/reveals panel and injects callbacks/state. |
| `BlueprintPanel.setGraphifyContextEnabled` | Panel state sync | Pushes graphify toggle state to current panel webview. |
| `constructor` | Wiring | Initializes HTML and message handlers for all blueprint commands. |
| `dispose` | Cleanup | Clears singleton and disposables. |
| `handleUserTurn` | Chat dispatch | Runs user turn callback and posts `blueprintAssistantTurn`. |
| `handleGenerateArtifacts` | Generate dispatch | Runs generate callback and posts `blueprintPromptGenerated`. |
| `handleLoadFeatureRegistry` | Registry dispatch | Loads feature options and posts `blueprintFeatureRegistryLoaded`. |
| `handleSaveArtifacts` | Save dispatch | Runs save callback and posts `blueprintPromptSaved`. |
| `getHtml` | Webview renderer | Returns full HTML+JS for panel UI and behavior. |
| `normalizeHistory` | Input sanitizer | Normalizes incoming history payload from webview. |
| `getNonce` | CSP helper | Generates script nonce. |

### Webview inline JS functions (inside `getHtml`)

Major UI/runtime functions:

- `setStatus`, `setBusy`, `formatAssistantText`
- `updateGraphifyContextIndicator`
- `sendTurn`, `generatePrompt`, `saveArtifacts`
- `applyArtifacts`
- `renderFeatureRegistryOptions`, `renderFeatureTracking`
- `loadFeatureRegistry`
- `confidencePercent`, `toBand`, `findFeatureLabel`
- `initResizers`, `pushBubble`, `addHistory`, `copyText`, `getChatTranscriptText`

Behavior notes:

- `generatePrompt` refuses to run when no chat history exists.
- `window.addEventListener('message', ...)` handles:
  - `blueprintAssistantTurn`
  - `blueprintPromptGenerated`
  - `blueprintPromptSaved`
  - `blueprintFeatureRegistryLoaded`
  - `blueprintForcedFeatureLinkState`
  - `graphifyContextState`

## 4.6 `src/app/activate.ts` (Blueprint-specific orchestration)

Blueprint behavior lives inside `activateApp` via `openBlueprintPanel` callback wiring:

| Function/Block | Role | Behavior Summary |
|---|---|---|
| `openBlueprintPanel` | Orchestrator entry | Registers callbacks for chat, generate, save, registry load. |
| Generate callback (`blueprint:generate`) | Main generate runtime | Validates model, scans workspace, optional graphify context, calls generator, updates feature registry draft tracking. |
| Save callback | Persist artifact | Saves markdown under `docs/feature-plans/`, then upserts registry as saved. |
| Registry callback | Feature options source | Calls `listBlueprintFeatureOptions` for webview selector. |
| `loadBlueprintGraphifyContextFromWorkspace` | Graphify context builder | Calls graphify blueprint context service and handles fallback logging. |
| `makeBlueprintSpecFileName` | Save naming helper | Builds file name from feature slug + feature id + timestamp. |
| `renderBlueprintSpecMarkdown` | Markdown serializer | Writes metadata + JSON spec + prompt into saved file. |
| `toMatchBand` | Confidence band helper | Maps overlap score to `high/medium/low`. |

## 4.7 `src/services/ai/requestModelText.ts`

| Function | Role | Behavior Summary |
|---|---|---|
| `requestModelText` | Model text extraction | Normalizes different model response shapes into a single text output. |
| `extractTextFromChunk` | Stream helper | Extracts text from stream chunk variants. |

## 5) Message Contracts (Webview <-> Extension)

Incoming from webview:

- `blueprintUserTurn`
- `blueprintGeneratePrompt`
- `blueprintSavePromptArtifacts`
- `blueprintLoadFeatureRegistry`
- `blueprintSetForcedFeatureLink`
- `blueprintClearForcedFeatureLink`
- `blueprintToggleGraphifyContext`

Outgoing to webview:

- `blueprintAssistantTurn`
- `blueprintPromptGenerated`
- `blueprintPromptSaved`
- `blueprintFeatureRegistryLoaded`
- `blueprintForcedFeatureLinkState`
- `graphifyContextState`

## 6) When Generate JSON Spec + Prompt Will Not Work

1. Generate button disabled because panel is busy.
2. No chat history exists (`Start with at least one chat turn before generating.`).
3. No AI model is available in VS Code chat model selection.
4. First-pass spec response is not valid JSON (hard-fail).
5. Second-pass refinement response is not valid JSON (hard-fail).
6. Any model/transport/abort/runtime exception in generate callback chain.

## 7) Debugging Playbook

## 7.1 Symptom: `Untitled Feature` / empty spec

Expected status after robustness fix:

- Should not silently appear from parse-failed generate path.
- If seen, check whether response parsed but had missing fields that were normalized by `normalizeSpec`.

Checks:

1. Inspect `Details:` block in panel meta after generate failure.
2. Verify `throwInvalidPlannerJsonResponse` path is being triggered for malformed model output.
3. Add temporary logging around raw `response` in `generateBlueprintPlanningArtifacts` if needed.

## 7.2 Symptom: Planner says odd/free-form text

Cause:

- Chat turn JSON parse failed; fallback now surfaces raw model text with parse warning.

Checks:

1. Look for `Planner parse warning:` in panel meta.
2. Retry chat turn; ensure model follows strict output schema.

## 7.3 Symptom: Wrong feature linked

Checks:

1. Verify `forcedFeatureId` is set/cleared as intended in UI.
2. Inspect `featureTracking` in generated artifacts:
   - `featureId`
   - `matchedExistingFeatureId`
   - `overlapScore`
   - `isForcedLink`
3. Verify registry options in `docs/.blueprint/feature-registry.json`.

## 7.4 Symptom: Graphify context not appearing

Checks:

1. Graphify toggle in panel is ON.
2. `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` exist.
3. Output channel logs for:
   - `blueprint graphify context loaded`
   - fallback/failure reason text

## 8) Data Shapes (Important for Debugging)

## 8.1 Planning artifacts

- `featureName`
- `spec` (all planning sections)
- `prompt`
- `modelLabel`
- `generatedAt`
- `featureTracking?`

## 8.2 Feature tracking metadata

- `featureId`
- `registryPath`
- `status` (`draft`/`saved`)
- `matchedExistingFeatureId?`
- `overlapScore?`
- `isForcedLink?`
- `forcedFeatureId?`
- `matchBand?`

## 8.3 Registry file

Path: `docs/.blueprint/feature-registry.json`

- top-level: `{ version, updatedAt, features[] }`
- feature record includes identity, status, revision, timing, tracked files/functions.

## 9) Quick Verification Checklist

1. Open Blueprint panel.
2. Send at least one chat turn.
3. Click Generate.
4. Confirm JSON and Prompt panes populate.
5. Confirm Feature Link card/chip and dropdown behaviors.
6. Force-link a feature ID and regenerate.
7. Save spec and confirm:
   - markdown file in `docs/feature-plans/`
   - registry updated in `docs/.blueprint/feature-registry.json`
8. Test malformed model response path and confirm hard-fail message in panel meta.

