import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

import { AiJobCancelledError, AiJobOrchestrator, isAiJobCancelledError } from '../services/ai/aiJobOrchestrator';
import { requestModelText } from '../services/ai/requestModelText';
import { buildListModeOutput } from '../services/analysis/buildListModeOutput';
import { ListModeVariant, runListModePipeline } from '../services/analysis/listModePipeline';
import { buildNodeDetailsPrompt, buildPrompt } from '../services/prompts/buildPrompt';
import { BlueprintPanel } from '../controllers/blueprint/BlueprintPanelController';
import { MushroomPanel } from '../controllers/mushroom/MushroomPanelController';
import { parseSymbolLocations } from '../services/symbols/parseSymbolLocations';
import { ResponseMode, SymbolLink } from '../shared/types/appTypes';
import { CircuitDetailsPanel, NodeChatRequest } from '../controllers/circuit/CircuitDetailsPanelController';
import { detectLanguageMismatchWarning } from '../services/language/detectLanguageWarning';
import { registerPceCommands } from '../commands/registerCommands';
import { enrichCircuitGraphWithAi } from '../services/circuit/ai/enrichCircuitGraph';
import { CircuitAiEnrichmentResult, CircuitGraph, CircuitNode, NodeGraphifyEvidenceResult } from '../shared/types/circuitTypes';
import { explainCircuitNodeRelationWithAi } from '../services/circuit/ai/explainNodeRelation';
import { getNodeGraphifyEvidence } from '../services/graphify/nodeContextEngine';
import {
	BlueprintConversationTurn,
	BlueprintPlanningArtifacts,
	continueBlueprintPlanningTurn,
	generateBlueprintPlanningArtifacts
} from '../services/blueprint/generateBlueprintCode';
import { scanSrcWorkspaceSnapshot } from '../services/blueprint/scanWorkspaceBlueprint';
import { buildBlueprintGraphifyContext } from '../services/graphify/blueprintGraphifyContext';
import { listBlueprintFeatureOptions, upsertBlueprintFeatureFromArtifacts } from '../services/blueprint/featureRegistry';

