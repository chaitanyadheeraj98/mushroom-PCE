# Graph Report - D:\My Websites\Mushroom\mushroom-pce  (2026-04-22)

## Corpus Check
- 56 files · ~86,464 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 446 nodes · 805 edges · 40 communities detected
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 76 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]

## God Nodes (most connected - your core abstractions)
1. `collectTypeScriptConcepts()` - 29 edges
2. `addUnique()` - 22 edges
3. `MushroomPanel` - 19 edges
4. `getNodeGraphifyEvidence()` - 15 edges
5. `loadGraphifySmartQueryContext()` - 12 edges
6. `CircuitDetailsPanel` - 12 edges
7. `buildCircuitGraphHybrid()` - 12 edges
8. `collectCallHierarchyFileNeighbors()` - 12 edges
9. `AiJobOrchestrator` - 11 edges
10. `requestModelText()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `requestModelText()` --calls--> `askBlueprintChat()`  [INFERRED]
  D:\My Websites\Mushroom\mushroom-pce\src\services\ai\requestModelText.ts → D:\My Websites\Mushroom\mushroom-pce\src\services\blueprint\buildBlueprintPlan.ts
- `explainCode()` --calls--> `requestModelText()`  [INFERRED]
  D:\My Websites\Mushroom\mushroom-pce\src\app\activate.ts → D:\My Websites\Mushroom\mushroom-pce\src\services\ai\requestModelText.ts
- `tryGetSymbolSnippet()` --calls--> `getNormalizedDocumentSymbols()`  [INFERRED]
  D:\My Websites\Mushroom\mushroom-pce\src\controllers\circuit\CircuitDetailsPanelController.ts → D:\My Websites\Mushroom\mushroom-pce\src\services\symbols\documentSymbols.ts
- `requestModelText()` --calls--> `generateBlueprintPlan()`  [INFERRED]
  D:\My Websites\Mushroom\mushroom-pce\src\services\ai\requestModelText.ts → D:\My Websites\Mushroom\mushroom-pce\src\services\blueprint\buildBlueprintPlan.ts
- `requestModelText()` --calls--> `enrichCircuitGraphWithAi()`  [INFERRED]
  D:\My Websites\Mushroom\mushroom-pce\src\services\ai\requestModelText.ts → D:\My Websites\Mushroom\mushroom-pce\src\services\circuit\ai\enrichCircuitGraph.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (52): addUnique(), buildGenericConceptOutput(), buildListModeOutput(), buildTypeScriptConceptOutput(), cleanTypeText(), collectClass(), collectExportNames(), collectImport() (+44 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (27): dedupeLinkedFiles(), pickHighPriorityCircuitNodes(), AiJobCancelledError, AiJobOrchestrator, isAiJobCancelledError(), AnalysisCache, collectMessageTypeCheck(), getStringLiteralComparisonValue() (+19 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (9): main(), markdownToChatHtml(), escapeHtml(), extractTokenCandidates(), markdownToHtml(), pickPreferredSymbol(), resolveSymbolForToken(), sectionKeyFromHeading() (+1 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (18): activateApp(), buildGraphifyPathPairs(), buildGraphifySmartQueries(), buildLinkedFileSnippet(), buildRoleExplanation(), chooseSnippetCenterLine(), classifySystemRole(), collectLinkedMetricsFromOutput() (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.16
Nodes (26): buildArtifactsPrompt(), buildImplementationPrompt(), buildLineStarts(), buildPlanningTurnPrompt(), buildTargetedFunctionContext(), continueBlueprintPlanningTurn(), decodeUtf8(), dedupeFunctionTargets() (+18 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (11): CircuitDetailsPanel, describeEdge(), getFileSnippet(), getImportsBlockSnippet(), getNonce(), getSnippet(), isImportsNode(), renderEmptyHtml() (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.15
Nodes (18): analyzeNode(), buildArchitectureHierarchy(), buildCircuitGraph(), buildDeclarationFlow(), collectFunctions(), collectFunctionSignals(), createFunctionInfo(), dedupeFunctions() (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.2
Nodes (18): buildProjectArchitectureGraph(), collectCallHierarchyFileNeighbors(), extractModuleSpecifiers(), flattenFunctionSymbols(), isDeclarationFilePath(), isDeclarationFileUri(), isDocumentSymbolArray(), isLikelyCodeUri() (+10 more)

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (18): addConfidenceTag(), buildCircuitGraphHybrid(), buildDeclarationFileHintGraph(), classifyLayerFromName(), edgeSignature(), ensureNodeForItem(), findNodeByLocation(), isDeclarationFilePath() (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (17): buildAdaptiveQueries(), buildCacheKey(), buildPathPairs(), capText(), collectFileMentions(), collectNeighborEvidence(), fallback(), formatReason() (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.16
Nodes (5): buildCircuitHtml(), CircuitPanel, buildCircuitWebviewScript(), buildCircuitPanelHtml(), getNonce()

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (13): buildGlobalSkeletonGraph(), classifyLayerFromName(), ensureNode(), findNodeByLocation(), isTypeScriptLibFile(), isWorkspaceUri(), makeExternalNodeId(), mergeFallbackOneHop() (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.29
Nodes (12): buildBlueprintGraphifyContext(), buildGraphSnapshot(), capText(), extractFocusTerms(), formatReason(), isDeclarationFilePath(), readFileIfExists(), runBlueprintPaths() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (10): explainCode(), buildListFormatPolishPrompt(), buildNodeDetailsPrompt(), buildPrompt(), formatNodeGraphifyEvidence(), runListModePipeline(), isStrictListMarkdownShape(), parseListStructure() (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (2): BlueprintPanel, getNonce()

### Community 15 - "Community 15"
Cohesion: 0.39
Nodes (8): askBlueprintChat(), buildBlueprintGraph(), buildBlueprintPrompt(), generateBlueprintPlan(), mapPlanNode(), normalizePlanNodes(), parseBlueprintEnvelope(), safeJson()

### Community 16 - "Community 16"
Cohesion: 0.39
Nodes (5): addDocumentSymbols(), buildProjectArchitectureGraph(), inferLayerFromPath(), isLikelyCodeFile(), pickWorkspaceFolder()

### Community 17 - "Community 17"
Cohesion: 0.36
Nodes (5): getNormalizedDocumentSymbols(), isDocumentSymbolArray(), sortSymbols(), mapSymbolKind(), parseSymbolLocations()

### Community 18 - "Community 18"
Cohesion: 0.48
Nodes (5): buildCompactGraphContext(), buildPrompt(), enrichCircuitGraphWithAi(), safeJson(), tryParseEnvelope()

### Community 19 - "Community 19"
Cohesion: 0.43
Nodes (4): captureAll(), decodeUtf8(), readFileInsight(), uniqueSorted()

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (1): ModelState

### Community 21 - "Community 21"
Cohesion: 0.6
Nodes (5): buildCodeFlowGraph(), buildDeclarationCodeFlowHint(), hasModifier(), inferScriptKind(), isDeclarationFileUri()

### Community 22 - "Community 22"
Cohesion: 0.5
Nodes (3): addFrequencyToListOutput(), countSymbolOccurrences(), escapeRegExp()

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (2): Invoke-External(), Write-Step()

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 24`** (2 nodes): `detectLanguageWarning.ts`, `detectLanguageMismatchWarning()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (2 nodes): `escapeHtml.ts`, `escapeHtml()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `getNonce.ts`, `getNonce()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `detailsHtml.ts`, `buildDetailsHtml()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `mushroomHtml.ts`, `buildMushroomHtml()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `bootCircuitApp()`, `circuitApp.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `eslint.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `openCircuitCommand.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `startPceCommand.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `appTypes.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `circuitTypes.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `messages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `extension.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `circuitStyles.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `detailsStyles.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `mushroomStyles.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `collectMessageTypeCheck()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.188) - this node is a cross-community bridge._
- **Why does `requestModelText()` connect `Community 4` to `Community 1`, `Community 18`, `Community 13`, `Community 15`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Why does `explainCircuitNodeRelationWithAi()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `getNodeGraphifyEvidence()` (e.g. with `.get()` and `.set()`) actually correct?**
  _`getNodeGraphifyEvidence()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._