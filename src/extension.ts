import * as vscode from 'vscode';

import { requestModelText } from './ai/client';
import { addFrequencyToListOutput } from './analysis/frequency';
import { buildNodeDetailsPrompt, buildPrompt } from './prompts';
import { MushroomPanel } from './panel';
import { parseSymbolLocations } from './symbols';
import { ResponseMode, SymbolLink } from './types';
import { NodeChatRequest } from './circuit/detailsPanel';
import { detectLanguageMismatchWarning } from './language/warnings';
import { registerPceCommands } from './commands/register';

export function activate(context: vscode.ExtensionContext) {
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

	const getCacheKey = (doc: vscode.TextDocument, modelId: string, mode: ResponseMode): string =>
		`${doc.uri.toString()}::${modelId}::${mode}`;

	const tryRestoreCachedAnalysis = async (panel: MushroomPanel): Promise<boolean> => {
		if (panel.isDisposed()) {
			return false;
		}

		const doc = getCurrentDocument();
		if (!doc) {
			return false;
		}

		await loadModels(panel);
		const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
		if (!model) {
			return false;
		}

		const key = getCacheKey(doc, model.id, selectedResponseMode);
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

		await loadModels(panel);
		const model = availableModels.find((m) => m.id === selectedModelId) ?? availableModels[0];
		if (!model) {
			panel.setAnalyzing(false);
			panel.setStatus('No model available');
			panel.setExplanation('No AI model is currently available. Open Copilot/Chat model access and try again.');
			output.appendLine('runAnalysis aborted: no model available');
			return;
		}
		output.appendLine(`using model id=${model.id}`);

		let streamed = false;
		const explanation = await explainCode(model, code, document.languageId, selectedResponseMode, (chunk) => {
			if (runId !== latestRunId || panel.isDisposed()) {
				return;
			}
			streamed = true;
			panel.appendChunk(chunk);
		});

		if (runId !== latestRunId || panel.isDisposed()) {
			return;
		}

		const finalExplanation =
			selectedResponseMode === 'list' && explanation
				? addFrequencyToListOutput(explanation, code)
				: explanation;

		panel.setExplanation(finalExplanation || 'No explanation generated.');

		if (finalExplanation) {
			const cacheKey = getCacheKey(document, model.id, selectedResponseMode);
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

		const prompt = buildNodeDetailsPrompt(request);
		const responseText = await requestModelText(model, prompt);
		return responseText || 'No response generated.';
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
		askNodeQuestion
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