export function activateApp(context: vscode.ExtensionContext) {
	let latestRunId = 0;
	const output = vscode.window.createOutputChannel('Mushroom PCE');
	let lastDocument: vscode.TextDocument | undefined;
	let lastEditorColumn: vscode.ViewColumn = vscode.ViewColumn.One;

	let availableModels: vscode.LanguageModelChat[] = [];
	let selectedModelId: string | undefined;
	let selectedResponseMode: ResponseMode = 'developer';
	let graphifyContextEnabled = Boolean(context.workspaceState.get<boolean>('mushroom-pce.graphifyContextEnabled', false));

	let symbolIndexTimer: ReturnType<typeof setTimeout> | undefined;
	type CacheEntry = { text: string; updatedAt: number; docVersion: number; graphifyFingerprint?: string };
	const analysisCache = new Map<string, CacheEntry>();
	const lastGraphifyFingerprintByDoc = new Map<string, string>();
	const nodeDeveloperContextCache = new Map<string, CacheEntry>();
	const circuitAiCache = new Map<string, CircuitAiEnrichmentResult>();
	const aiJobs = new AiJobOrchestrator({
		maxConcurrent: 2,
		laneLimits: {
			analysis: 1,
			'node-chat': 1,
			'circuit-ai': 1,
			blueprint: 1
		}
	});

	const rememberEditor = (editor: vscode.TextEditor | undefined): void => {
		if (!editor) {
			return;
		}

		if (editor.document.uri.scheme === 'file' || editor.document.uri.scheme === 'untitled') {
			lastDocument = editor.document;
			if (editor.viewColumn) {
				lastEditorColumn = editor.viewColumn;
			}
		}
	};

	recognizeActiveEditor();

	function recognizeActiveEditor(): void {
		rememberEditor(vscode.window.activeTextEditor);
	}

	const applyModelStateToPanel = (panel: MushroomPanel): void => {
		const selected = availableModels.find((m) => m.id === selectedModelId);
		const selectedLabel = selected ? `${selected.name} (${selected.vendor}/${selected.family})` : 'No model selected';
		const modelLabels = availableModels.map((m) => `${m.name} (${m.vendor}/${m.family})`);
		panel.setModelInfo(selectedLabel, modelLabels);
	};

	const applyModeStateToPanel = (panel: MushroomPanel): void => {
		panel.setResponseModeInfo(selectedResponseMode);
	};

	const applyGraphifyStateToPanel = (panel: MushroomPanel): void => {
		panel.setGraphifyContextInfo(graphifyContextEnabled);
	};

	const isGraphifyEligibleMode = (mode: ResponseMode): boolean => mode === 'developer' || mode === 'definition';

	const getCurrentDocument = (): vscode.TextDocument | undefined => {
		const editor = vscode.window.activeTextEditor;
		return editor?.document ?? lastDocument;
	};

	const getCacheKey = (
		doc: vscode.TextDocument,
		mode: ResponseMode,
		options?: {
			modelId?: string;
			listVariant?: ListModeVariant;
			graphifyEnabled?: boolean;
			graphifyFingerprint?: string;
		}
	): string => {
		if (mode === 'list') {
			const listVariant = options?.listVariant ?? 'list-local';
			return `${doc.uri.toString()}::${listVariant}::${mode}`;
		}
		const keyModel = options?.modelId ?? 'no-model';
		const graphifyKey =
			isGraphifyEligibleMode(mode) ? `::graphify-${options?.graphifyEnabled ? 'on' : 'off'}` : '';
		const fingerprintKey =
			isGraphifyEligibleMode(mode) && options?.graphifyEnabled && options?.graphifyFingerprint
				? `::ctx-${options.graphifyFingerprint}`
				: '';
		return `${doc.uri.toString()}::${keyModel}::${mode}${graphifyKey}${fingerprintKey}`;
	};

	const tryRestoreCachedAnalysis = async (panel: MushroomPanel): Promise<boolean> => {
		if (panel.isDisposed()) {
			return false;
		}

		const doc = getCurrentDocument();
		if (!doc) {
			return false;
		}

		let modelIdForCache: string | undefined;
		let cachedLabel: string = selectedResponseMode;
		if (selectedResponseMode !== 'list') {
			await loadModels(panel);
			const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
			if (!model) {
				return false;
			}
			modelIdForCache = model.id;
		}

		let cached: CacheEntry | undefined;
		if (selectedResponseMode === 'list') {
			await loadModels(panel);
			const hasModel = availableModels.length > 0;
			const preferredKeys = hasModel
				? [
					getCacheKey(doc, 'list', { listVariant: 'list-ai-polished' }),
					getCacheKey(doc, 'list', { listVariant: 'list-local' })
				]
				: [getCacheKey(doc, 'list', { listVariant: 'list-local' })];
			for (const key of preferredKeys) {
				const hit = analysisCache.get(key);
				if (hit) {
					cached = hit;
					cachedLabel = key.includes('list-ai-polished') ? 'list + ai polish' : 'list local';
					break;
				}
			}
		} else {
			const graphifyFingerprint =
				isGraphifyEligibleMode(selectedResponseMode) && graphifyContextEnabled
					? lastGraphifyFingerprintByDoc.get(doc.uri.toString())
					: undefined;
			if (isGraphifyEligibleMode(selectedResponseMode) && graphifyContextEnabled && !graphifyFingerprint) {
				return false;
			}
			const key = getCacheKey(doc, selectedResponseMode, {
				modelId: modelIdForCache,
				graphifyEnabled: isGraphifyEligibleMode(selectedResponseMode) ? graphifyContextEnabled : undefined,
				graphifyFingerprint
			});
			cached = analysisCache.get(key);
		}
		if (!cached) {
			return false;
		}

		panel.setExplanation(cached.text);
		const stale = cached.docVersion !== doc.version;
		panel.setStatus(
			stale
				? `Cached (stale: file changed) (${cachedLabel}) at ${new Date(cached.updatedAt).toLocaleTimeString()}`
				: `Cached (${cachedLabel}) at ${new Date(cached.updatedAt).toLocaleTimeString()}`
		);
		return true;
	};

	const applySymbolStateToPanel = async (panel: MushroomPanel, document: vscode.TextDocument): Promise<void> => {
		const locations = await parseSymbolLocations(document);
		const links: SymbolLink[] = locations.map((loc) => {
			const args = encodeURIComponent(JSON.stringify([loc.uri.toString(), loc.line, loc.character]));
			return {
				name: loc.name,
				kind: loc.kind,
				commandUri: `command:mushroom-pce.goToFunction?${args}`
			};
		});
		panel.setSymbolLinks(links);
		output.appendLine(`symbol links updated: ${links.length}`);
	};

	const loadModels = async (panel?: MushroomPanel): Promise<void> => {
		availableModels = await vscode.lm.selectChatModels();
		if (!selectedModelId || !availableModels.some((m) => m.id === selectedModelId)) {
			selectedModelId = availableModels[0]?.id;
		}

		if (panel && !panel.isDisposed()) {
			applyModelStateToPanel(panel);
		}
		output.appendLine(`models loaded: ${availableModels.length}`);
	};

	const runAnalysis = async (panel: MushroomPanel): Promise<void> => {
		output.appendLine('runAnalysis invoked');
		if (panel.isDisposed()) {
			output.appendLine('runAnalysis aborted: panel disposed');
			return;
		}

		const editor = vscode.window.activeTextEditor;
		const document = editor?.document ?? lastDocument;
		if (!document) {
			output.appendLine('runAnalysis aborted: no active editor');
			panel.setStatus('Open a file to analyze');
			panel.setExplanation('Open a code file in the editor, then click Analyze.');
			panel.setAnalyzing(false);
			return;
		}
		lastDocument = document;
		await applySymbolStateToPanel(panel, document);

		const code = document.getText();
		if (!code.trim()) {
			output.appendLine('runAnalysis aborted: empty file');
			panel.setStatus('No code detected');
			panel.setExplanation('Type or paste code in the active file, then click Analyze.');
			panel.setLanguageWarning(undefined);
			panel.setAnalyzing(false);
			return;
		}

		panel.setLanguageWarning(detectLanguageMismatchWarning(document.languageId, code));

		const runId = ++latestRunId;
		panel.clear();
		panel.setAnalyzing(true);
		panel.setStatus('Analyzing...');
		output.appendLine(`Analyzing mode=${selectedResponseMode}, language=${document.languageId}, chars=${code.length}`);

		const ensureCurrentRequest = (signal: AbortSignal): void => {
			if (signal.aborted) {
				throw new AiJobCancelledError(String(signal.reason ?? 'Cancelled'));
			}
			if (runId !== latestRunId || panel.isDisposed()) {
				throw new AiJobCancelledError('Superseded by newer request');
			}
		};

		try {
			const result = await aiJobs.schedule<{
				explanation: string;
				status: string;
				cacheModelId?: string;
				cacheListVariant?: ListModeVariant;
				graphifyFingerprint?: string;
			}>({
				lane: 'analysis',
				group: 'analysis:active-file',
				supersedeGroup: true,
				priority: 100,
				run: async (signal) => {
					ensureCurrentRequest(signal);

					if (selectedResponseMode === 'list') {
						output.appendLine('using deterministic list mode stage 1: strict local extraction');
						const canonicalListOutput = await buildListModeOutput(document);
						ensureCurrentRequest(signal);
						await loadModels(panel);
						ensureCurrentRequest(signal);
						const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
						const listResult = await runListModePipeline(
							document.languageId,
							canonicalListOutput,
							model,
							requestModelText,
							signal
						);
						if (listResult.reason) {
							output.appendLine(`list mode polish fallback: ${listResult.reason}`);
						}
						return {
							explanation: listResult.text || 'No explanation generated.',
							status: `${listResult.statusMessage} at ${new Date().toLocaleTimeString()}`,
							cacheListVariant: listResult.variant
						};
					}

					await loadModels(panel);
					ensureCurrentRequest(signal);
					const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
					if (!model) {
						return {
							explanation: 'No AI model is currently available. Open Copilot/Chat model access and try again.',
							status: 'No model available'
						};
					}

					output.appendLine(`using model id=${model.id}`);
					const graphifyContext =
						isGraphifyEligibleMode(selectedResponseMode) && graphifyContextEnabled
							? await loadGraphifyDeveloperContext(document, output, signal)
							: undefined;
					const explanation = await explainCode(
						model,
						code,
						document.languageId,
						selectedResponseMode,
						graphifyContext?.promptContext,
						(chunk) => {
							if (runId !== latestRunId || panel.isDisposed() || signal.aborted) {
								return;
							}
							panel.appendChunk(chunk);
						},
						signal
					);
					ensureCurrentRequest(signal);

					return {
						explanation: explanation || 'No explanation generated.',
						status: `Updated at ${new Date().toLocaleTimeString()}`,
						cacheModelId: model.id,
						graphifyFingerprint: graphifyContext?.fingerprint
					};
				}
			});

			if (runId !== latestRunId || panel.isDisposed()) {
				return;
			}

			panel.setExplanation(result.explanation);
			if (result.explanation && result.status !== 'No model available') {
				const docKey = document.uri.toString();
				if (result.graphifyFingerprint) {
					lastGraphifyFingerprintByDoc.set(docKey, result.graphifyFingerprint);
				}
				const cacheKey = getCacheKey(document, selectedResponseMode, {
					modelId: result.cacheModelId,
					listVariant: result.cacheListVariant,
					graphifyEnabled: isGraphifyEligibleMode(selectedResponseMode) ? graphifyContextEnabled : undefined,
					graphifyFingerprint: result.graphifyFingerprint
				});
				analysisCache.set(cacheKey, {
					text: result.explanation,
					updatedAt: Date.now(),
					docVersion: document.version,
					graphifyFingerprint: result.graphifyFingerprint
				});
			}
			panel.setStatus(result.status);
			output.appendLine('runAnalysis completed');
		} catch (error: unknown) {
			if (runId !== latestRunId || panel.isDisposed()) {
				return;
			}
			if (isAiJobCancelledError(error)) {
				panel.setStatus('Analysis superseded by newer request');
				output.appendLine('runAnalysis cancelled/superseded');
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			panel.setStatus('Analysis failed');
			panel.setExplanation(`Error: ${message}`);
			output.appendLine(`runAnalysis failed: ${message}`);
		} finally {
			if (runId === latestRunId && !panel.isDisposed()) {
				panel.setAnalyzing(false);
			}
		}
	};

	const askNodeQuestion = async (request: NodeChatRequest): Promise<string> => {
		return aiJobs.schedule<string>({
			lane: 'node-chat',
			group: `node-chat:${request.node.id}`,
			priority: 40,
			run: async (signal) => {
				await loadModels();
				if (signal.aborted) {
					throw new AiJobCancelledError(String(signal.reason ?? 'Cancelled'));
				}
				const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
				if (!model) {
					return 'No AI model is currently available. Open Copilot/Chat model access and try again.';
				}

				if (String(request.node.label || '').toLowerCase().includes('context bot')) {
					const doc = getCurrentDocument();
					if (doc) {
						const cacheKey = `${doc.uri.toString()}::${model.id}::developer-context`;
						const cached = nodeDeveloperContextCache.get(cacheKey);
						if (cached && cached.docVersion === doc.version) {
							request.developerAnalysis = cached.text;
						} else {
							const generated = await explainCode(
								model,
								doc.getText(),
								doc.languageId,
								'developer',
								undefined,
								undefined,
								signal
							);
							if (generated?.trim()) {
								request.developerAnalysis = generated;
								nodeDeveloperContextCache.set(cacheKey, {
									text: generated,
									updatedAt: Date.now(),
									docVersion: doc.version
								});
							}
						}
					}
				}

				if (graphifyContextEnabled) {
					request.graphifyEvidence = await loadNodeGraphifyEvidence({
						node: request.node,
						scope: 'current-file',
						signal
					});
				}

				const prompt = buildNodeDetailsPrompt(request);
				const responseText = await requestModelText(model, prompt, { signal });
				if (request.graphifyEvidence?.status === 'fallback') {
					return [
						'Graphify node evidence unavailable; using structural fallback.',
						responseText || 'No response generated.'
					].join('\n\n');
				}
				return responseText || 'No response generated.';
			}
		});
	};

	const requestCircuitAiEnrichment = async (
		graph: CircuitGraph,
		scope: 'current-file' | 'full-architecture' | 'codeflow' = 'current-file'
	): Promise<CircuitAiEnrichmentResult | undefined> => {
		await loadModels();
		const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
		if (!model) {
			return undefined;
		}

		const signature = JSON.stringify({
			modelId: model.id,
			scope,
			graphifyContextEnabled,
			nodes: graph.nodes.map((node) => ({
				id: node.id,
				label: node.label,
				type: node.type,
				layer: node.layer,
				detail: node.detail
			})),
			edges: graph.edges.map((edge) => ({
				from: edge.from,
				to: edge.to,
				kind: edge.kind,
				label: edge.label
			}))
		});

		const cached = circuitAiCache.get(signature);
		if (cached) {
			return cached;
		}

		const result = await aiJobs.schedule<CircuitAiEnrichmentResult | undefined>({
			lane: 'circuit-ai',
			key: `circuit-ai-enrich:${signature}`,
			group: 'circuit-ai:enrich',
			priority: 20,
			run: async (signal) => {
				const graphifyEvidence = graphifyContextEnabled
					? await loadCircuitGraphifyEvidence(graph, scope, signal)
					: undefined;
				return enrichCircuitGraphWithAi(
					model,
					graph,
					{
						graphifyEvidenceText: graphifyEvidence?.compactText,
						graphifyEvidenceStatus: graphifyContextEnabled
							? graphifyEvidence?.status ?? 'fallback'
							: 'off',
						graphifyEvidenceMessage:
							graphifyEvidence?.status === 'fallback'
								? graphifyEvidence.fallbackReason || 'Graphify node evidence unavailable; using structural fallback.'
								: undefined
					},
					signal
				);
			}
		});
		if (result) {
			circuitAiCache.set(signature, result);
		}
		return result;
	};

	const requestCircuitRelationExplain = async (
		graph: CircuitGraph,
		fromNodeId: string,
		toNodeId: string
	): Promise<string | undefined> => {
		await loadModels();
		const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
		if (!model) {
			return undefined;
		}
		const relationKey = `circuit-ai-relation:${model.id}:${fromNodeId}:${toNodeId}:${graph.nodes.length}:${graph.edges.length}`;
		return aiJobs.schedule<string | undefined>({
			lane: 'circuit-ai',
			key: relationKey,
			group: 'circuit-ai:relation',
			priority: 25,
			run: async (signal) => explainCircuitNodeRelationWithAi(model, graph, fromNodeId, toNodeId, signal)
		});
	};

	const loadNodeGraphifyEvidence = async ({
		node,
		scope,
		targetNode,
		signal
	}: {
		node: CircuitNode;
		scope: 'current-file' | 'full-architecture' | 'codeflow';
		targetNode?: CircuitNode;
		signal?: AbortSignal;
	}): Promise<NodeGraphifyEvidenceResult | undefined> => {
		if (!graphifyContextEnabled) {
			return undefined;
		}
		const currentDoc = getCurrentDocument();
		const workspaceFolder =
			getNodeWorkspaceFolder(node) || (currentDoc ? vscode.workspace.getWorkspaceFolder(currentDoc.uri) : undefined);
		if (!workspaceFolder) {
			return {
				incoming: [],
				outgoing: [],
				paths: [],
				topLinkedFiles: [],
				summary: 'Graphify node evidence unavailable; using structural fallback.',
				status: 'fallback',
				fallbackReason: 'No workspace folder available.',
				compactText: 'Graphify node evidence unavailable; using structural fallback.'
			};
		}
		const graphFsPath = path.resolve(workspaceFolder.uri.fsPath, 'graphify-out', 'graph.json');
		return getNodeGraphifyEvidence({
			workspaceFsPath: workspaceFolder.uri.fsPath,
			graphFsPath,
			scope,
			node,
			targetNode,
			output,
			signal
		});
	};

	const loadCircuitGraphifyEvidence = async (
		graph: CircuitGraph,
		scope: 'current-file' | 'full-architecture' | 'codeflow',
		signal?: AbortSignal
	): Promise<NodeGraphifyEvidenceResult | undefined> => {
		if (!graphifyContextEnabled || !graph.nodes.length) {
			return undefined;
		}
		const currentDoc = getCurrentDocument();
		const workspaceFolder = currentDoc ? vscode.workspace.getWorkspaceFolder(currentDoc.uri) : undefined;
		if (!workspaceFolder) {
			return {
				incoming: [],
				outgoing: [],
				paths: [],
				topLinkedFiles: [],
				summary: 'Graphify node evidence unavailable; using structural fallback.',
				status: 'fallback',
				fallbackReason: 'No workspace folder available.',
				compactText: 'Graphify node evidence unavailable; using structural fallback.'
			};
		}
		const candidates = pickHighPriorityCircuitNodes(graph, 3);
		if (!candidates.length) {
			return {
				incoming: [],
				outgoing: [],
				paths: [],
				topLinkedFiles: [],
				summary: 'Graphify node evidence unavailable; using structural fallback.',
				status: 'fallback',
				fallbackReason: 'No circuit nodes available for evidence extraction.',
				compactText: 'Graphify node evidence unavailable; using structural fallback.'
			};
		}
		const primary = candidates[0];
		const target = candidates[1];
		const graphFsPath = path.resolve(workspaceFolder.uri.fsPath, 'graphify-out', 'graph.json');
		const collected: NodeGraphifyEvidenceResult[] = [];
		for (let i = 0; i < candidates.length; i++) {
			const evidence = await getNodeGraphifyEvidence({
				workspaceFsPath: workspaceFolder.uri.fsPath,
				graphFsPath,
				scope,
				node: candidates[i],
				targetNode: i === 0 ? target : primary,
				output,
				signal
			});
			collected.push(evidence);
		}

		const successful = collected.filter((item) => item.status === 'ok');
		if (!successful.length) {
			const firstReason = collected[0]?.fallbackReason || 'No query/path evidence available.';
			return {
				incoming: [],
				outgoing: [],
				paths: [],
				topLinkedFiles: [],
				summary: 'Graphify node evidence unavailable; using structural fallback.',
				status: 'fallback',
				fallbackReason: firstReason,
				compactText: 'Graphify node evidence unavailable; using structural fallback.'
			};
		}

		const incoming = dedupeNeighborEvidence(successful.flatMap((item) => item.incoming)).slice(0, 12);
		const outgoing = dedupeNeighborEvidence(successful.flatMap((item) => item.outgoing)).slice(0, 12);
		const paths = dedupePathEvidence(successful.flatMap((item) => item.paths)).slice(0, 8);
		const topLinkedFiles = dedupeLinkedFiles(successful.flatMap((item) => item.topLinkedFiles)).slice(0, 6);
		const compactText = capGraphifyEvidenceText(
			successful
				.map((item, idx) => `Node ${idx + 1}: ${item.summary}\n${item.compactText}`)
				.join('\n\n'),
			4800
		);
		return {
			incoming,
			outgoing,
			paths,
			topLinkedFiles,
			summary: `Aggregated Graphify node evidence for ${successful.length} priority node(s).`,
			status: 'ok',
			compactText
		};
	};

	const openBlueprintPanel = async (): Promise<void> => {
		BlueprintPanel.createOrShow(
			async (request) =>
				aiJobs.schedule({
					lane: 'blueprint',
					group: 'blueprint:chat',
					supersedeGroup: true,
					priority: 70,
					run: async (signal) => {
						await loadModels();
						if (signal.aborted) {
							throw new AiJobCancelledError(String(signal.reason ?? 'Cancelled'));
						}
						const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
						if (!model) {
							throw new Error('No AI model is currently available for Blueprint planner chat.');
						}
						const workspace = await scanSrcWorkspaceSnapshot();
						const graphifyContextText = graphifyContextEnabled
							? await loadBlueprintGraphifyContextFromWorkspace(
								request.userMessage,
								request.history as BlueprintConversationTurn[],
								signal
							)
							: undefined;
						const reply = await continueBlueprintPlanningTurn(
							model,
							request.userMessage,
							request.history as BlueprintConversationTurn[],
							workspace,
							graphifyContextText,
							signal
						);
						return reply;
					}
				}),
			async (request) =>
				aiJobs.schedule({
					lane: 'blueprint',
					group: 'blueprint:repo-chat',
					supersedeGroup: true,
					priority: 65,
					run: async (signal) => {
						await loadModels();
						if (signal.aborted) {
							throw new AiJobCancelledError(String(signal.reason ?? 'Cancelled'));
						}
						const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
						if (!model) {
							throw new Error('No AI model is currently available for Blueprint repo chat.');
						}
						const workspace = await scanSrcWorkspaceSnapshot();
						const graphifyContextText = graphifyContextEnabled
							? await loadBlueprintGraphifyContextFromWorkspace(
								request.userMessage,
								request.history as BlueprintConversationTurn[],
								signal
							)
							: undefined;
						const wantsExplain = /\bexplain\b/i.test(request.userMessage);
						const workspacePaths = workspace?.entries?.slice(0, 80).map((entry) => entry.path).join(', ') || 'unknown';
						const workspaceFns = workspace?.files?.slice(0, 40).flatMap((f) => f.functions.slice(0, 5)).slice(0, 100).join(', ') || 'unknown';
						const prompt = [
							'You are answering a simple repository question in Mushroom Blueprint panel.',
							'Do not output JSON. Give concise, concrete project/repo answers.',
							'Never include chain-of-thought, internal reasoning, self-reflection, or process narration.',
							'Never mention system/developer instructions, prompts, policies, formatting rules, or code-fence guidance.',
							'Never talk about how to answer; only provide the answer itself.',
							wantsExplain
								? 'Because user asked to explain, you may provide concise explanation up to 6 bullets and 180 words.'
								: 'Keep response ultra-brief: max 2 sentences, max 45 words, direct answer only.',
							'If unsure, say what is unknown instead of guessing.',
							'',
							`User question: ${request.userMessage}`,
							'',
							'Recent chat context:',
							...request.history.slice(-4).map((turn) => `${turn.role.toUpperCase()}: ${truncateRepoChatContext(turn.text, 280)}`),
							'',
							'Workspace path sample:',
							workspacePaths,
							'',
							'Known function sample:',
							workspaceFns,
							'',
							graphifyContextText?.trim() ? ['Graphify context:', graphifyContextText.trim()].join('\n') : ''
						].filter(Boolean).join('\n');
						const response = await requestModelText(model, prompt, { signal });
						const raw = String(response || '').trim() || 'No response generated.';
						return compactRepoChatAnswer(raw, wantsExplain);
					}
				}),
			async (request) =>
				aiJobs.schedule({
					lane: 'blueprint',
					group: 'blueprint:generate',
					supersedeGroup: true,
					priority: 80,
					run: async (signal) => {
						await loadModels();
						if (signal.aborted) {
							throw new AiJobCancelledError(String(signal.reason ?? 'Cancelled'));
						}
						const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
						if (!model) {
							throw new Error('No AI model is currently available for Blueprint generation.');
						}
						const workspace = await scanSrcWorkspaceSnapshot();
						const graphifyContextText = graphifyContextEnabled
							? await loadBlueprintGraphifyContextFromWorkspace(
								request.history.map((turn) => turn.text).join('\n'),
								request.history as BlueprintConversationTurn[],
								signal
							)
							: undefined;
						const artifacts = await generateBlueprintPlanningArtifacts(
							model,
							request.history as BlueprintConversationTurn[],
							workspace,
							graphifyContextText,
							signal
						);
						const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
						if (!workspaceFolder) {
							vscode.window.showInformationMessage('Blueprint prompt artifacts generated.');
							return artifacts;
						}
						const registryUpdate = await upsertBlueprintFeatureFromArtifacts(workspaceFolder, artifacts, {
							status: 'draft',
							forcedFeatureId: request.forcedFeatureId
						});
						vscode.window.showInformationMessage('Blueprint prompt artifacts generated.');
						return {
							...artifacts,
							featureTracking: {
								featureId: registryUpdate.record.featureId,
								registryPath: registryUpdate.registryPath,
								status: registryUpdate.record.status,
								matchedExistingFeatureId: registryUpdate.matchedExistingFeatureId,
								overlapScore: registryUpdate.overlapScore,
								isForcedLink: Boolean(request.forcedFeatureId),
								forcedFeatureId: request.forcedFeatureId || undefined,
								matchBand: toMatchBand(registryUpdate.overlapScore)
							}
						};
					}
				}),
			async (artifacts) => {
				if (!artifacts) {
					return {
						saved: false,
						message: 'No generated artifacts found. Click Generate first.'
					};
				}
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					return {
						saved: false,
						message: 'No workspace folder is open.'
					};
				}

				const chosen = await vscode.window.showWarningMessage(
					'Save Blueprint spec + prompt into docs/feature-plans now?',
					{ modal: true },
					'Save Spec'
				);
				if (chosen !== 'Save Spec') {
					return {
						saved: false,
						message: 'Save cancelled.'
					};
				}

				const fileName = makeBlueprintSpecFileName(artifacts);
				const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, 'docs', 'feature-plans', fileName);
				const workspaceFsPath = path.resolve(workspaceFolder.uri.fsPath);
				const targetFsPath = path.resolve(targetUri.fsPath);
				if (!targetFsPath.toLowerCase().startsWith(workspaceFsPath.toLowerCase())) {
					return {
						saved: false,
						message: 'Blocked path traversal while saving blueprint spec.'
					};
				}

				const parentUri = vscode.Uri.joinPath(workspaceFolder.uri, 'docs', 'feature-plans');
				try {
					await vscode.workspace.fs.createDirectory(parentUri);
				} catch {
					// Directory already exists.
				}
				const content = renderBlueprintSpecMarkdown(artifacts);
				await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(content));
				const savedPath = `docs/feature-plans/${fileName}`;
				const registryUpdate = await upsertBlueprintFeatureFromArtifacts(workspaceFolder, artifacts, {
					status: 'saved',
					savedSpecPath: savedPath,
					forcedFeatureId: artifacts.featureTracking?.forcedFeatureId
				});
				artifacts.featureTracking = {
					featureId: registryUpdate.record.featureId,
					registryPath: registryUpdate.registryPath,
					status: registryUpdate.record.status,
					matchedExistingFeatureId: registryUpdate.matchedExistingFeatureId,
					overlapScore: registryUpdate.overlapScore,
					isForcedLink: Boolean(artifacts.featureTracking?.forcedFeatureId),
					forcedFeatureId: artifacts.featureTracking?.forcedFeatureId,
					matchBand: toMatchBand(registryUpdate.overlapScore)
				};
				vscode.window.showInformationMessage(`Blueprint spec saved: docs/feature-plans/${fileName}`);
				return {
					saved: true,
					path: savedPath,
					message: `Saved blueprint spec to ${savedPath}\nFeature ID: ${registryUpdate.record.featureId}\nRegistry: ${registryUpdate.registryPath}`
				};
			},
			async () => {
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (!workspaceFolder) {
					return [];
				}
				return listBlueprintFeatureOptions(workspaceFolder);
			},
			{
				initialGraphifyContextEnabled: graphifyContextEnabled
			}
		);
	};

	const loadBlueprintGraphifyContextFromWorkspace = async (
		featureText: string,
		history: BlueprintConversationTurn[],
		signal?: AbortSignal
	): Promise<string | undefined> => {
		const currentDocument = getCurrentDocument();
		const workspaceFolder = currentDocument
			? vscode.workspace.getWorkspaceFolder(currentDocument.uri)
			: vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			output.appendLine('blueprint graphify context unavailable: no workspace folder');
			return undefined;
		}
		try {
			const contextText = await buildBlueprintGraphifyContext({
				workspaceFsPath: workspaceFolder.uri.fsPath,
				featureText,
				history,
				output,
				signal
			});
			if (!contextText?.trim()) {
				output.appendLine('blueprint graphify context unavailable: using workspace snapshot fallback');
				return undefined;
			}
			output.appendLine('blueprint graphify context loaded');
			return contextText;
		} catch (error) {
			output.appendLine(
				`blueprint graphify context failed: ${String((error as { message?: string } | undefined)?.message || error)}`
			);
			return undefined;
		}
	};

	const commandDisposables = registerPceCommands({
		extensionUri: context.extensionUri,
		output,
		getCurrentDocument,
		getLastEditorColumn: () => lastEditorColumn,
		setLastEditorColumn: (column) => {
			lastEditorColumn = column;
		},
		loadModels,
		getAvailableModels: () => availableModels,
		getSelectedModelId: () => selectedModelId,
		setSelectedModelId: (id) => {
			selectedModelId = id;
		},
		getSelectedResponseMode: () => selectedResponseMode,
		setSelectedResponseMode: (mode) => {
			selectedResponseMode = mode;
		},
		getGraphifyContextEnabled: () => graphifyContextEnabled,
		setGraphifyContextEnabled: (enabled) => {
			graphifyContextEnabled = enabled;
			void context.workspaceState.update('mushroom-pce.graphifyContextEnabled', enabled);
		},
		applyModeStateToPanel,
		applyGraphifyStateToPanel,
		applyModelStateToPanel,
		applySymbolStateToPanel,
		tryRestoreCachedAnalysis,
		runAnalysis,
		askNodeQuestion,
		requestCircuitAiEnrichment,
		requestCircuitRelationExplain,
		openBlueprintPanel
	});

	const statusBarAnalyze = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarAnalyze.text = '$(sparkle) PCE Analyze';
	statusBarAnalyze.tooltip = 'Analyze active file with Mushroom PCE';
	statusBarAnalyze.command = 'mushroom-pce.analyzeActive';
	statusBarAnalyze.show();

	const onEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
		rememberEditor(editor);
		const panel = MushroomPanel.getCurrentPanel();
		if (panel && !panel.isDisposed() && editor?.document) {
			void applySymbolStateToPanel(panel, editor.document);
		}
	});

	const onDocumentChange = vscode.workspace.onDidChangeTextDocument((event) => {
		const panel = MushroomPanel.getCurrentPanel();
		if (!panel || panel.isDisposed()) {
			return;
		}
		if (!lastDocument || event.document.uri.toString() !== lastDocument.uri.toString()) {
			return;
		}

		if (symbolIndexTimer) {
			clearTimeout(symbolIndexTimer);
		}
		symbolIndexTimer = setTimeout(() => {
			void applySymbolStateToPanel(panel, event.document);
		}, 250);
	});

	context.subscriptions.push(
		...commandDisposables,
		statusBarAnalyze,
		output,
		onEditorChange,
		onDocumentChange
	);
}

