import * as vscode from 'vscode';

import { requestModelText } from '../services/ai/requestModelText';
import { buildListModeOutput } from '../services/analysis/buildListModeOutput';
import { buildNodeDetailsPrompt, buildPrompt } from '../services/prompts/buildPrompt';
import { MushroomPanel } from '../controllers/mushroom/MushroomPanelController';
import { parseSymbolLocations } from '../services/symbols/parseSymbolLocations';
import { ResponseMode, SymbolLink } from '../shared/types/appTypes';
import { NodeChatRequest } from '../controllers/circuit/CircuitDetailsPanelController';
import { detectLanguageMismatchWarning } from '../services/language/detectLanguageWarning';
import { registerPceCommands } from '../commands/registerCommands';
import { enrichCircuitGraphWithAi } from '../services/circuit/ai/enrichCircuitGraph';
import { CircuitAiEnrichmentResult, CircuitGraph } from '../shared/types/circuitTypes';
import { explainCircuitNodeRelationWithAi } from '../services/circuit/ai/explainNodeRelation';

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

	const getCacheKey = (doc: vscode.TextDocument, mode: ResponseMode, modelId?: string): string => {
		const keyModel = mode === 'list' ? 'local-list' : modelId ?? 'no-model';
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
		if (selectedResponseMode !== 'list') {
			await loadModels(panel);
			const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
			if (!model) {
				return false;
			}
			modelIdForCache = model.id;
		}

		const key = getCacheKey(doc, selectedResponseMode, modelIdForCache);
		const cached = analysisCache.get(key);
		if (!cached) {
			return false;
		}

		panel.setExplanation(cached.text);
		const stale = cached.docVersion !== doc.version;
		panel.setStatus(
			stale
				? `Cached (stale: file changed) (${selectedResponseMode}) at ${new Date(cached.updatedAt).toLocaleTimeString()}`
				: `Cached (${selectedResponseMode}) at ${new Date(cached.updatedAt).toLocaleTimeString()}`
		);
		return true;
	};

	const applySymbolStateToPanel = (panel: MushroomPanel, document: vscode.TextDocument): void => {
		const locations = parseSymbolLocations(document);
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
		applySymbolStateToPanel(panel, document);

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

		let finalExplanation: string | undefined;
		let cacheModelId: string | undefined;
		if (selectedResponseMode === 'list') {
			output.appendLine('using deterministic list mode (no AI call)');
			finalExplanation = await buildListModeOutput(document);
		} else {
			await loadModels(panel);
			const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
			if (!model) {
				panel.setAnalyzing(false);
				panel.setStatus('No model available');
				panel.setExplanation('No AI model is currently available. Open Copilot/Chat model access and try again.');
				output.appendLine('runAnalysis aborted: no model available');
				return;
			}
			cacheModelId = model.id;
			output.appendLine(`using model id=${model.id}`);

			const explanation = await explainCode(model, code, document.languageId, selectedResponseMode, (chunk) => {
				if (runId !== latestRunId || panel.isDisposed()) {
					return;
				}
				panel.appendChunk(chunk);
			});

			if (runId !== latestRunId || panel.isDisposed()) {
				return;
			}

			finalExplanation = explanation;
		}

		if (runId !== latestRunId || panel.isDisposed()) {
			return;
		}

		panel.setExplanation(finalExplanation || 'No explanation generated.');

		if (finalExplanation) {
			const cacheKey = getCacheKey(document, selectedResponseMode, cacheModelId);
			analysisCache.set(cacheKey, { text: finalExplanation, updatedAt: Date.now(), docVersion: document.version });
		}

		panel.setAnalyzing(false);
		panel.setStatus(`Updated at ${new Date().toLocaleTimeString()}`);
		output.appendLine('runAnalysis completed');
	};

	const askNodeQuestion = async (request: NodeChatRequest): Promise<string> => {
		await loadModels();
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
					const generated = await explainCode(model, doc.getText(), doc.languageId, 'developer');
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
		const responseText = await requestModelText(model, prompt);
		return responseText || 'No response generated.';
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

		const result = await enrichCircuitGraphWithAi(model, graph);
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
		return explainCircuitNodeRelationWithAi(model, graph, fromNodeId, toNodeId);
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
		requestCircuitRelationExplain
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
			applySymbolStateToPanel(panel, editor.document);
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
			applySymbolStateToPanel(panel, event.document);
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


async function explainCode(
	model: vscode.LanguageModelChat,
	code: string,
	languageId: string,
	responseMode: ResponseMode,
	onChunk?: (chunk: string) => void
): Promise<string | undefined> {
	try {
		const prompt = buildPrompt(languageId, code, responseMode);
		return await requestModelText(model, prompt, onChunk);
	} catch (error: any) {
		vscode.window.showErrorMessage('Error: ' + error.message);
		return;
	}
}

