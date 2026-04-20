import * as vscode from 'vscode';
import * as path from 'path';

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
import { CircuitAiEnrichmentResult, CircuitGraph } from '../shared/types/circuitTypes';
import { explainCircuitNodeRelationWithAi } from '../services/circuit/ai/explainNodeRelation';
import {
	BlueprintConversationTurn,
	BlueprintPlanningArtifacts,
	continueBlueprintPlanningTurn,
	generateBlueprintPlanningArtifacts
} from '../services/blueprint/generateBlueprintCode';
import { scanSrcWorkspaceSnapshot } from '../services/blueprint/scanWorkspaceBlueprint';

export function activateApp(context: vscode.ExtensionContext) {
	let latestRunId = 0;
	const output = vscode.window.createOutputChannel('Mushroom PCE');
	let lastDocument: vscode.TextDocument | undefined;
	let lastEditorColumn: vscode.ViewColumn = vscode.ViewColumn.One;

	let availableModels: vscode.LanguageModelChat[] = [];
	let selectedModelId: string | undefined;
	let selectedResponseMode: ResponseMode = 'developer';

	let symbolIndexTimer: ReturnType<typeof setTimeout> | undefined;
	type CacheEntry = { text: string; updatedAt: number; docVersion: number };
	const analysisCache = new Map<string, CacheEntry>();
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

	const getCurrentDocument = (): vscode.TextDocument | undefined => {
		const editor = vscode.window.activeTextEditor;
		return editor?.document ?? lastDocument;
	};

	const getCacheKey = (
		doc: vscode.TextDocument,
		mode: ResponseMode,
		options?: { modelId?: string; listVariant?: ListModeVariant }
	): string => {
		if (mode === 'list') {
			const listVariant = options?.listVariant ?? 'list-local';
			return `${doc.uri.toString()}::${listVariant}::${mode}`;
		}
		const keyModel = options?.modelId ?? 'no-model';
		return `${doc.uri.toString()}::${keyModel}::${mode}`;
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
			const key = getCacheKey(doc, selectedResponseMode, { modelId: modelIdForCache });
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
					const explanation = await explainCode(
						model,
						code,
						document.languageId,
						selectedResponseMode,
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
						cacheModelId: model.id
					};
				}
			});

			if (runId !== latestRunId || panel.isDisposed()) {
				return;
			}

			panel.setExplanation(result.explanation);
			if (result.explanation && result.status !== 'No model available') {
				const cacheKey = getCacheKey(document, selectedResponseMode, {
					modelId: result.cacheModelId,
					listVariant: result.cacheListVariant
				});
				analysisCache.set(cacheKey, { text: result.explanation, updatedAt: Date.now(), docVersion: document.version });
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

				const prompt = buildNodeDetailsPrompt(request);
				const responseText = await requestModelText(model, prompt, { signal });
				return responseText || 'No response generated.';
			}
		});
	};

	const requestCircuitAiEnrichment = async (graph: CircuitGraph): Promise<CircuitAiEnrichmentResult | undefined> => {
		await loadModels();
		const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
		if (!model) {
			return undefined;
		}

		const signature = JSON.stringify({
			modelId: model.id,
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
			run: async (signal) => enrichCircuitGraphWithAi(model, graph, signal)
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
						const reply = await continueBlueprintPlanningTurn(
							model,
							request.userMessage,
							request.history as BlueprintConversationTurn[],
							workspace,
							signal
						);
						return reply;
					}
				}),
			async (history) =>
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
						const artifacts = await generateBlueprintPlanningArtifacts(
							model,
							history as BlueprintConversationTurn[],
							workspace,
							signal
						);
						vscode.window.showInformationMessage('Blueprint prompt artifacts generated.');
						return artifacts;
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
				vscode.window.showInformationMessage(`Blueprint spec saved: docs/feature-plans/${fileName}`);
				return {
					saved: true,
					path: `docs/feature-plans/${fileName}`,
					message: `Saved blueprint spec to docs/feature-plans/${fileName}`
				};
			}
		);
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
		applyModeStateToPanel,
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
	const slug = String(artifacts.featureName || 'feature-plan')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'feature-plan';
	const stamp = new Date(artifacts.generatedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
	return `${slug}-${stamp}.md`;
}

function renderBlueprintSpecMarkdown(artifacts: BlueprintPlanningArtifacts): string {
	return [
		`# ${artifacts.featureName} Blueprint Spec`,
		'',
		`Generated: ${new Date(artifacts.generatedAt).toISOString()}`,
		`Model: ${artifacts.modelLabel ?? 'unknown'}`,
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


async function explainCode(
	model: vscode.LanguageModelChat,
	code: string,
	languageId: string,
	responseMode: ResponseMode,
	onChunk?: (chunk: string) => void,
	signal?: AbortSignal
): Promise<string | undefined> {
	try {
		const prompt = buildPrompt(languageId, code, responseMode);
		return await requestModelText(model, prompt, { onChunk, signal });
	} catch (error: any) {
		vscode.window.showErrorMessage('Error: ' + error.message);
		return;
	}
}