function makeBlueprintSpecFileName(artifacts: BlueprintPlanningArtifacts): string {
	const featureIdPart = String(artifacts.featureTracking?.featureId || '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '')
		.slice(0, 36);
	const slug = String(artifacts.featureName || 'feature-plan')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'feature-plan';
	const stamp = new Date(artifacts.generatedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
	return featureIdPart ? `${slug}-${featureIdPart}-${stamp}.md` : `${slug}-${stamp}.md`;
}

function renderBlueprintSpecMarkdown(artifacts: BlueprintPlanningArtifacts): string {
	const tracking = artifacts.featureTracking;
	return [
		`# ${artifacts.featureName} Blueprint Spec`,
		'',
		`Generated: ${new Date(artifacts.generatedAt).toISOString()}`,
		`Model: ${artifacts.modelLabel ?? 'unknown'}`,
		tracking ? `Feature ID: ${tracking.featureId}` : '',
		tracking ? `Registry: ${tracking.registryPath}` : '',
		tracking ? `Tracking Status: ${tracking.status}` : '',
		'',
		'## JSON Spec',
		'```json',
		JSON.stringify(artifacts.spec, null, 2),
		'```',
		'',
		'## Prompt',
		'```text',
		String(artifacts.prompt || ''),
		'```',
		''
	].join('\n');
}

function toMatchBand(score: number | undefined): 'high' | 'medium' | 'low' {
	const normalized = typeof score === 'number' && Number.isFinite(score) ? score : 0;
	if (normalized >= 0.75) {
		return 'high';
	}
	if (normalized >= 0.5) {
		return 'medium';
	}
	return 'low';
}

function truncateRepoChatContext(text: string, maxChars: number): string {
	const normalized = String(text || '').replace(/\s+/g, ' ').trim();
	if (normalized.length <= maxChars) {
		return normalized;
	}
	return `${normalized.slice(0, maxChars)} ...[truncated]`;
}

function compactRepoChatAnswer(raw: string, allowExplain: boolean): string {
	let text = String(raw || '').trim();
	if (!text) {
		return 'No response generated.';
	}
	// Strip common "thinking/process/meta" lead-ins if model drifts.
	text = text
		// Bold meta headers like "**Summarizing ...**"
		.replace(/^\s*\*\*[^*\n]{0,140}\*\*\s*/gim, '')
		.replace(/\*\*?(summarizing|summary|explaining|reasoning|thinking|analysis|planning|crafting|clarifying)[^*\n]*\*\*?/gi, '')
		// Meta lead-ins like "Explaining ...:" or "Analysis:"
		.replace(/^(summarizing|summary|explaining|reasoning|thinking|analysis|planning|crafting|clarifying)[^:\n]*:\s*/gim, '')
		// First-person process narration
		.replace(/^(i\s+(need|should|must|will|can)\s+to[^.\n]*[.\n]?)+/gim, '')
		.replace(/^(let\s+me|i(?:'| a)m\s+going\s+to|i(?:'| a)m\s+ready\s+to)[^.\n]*[.\n]?/gim, '')
		.replace(/^(here(?:'| i)s\s+(a\s+)?(concise|brief|short)\s+(summary|answer)[:\-\s]*)/gim, '')
		.trim();
	text = text.replace(/\n{3,}/g, '\n\n').trim();
	text = stripMetaSentences(text);
	if (allowExplain) {
		const words = text.split(/\s+/).filter(Boolean);
		if (words.length <= 180) {
			return text;
		}
		return `${words.slice(0, 180).join(' ')} ...`;
	}
	const compact = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
	const words = compact.split(/\s+/).filter(Boolean);
	const limited = words.slice(0, 45).join(' ');
	return limited || 'No response generated.';
}

function stripMetaSentences(text: string): string {
	const normalized = String(text || '').replace(/\r/g, '').trim();
	if (!normalized) {
		return normalized;
	}
	const sentenceLike = normalized
		.split(/(?<=[.!?])\s+|\n+/)
		.map((part) => part.trim())
		.filter(Boolean);
	const banned = [
		/\bdeveloper\b/i,
		/\bsystem\b/i,
		/\binstruction(s)?\b/i,
		/\bprompt\b/i,
		/\bpolicy\b/i,
		/\bformat(ting)?\b/i,
		/\bcode\s*block\b/i,
		/\btriple\s*backtick\b/i,
		/\bshould\s+avoid\b/i,
		/\bI need to\b/i
	];
	const kept = sentenceLike.filter((sentence) => !banned.some((pattern) => pattern.test(sentence)));
	return (kept.length ? kept.join(' ') : normalized).trim();
}


async function explainCode(
	model: vscode.LanguageModelChat,
	code: string,
	languageId: string,
	responseMode: ResponseMode,
	graphContext?: string,
	onChunk?: (chunk: string) => void,
	signal?: AbortSignal
): Promise<string | undefined> {
	try {
		const prompt = buildPrompt(languageId, code, responseMode, { graphContext });
		return await requestModelText(model, prompt, { onChunk, signal });
	} catch (error: any) {
		vscode.window.showErrorMessage('Error: ' + error.message);
		return;
	}
}

function getNodeWorkspaceFolder(node: CircuitNode): vscode.WorkspaceFolder | undefined {
	if (!node.uri) {
		return undefined;
	}
	try {
		return vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(node.uri));
	} catch {
		return undefined;
	}
}

function pickHighPriorityCircuitNodes(graph: CircuitGraph, maxCount: number): CircuitNode[] {
	const degree = new Map<string, number>();
	for (const edge of graph.edges) {
		degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
		degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
	}
	return [...graph.nodes]
		.filter((node) => node.type !== 'sink')
		.sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
		.slice(0, maxCount);
}

function dedupeNeighborEvidence(
	items: NodeGraphifyEvidenceResult['incoming']
): NodeGraphifyEvidenceResult['incoming'] {
	const seen = new Set<string>();
	const out: NodeGraphifyEvidenceResult['incoming'] = [];
	for (const item of items) {
		const key = `${item.node.toLowerCase()}|${item.relation.toLowerCase()}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(item);
	}
	return out;
}

function dedupePathEvidence(items: NodeGraphifyEvidenceResult['paths']): NodeGraphifyEvidenceResult['paths'] {
	const seen = new Set<string>();
	const out: NodeGraphifyEvidenceResult['paths'] = [];
	for (const item of items) {
		const key = `${item.from.toLowerCase()}|${item.to.toLowerCase()}|${item.summary.toLowerCase()}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(item);
	}
	return out;
}

function dedupeLinkedFiles(
	items: NodeGraphifyEvidenceResult['topLinkedFiles']
): NodeGraphifyEvidenceResult['topLinkedFiles'] {
	const scoreByPath = new Map<string, number>();
	for (const item of items) {
		scoreByPath.set(item.path, Math.max(scoreByPath.get(item.path) ?? 0, item.score));
	}
	return Array.from(scoreByPath.entries())
		.map(([pathValue, score]) => ({ path: pathValue, score, source: 'graphify' }))
		.sort((a, b) => b.score - a.score);
}

function capGraphifyEvidenceText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n\n[Graphify node evidence truncated]`;
}

type SystemRoleBucket = 'big_machine' | 'connector' | 'small_cog';

type GraphifyDeveloperContextEnvelope = {
	promptContext: string;
	fingerprint: string;
};

type LinkedFileMetrics = {
	path: string;
	fanIn: number;
	fanOut: number;
	pathHits: number;
	dependencySpreadTags: Set<string>;
	lines: number[];
	score: number;
	snippet?: string;
};

type GraphifySmartContextSummary = {
	text: string;
	linkedFileIds: string[];
	roleBucket: SystemRoleBucket;
	fingerprintCore: string;
};

async function loadGraphifyDeveloperContext(
	document: vscode.TextDocument,
	output: vscode.OutputChannel,
	signal?: AbortSignal
): Promise<GraphifyDeveloperContextEnvelope | undefined> {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!workspaceFolder) {
		return undefined;
	}

	const reportUri = vscode.Uri.joinPath(workspaceFolder.uri, 'graphify-out', 'GRAPH_REPORT.md');
	const graphUri = vscode.Uri.joinPath(workspaceFolder.uri, 'graphify-out', 'graph.json');
	try {
		const [reportBytes, reportStats, graphStats] = await Promise.all([
			vscode.workspace.fs.readFile(reportUri),
			vscode.workspace.fs.stat(reportUri),
			vscode.workspace.fs.stat(graphUri)
		]);
		const reportText = new TextDecoder().decode(reportBytes).trim();
		if (!reportText) {
			return undefined;
		}

		const maxChars = 7000;
		const cappedReport =
			reportText.length > maxChars ? `${reportText.slice(0, maxChars)}\n\n[Graphify context truncated]` : reportText;

		let freshnessNote = '';
		let staleForActiveFile = false;
		try {
			const docStats = await vscode.workspace.fs.stat(document.uri);
			if (docStats.mtime > reportStats.mtime) {
				staleForActiveFile = true;
				freshnessNote = 'Note: Graphify report may be stale for latest file edits.';
				output.appendLine('graphify context loaded (report older than active file)');
			}
		} catch {
			// Ignore stat comparison errors and proceed with available graph context.
		}

		const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath).replace(/\\/g, '/');
		const smartContext = await loadGraphifySmartQueryContext({
			workspaceFsPath: workspaceFolder.uri.fsPath,
			graphFsPath: graphUri.fsPath,
			relativePath,
			document,
			output,
			signal
		});
		const freshnessMarker = `${reportStats.mtime}-${graphStats.mtime}-${staleForActiveFile ? 'stale' : 'fresh'}`;
		const fallbackNote =
			smartContext === undefined
				? 'Linked Context Status: unavailable (graph query/path/snippet evidence not found); analysis falls back to current-file + report context.'
				: '';
		const promptContext = [
			`Active file: ${relativePath}`,
			freshnessNote,
			`Graph freshness marker: ${freshnessMarker}`,
			'',
			cappedReport,
			smartContext?.text,
			fallbackNote
		]
			.filter(Boolean)
			.join('\n');

		const linkedFilesPart = smartContext?.linkedFileIds.join(',') || 'none';
		const rolePart = smartContext?.roleBucket || 'small_cog';
		const fingerprint = `gctx-v3|fresh=${freshnessMarker}|role=${rolePart}|links=${linkedFilesPart}|core=${smartContext?.fingerprintCore || 'none'}`;
		return {
			promptContext,
			fingerprint
		};
	} catch {
		output.appendLine('graphify context unavailable (missing graphify-out/GRAPH_REPORT.md)');
		return undefined;
	}
}

type GraphifySmartContextOptions = {
	workspaceFsPath: string;
	graphFsPath: string;
	relativePath: string;
	document: vscode.TextDocument;
	output: vscode.OutputChannel;
	signal?: AbortSignal;
};

type GraphifyCommandResult = {
	success: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

async function loadGraphifySmartQueryContext(options: GraphifySmartContextOptions): Promise<GraphifySmartContextSummary | undefined> {
	const { output, graphFsPath, workspaceFsPath } = options;
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(graphFsPath));
	} catch {
		output.appendLine('graphify smart queries skipped (missing graphify-out/graph.json)');
		return undefined;
	}

	const primarySymbol = guessPrimarySymbol(options.document.getText());
	const queries = buildGraphifySmartQueries(options.relativePath, primarySymbol);
	const pathPairs = buildGraphifyPathPairs(options.relativePath, primarySymbol);
	if (!queries.length) {
		return undefined;
	}

	const activeFsPath = normalizeFsPath(path.resolve(workspaceFsPath, options.relativePath));
	const metricsByFile = new Map<string, LinkedFileMetrics>();
	const queryOutputs: Array<{ query: string; text: string }> = [];
	const querySections: string[] = [];
	for (const query of queries) {
		if (options.signal?.aborted) {
			return undefined;
		}
		const result = await runGraphifyQueryCommand(query, options.graphFsPath, options.workspaceFsPath, options.signal);
		if (!result.success) {
			const reason = result.timedOut
				? 'timeout'
				: result.stderr.trim()
					? result.stderr.trim()
					: `exit=${String(result.exitCode)}`;
			output.appendLine(`graphify query failed: "${query}" (${reason})`);
			continue;
		}
		const cleaned = result.stdout.trim();
		if (!cleaned || /^No matching nodes found\.?$/i.test(cleaned)) {
			output.appendLine(`graphify query empty: "${query}"`);
			continue;
		}
		queryOutputs.push({ query, text: cleaned });
		collectLinkedMetricsFromOutput(cleaned, query, metricsByFile, activeFsPath);
		const maxCharsPerQuery = 1800;
		const capped = cleaned.length > maxCharsPerQuery ? `${cleaned.slice(0, maxCharsPerQuery)}\n... [truncated]` : cleaned;
		querySections.push(`Query: ${query}\n${capped}`);
	}

	const pathOutputs: Array<{ from: string; to: string; text: string }> = [];
	const pathSections: string[] = [];
	for (const pair of pathPairs) {
		if (options.signal?.aborted) {
			return undefined;
		}
		const pathResult = await runGraphifyPathCommand(pair.from, pair.to, options.graphFsPath, options.workspaceFsPath, options.signal);
		if (!pathResult.success) {
			const reason = pathResult.timedOut
				? 'timeout'
				: pathResult.stderr.trim()
					? pathResult.stderr.trim()
					: `exit=${String(pathResult.exitCode)}`;
			output.appendLine(`graphify path failed: "${pair.from}" -> "${pair.to}" (${reason})`);
			continue;
		}
		const cleaned = pathResult.stdout.trim();
		if (!cleaned || /^No path found\.?$/i.test(cleaned) || /^No matching nodes found\.?$/i.test(cleaned)) {
			output.appendLine(`graphify path empty: "${pair.from}" -> "${pair.to}"`);
			continue;
		}
		pathOutputs.push({ from: pair.from, to: pair.to, text: cleaned });
		collectLinkedMetricsFromOutput(cleaned, `path:${pair.from}->${pair.to}`, metricsByFile, activeFsPath, true);
		const maxCharsPerPath = 1600;
		const capped = cleaned.length > maxCharsPerPath ? `${cleaned.slice(0, maxCharsPerPath)}\n... [truncated]` : cleaned;
		pathSections.push(`Path: ${pair.from} -> ${pair.to}\n${capped}`);
	}

	if (!querySections.length && !pathSections.length) {
		return undefined;
	}

	const rankedLinked = Array.from(metricsByFile.values())
		.map((entry) => ({
			...entry,
			score: entry.fanIn * 3 + entry.fanOut * 2 + entry.pathHits * 2 + entry.dependencySpreadTags.size
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, 3);

	for (const entry of rankedLinked) {
		entry.snippet = await buildLinkedFileSnippet(entry.path, entry.lines, workspaceFsPath, options.signal);
	}

	const roleBucket = classifySystemRole(metricsByFile);
	const roleExplanation = buildRoleExplanation(roleBucket, metricsByFile, rankedLinked);

	const combinedBlocks: string[] = [];
	if (querySections.length) {
		combinedBlocks.push(
			'Graphify Smart Query Context (CLI):',
			...querySections.map((section) => `\`\`\`text\n${section}\n\`\`\``)
		);
	}
	if (pathSections.length) {
		combinedBlocks.push(
			'Graphify Path Evidence (CLI):',
			...pathSections.map((section) => `\`\`\`text\n${section}\n\`\`\``)
		);
	}
	if (rankedLinked.length) {
		combinedBlocks.push(
			'Linked File Context Snippets (Top 3, ~80 lines each):',
			...rankedLinked.map((entry) => {
				const rel = toWorkspaceRelative(entry.path, workspaceFsPath);
				const snippetText = entry.snippet || '(snippet unavailable)';
				return [
					`\`\`\`text`,
					`File: ${rel}`,
					`Metrics: fanIn=${entry.fanIn}, fanOut=${entry.fanOut}, pathHits=${entry.pathHits}, dependencySpread=${entry.dependencySpreadTags.size}, score=${entry.score}`,
					snippetText,
					`\`\`\``
				].join('\n');
			})
		);
	}
	combinedBlocks.push(
		'System Role Inference (Graphify):',
		`\`\`\`text\nRole: ${roleBucket}\n${roleExplanation}\n\`\`\``
	);
	const combined = combinedBlocks.join('\n\n');

	const maxTotalChars = 5000;
	const text = combined.length > maxTotalChars ? `${combined.slice(0, maxTotalChars)}\n\n[Smart query context truncated]` : combined;
	const linkedFileIds = rankedLinked.map((entry) => toWorkspaceRelative(entry.path, workspaceFsPath));
	const fingerprintCore = [
		`role=${roleBucket}`,
		...linkedFileIds,
		...queryOutputs.slice(0, 2).map((item) => item.query),
		...pathOutputs.slice(0, 2).map((item) => `${item.from}->${item.to}`)
	].join('|');
	return { text, linkedFileIds, roleBucket, fingerprintCore };
}

function collectLinkedMetricsFromOutput(
	outputText: string,
	queryLabel: string,
	metricsByFile: Map<string, LinkedFileMetrics>,
	activeFsPath: string,
	fromPathCommand = false
): void {
	const mentions = extractGraphifySourceMentions(outputText);
	const queryKey = queryLabel.toLowerCase();
	for (const mention of mentions) {
		const normalized = normalizeFsPath(mention.path);
		if (!normalized || normalized === activeFsPath) {
			continue;
		}
		const metric = metricsByFile.get(normalized) || {
			path: normalized,
			fanIn: 0,
			fanOut: 0,
			pathHits: 0,
			dependencySpreadTags: new Set<string>(),
			lines: [],
			score: 0
		};
		if (queryKey.includes('what calls') || queryKey.includes('depend on')) {
			metric.fanIn += 1;
		}
		if (queryKey.includes('what does') || queryKey.includes('calls from')) {
			metric.fanOut += 1;
		}
		if (queryKey.includes('connects') || queryKey.includes('architecture flow')) {
			metric.dependencySpreadTags.add('topology');
		}
		if (fromPathCommand || queryKey.startsWith('path:')) {
			metric.pathHits += 1;
			metric.dependencySpreadTags.add('path');
		}
		if (typeof mention.line === 'number' && Number.isFinite(mention.line)) {
			metric.lines.push(mention.line);
		}
		if (queryKey.includes('what calls')) {
			metric.dependencySpreadTags.add('incoming-call');
		}
		if (queryKey.includes('what does')) {
			metric.dependencySpreadTags.add('outgoing-call');
		}
		metricsByFile.set(normalized, metric);
	}
}

function extractGraphifySourceMentions(outputText: string): Array<{ path: string; line?: number }> {
	const mentions: Array<{ path: string; line?: number }> = [];
	const nodeRegex = /NODE[^\n]*?\[src=([^\]\r\n]+?)(?:\s+loc=L(\d+))?[^\]]*\]/g;
	let nodeMatch: RegExpExecArray | null;
	while ((nodeMatch = nodeRegex.exec(outputText)) !== null) {
		mentions.push({
			path: nodeMatch[1]?.trim() || '',
			line: nodeMatch[2] ? Number.parseInt(nodeMatch[2], 10) : undefined
		});
	}

	const srcRegex = /src=([^\]\r\n]+?)(?:\s|]|$)/g;
	let srcMatch: RegExpExecArray | null;
	while ((srcMatch = srcRegex.exec(outputText)) !== null) {
		mentions.push({
			path: srcMatch[1]?.trim() || ''
		});
	}
	return mentions.filter((item) => Boolean(item.path));
}

async function buildLinkedFileSnippet(
	targetFsPath: string,
	lines: number[],
	workspaceFsPath: string,
	signal?: AbortSignal
): Promise<string | undefined> {
	if (signal?.aborted) {
		return undefined;
	}
	const normalized = normalizeFsPath(targetFsPath);
	const workspaceNorm = normalizeFsPath(workspaceFsPath);
	if (!normalized.startsWith(workspaceNorm)) {
		return undefined;
	}
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(normalized));
		const text = new TextDecoder().decode(bytes);
		const fileLines = text.split(/\r?\n/);
		if (!fileLines.length) {
			return undefined;
		}
		const center = chooseSnippetCenterLine(lines, fileLines.length);
		const radius = 40;
		const start = Math.max(1, center - radius);
		const end = Math.min(fileLines.length, center + radius - 1);
		const snippet = fileLines.slice(start - 1, end).map((line, idx) => {
			const lineNo = start + idx;
			return `${String(lineNo).padStart(4, ' ')} | ${line}`;
		});
		return snippet.join('\n');
	} catch {
		return undefined;
	}
}

function chooseSnippetCenterLine(lines: number[], max: number): number {
	const valid = lines.filter((line) => Number.isFinite(line) && line >= 1 && line <= max);
	if (!valid.length) {
		return Math.min(max, 40);
	}
	const sorted = [...valid].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] || sorted[0] || 1;
}

function classifySystemRole(metricsByFile: Map<string, LinkedFileMetrics>): SystemRoleBucket {
	const all = Array.from(metricsByFile.values());
	const totalFanIn = all.reduce((sum, item) => sum + item.fanIn, 0);
	const totalFanOut = all.reduce((sum, item) => sum + item.fanOut, 0);
	const totalPathHits = all.reduce((sum, item) => sum + item.pathHits, 0);
	const spread = all.length;

	if ((totalFanIn >= 6 && spread >= 3) || (totalPathHits >= 6 && totalFanIn >= 4)) {
		return 'big_machine';
	}
	if ((totalFanIn >= 3 && totalFanOut >= 2) || spread >= 2) {
		return 'connector';
	}
	return 'small_cog';
}

function buildRoleExplanation(
	role: SystemRoleBucket,
	metricsByFile: Map<string, LinkedFileMetrics>,
	rankedLinked: LinkedFileMetrics[]
): string {
	const all = Array.from(metricsByFile.values());
	const totalFanIn = all.reduce((sum, item) => sum + item.fanIn, 0);
	const totalFanOut = all.reduce((sum, item) => sum + item.fanOut, 0);
	const totalPathHits = all.reduce((sum, item) => sum + item.pathHits, 0);
	const topLinks = rankedLinked.map((entry) => path.basename(entry.path)).join(', ') || 'none';
	return [
		`Reasoning: fanIn=${totalFanIn}, fanOut=${totalFanOut}, pathHits=${totalPathHits}, linkedFiles=${all.length}.`,
		`Top linked files: ${topLinks}.`,
		role === 'big_machine'
			? 'Interpretation: active file appears to be a central orchestrator in the local system graph.'
			: role === 'connector'
				? 'Interpretation: active file appears to bridge subsystems and coordinate flows.'
				: 'Interpretation: active file appears to be a focused leaf/helper component in the local system graph.'
	].join('\n');
}

function toWorkspaceRelative(filePath: string, workspaceFsPath: string): string {
	return path.relative(workspaceFsPath, filePath).replace(/\\/g, '/');
}

function normalizeFsPath(filePath: string): string {
	return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function buildGraphifySmartQueries(relativePath: string, primarySymbol?: string): string[] {
	const fileName = path.basename(relativePath);
	const queries = [
		`show architecture flow for ${relativePath}`,
		`what connects ${fileName} to ${primarySymbol || 'the rest of the codebase'}?`,
		`what modules depend on ${fileName}?`,
		`what calls ${primarySymbol || fileName}?`,
		`what does ${primarySymbol || fileName} call?`
	];
	return Array.from(new Set(queries.map((item) => item.trim()).filter(Boolean)));
}

function buildGraphifyPathPairs(relativePath: string, primarySymbol?: string): Array<{ from: string; to: string }> {
	const fileName = path.basename(relativePath);
	const candidates: Array<{ from: string; to: string }> = [];
	if (primarySymbol) {
		candidates.push({ from: fileName, to: primarySymbol });
		candidates.push({ from: primarySymbol, to: 'requestModelText' });
		candidates.push({ from: primarySymbol, to: 'registerPceCommands' });
	}
	candidates.push({ from: fileName, to: 'requestModelText' });
	return candidates.filter((pair, index, arr) => {
		if (!pair.from || !pair.to || pair.from === pair.to) {
			return false;
		}
		const key = `${pair.from}::${pair.to}`;
		return arr.findIndex((p) => `${p.from}::${p.to}` === key) === index;
	});
}

function guessPrimarySymbol(code: string): string | undefined {
	const functionMatch = code.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
	if (functionMatch?.[1]) {
		return functionMatch[1];
	}
	const constFnMatch = code.match(/(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/);
	if (constFnMatch?.[1]) {
		return constFnMatch[1];
	}
	return undefined;
}

async function runGraphifyQueryCommand(
	query: string,
	graphFsPath: string,
	workspaceFsPath: string,
	signal?: AbortSignal
): Promise<GraphifyCommandResult> {
	return runGraphifyGraphCommand(['query', query, '--graph', graphFsPath], workspaceFsPath, signal);
}

async function runGraphifyPathCommand(
	from: string,
	to: string,
	graphFsPath: string,
	workspaceFsPath: string,
	signal?: AbortSignal
): Promise<GraphifyCommandResult> {
	return runGraphifyGraphCommand(['path', from, to, '--graph', graphFsPath], workspaceFsPath, signal);
}

async function runGraphifyGraphCommand(
	args: string[],
	workspaceFsPath: string,
	signal?: AbortSignal
): Promise<GraphifyCommandResult> {
	return new Promise<GraphifyCommandResult>((resolve) => {
		const child = spawn('graphify', args, {
			cwd: workspaceFsPath,
			shell: false
		});

		let stdout = '';
		let stderr = '';
		let settled = false;
		let timedOut = false;
		const timeoutMs = 3500;
		const timer = setTimeout(() => {
			timedOut = true;
			if (!child.killed) {
				child.kill();
			}
		}, timeoutMs);

		const onAbort = () => {
			if (!child.killed) {
				child.kill();
			}
		};
		if (signal) {
			signal.addEventListener('abort', onAbort, { once: true });
		}

		child.stdout.on('data', (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		child.on('error', (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}
			resolve({
				success: false,
				exitCode: null,
				stdout,
				stderr: stderr || String(error?.message ?? error),
				timedOut
			});
		});

		child.on('close', (code) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}
			resolve({
				success: !timedOut && code === 0,
				exitCode: code,
				stdout,
				stderr,
				timedOut
			});
		});
	});
}


