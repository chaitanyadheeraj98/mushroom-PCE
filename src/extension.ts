import * as vscode from 'vscode';

import { buildPrompt } from './prompts';
import { MushroomPanel } from './panel';
import { parseSymbolLocations } from './symbols';
import { ModelOption, ResponseMode, SymbolLink } from './types';
import { buildCircuitGraph } from './circuit/buildGraph';
import { CircuitDetailsPanel } from './circuit/detailsPanel';
import { CircuitPanel } from './circuit/panel';

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

	const formatModelOption = (model: vscode.LanguageModelChat): ModelOption => ({
		id: model.id,
		label: model.name,
		detail: `${model.vendor} / ${model.family} / ${model.version}`
	});

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

	const detectLanguageMismatchWarning = (languageId: string, code: string): string | undefined => {
		const text = code.trim();
		if (!text) {
			return undefined;
		}

		const normalizedLanguage = languageId.toLowerCase();
		const isTsLike = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(normalizedLanguage);
		const isPythonMode = normalizedLanguage === 'python';

		const pythonSignals = [
			/\bdef\s+[A-Za-z_]\w*\s*\(/,
			/\bprint\s*\(/,
			/\b(input|elif|None|True|False)\b/,
			/:\s*(#.*)?$/m
		];
		const tsSignals = [
			/\b(const|let|var|function|interface|type|class)\b/,
			/=>/,
			/[{}]/,
			/;\s*$/m
		];

		const pythonScore = pythonSignals.reduce((acc, regex) => (regex.test(text) ? acc + 1 : acc), 0);
		const tsScore = tsSignals.reduce((acc, regex) => (regex.test(text) ? acc + 1 : acc), 0);

		if (isTsLike && pythonScore >= 2 && pythonScore > tsScore) {
			return 'Language mode is set to TypeScript/JavaScript, but the code looks like Python. List Mode may miss symbols. Switch the file language mode for better results.';
		}
		if (isPythonMode && tsScore >= 2 && tsScore > pythonScore) {
			return 'Language mode is set to Python, but the code looks like TypeScript/JavaScript. List Mode may miss symbols. Switch the file language mode for better results.';
		}
		return undefined;
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

	const analyzeCommand = vscode.commands.registerCommand('mushroom-pce.analyzeActive', async () => {
		output.appendLine('mushroom-pce.analyzeActive command triggered');
		const panel = MushroomPanel.getCurrentPanel();
		if (!panel || panel.isDisposed()) {
			vscode.window.showInformationMessage('Run "Start Mushroom PCE" first.');
			output.appendLine('analyzeActive failed: panel missing');
			return;
		}

		await runAnalysis(panel);
	});

	const startCommand = vscode.commands.registerCommand('mushroom-pce.start', async () => {
		const panel = MushroomPanel.createOrShow();

		panel.setStatus('Ready');
		panel.setExplanation('Click Analyze to explain the active file.');
		panel.setLanguageWarning(undefined);
		applyModeStateToPanel(panel);

		if (lastDocument) {
			applySymbolStateToPanel(panel, lastDocument);
		}
		await loadModels(panel);
		output.appendLine('mushroom-pce.start command triggered');
		await vscode.commands.executeCommand('mushroom-pce.analyzeActive');
	});

	const goToFunctionCommand = vscode.commands.registerCommand(
		'mushroom-pce.goToFunction',
		async (uriString?: string, line?: number, character?: number) => {
			try {
				if (typeof uriString !== 'string' || typeof line !== 'number' || typeof character !== 'number') {
					return;
				}

				const targetUri = vscode.Uri.parse(uriString);
				const existingEditor = vscode.window.visibleTextEditors
					.filter((e) => e.document.uri.toString() === targetUri.toString())
					.sort((a, b) => (a.viewColumn ?? 999) - (b.viewColumn ?? 999))[0];
				const document = existingEditor
					? existingEditor.document
					: await vscode.workspace.openTextDocument(targetUri);
				const editor = await vscode.window.showTextDocument(document, {
					viewColumn: existingEditor?.viewColumn ?? lastEditorColumn ?? vscode.ViewColumn.One,
					preserveFocus: false,
					preview: true
				});
				const position = new vscode.Position(Math.max(0, line), Math.max(0, character));
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
				if (editor.viewColumn) {
					lastEditorColumn = editor.viewColumn;
				}
			} catch (error: any) {
				vscode.window.showErrorMessage('Could not navigate to symbol: ' + (error?.message ?? String(error)));
			}
		}
	);

	const selectModelCommand = vscode.commands.registerCommand('mushroom-pce.selectModel', async () => {
		const panel = MushroomPanel.getCurrentPanel();
		await loadModels(panel);

		if (!availableModels.length) {
			vscode.window.showErrorMessage('No AI models available to select.');
			return;
		}

		const pickItems = availableModels.map((model) => {
			const option = formatModelOption(model);
			return {
				label: option.label,
				description: model.id === selectedModelId ? 'Current' : '',
				detail: option.detail,
				modelId: model.id
			};
		});

		const picked = await vscode.window.showQuickPick(pickItems, {
			title: 'Mushroom PCE: Select AI Model',
			placeHolder: 'Choose the model used for code explanation'
		});

		if (!picked) {
			return;
		}

		selectedModelId = picked.modelId;
		if (panel && !panel.isDisposed()) {
			applyModelStateToPanel(panel);
			// If we have cached output for this model+mode, show it immediately.
			await tryRestoreCachedAnalysis(panel);
		}
		vscode.window.showInformationMessage(`Mushroom PCE model set to: ${picked.label}`);
		output.appendLine(`model selected: ${picked.modelId}`);
	});

	const setListModeCommand = vscode.commands.registerCommand('mushroom-pce.setListMode', async () => {
		selectedResponseMode = 'list';
		const panel = MushroomPanel.getCurrentPanel();
		if (panel && !panel.isDisposed()) {
			applyModeStateToPanel(panel);
			await tryRestoreCachedAnalysis(panel);
		}
		vscode.window.showInformationMessage('Mushroom PCE mode set to List Mode');
		output.appendLine('response mode selected: list');
	});

	const setDeveloperModeCommand = vscode.commands.registerCommand('mushroom-pce.setDeveloperMode', async () => {
		selectedResponseMode = 'developer';
		const panel = MushroomPanel.getCurrentPanel();
		if (panel && !panel.isDisposed()) {
			applyModeStateToPanel(panel);
			await tryRestoreCachedAnalysis(panel);
		}
		vscode.window.showInformationMessage('Mushroom PCE mode set to Developer Mode');
		output.appendLine('response mode selected: developer');
	});

	const openCircuitCommand = vscode.commands.registerCommand('mushroom-pce.openCircuit', async () => {
		const doc = getCurrentDocument();
		if (!doc) {
			vscode.window.showInformationMessage('Open a file to visualize in Circuit Mode.');
			return;
		}

		const graph = buildCircuitGraph(doc);
		CircuitPanel.createOrShow(context.extensionUri, graph, async (node) => {
			if (!node?.uri || typeof node.line !== 'number' || typeof node.character !== 'number') {
				return;
			}
			// 1) Jump to code in-place
			await vscode.commands.executeCommand('mushroom-pce.goToFunction', node.uri, node.line, node.character);
			// 2) Show details webview (snippet)
			await CircuitDetailsPanel.createOrShow(node);
		});
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
		startCommand,
		analyzeCommand,
		selectModelCommand,
		setListModeCommand,
		setDeveloperModeCommand,
		goToFunctionCommand,
		openCircuitCommand,
		statusBarAnalyze,
		output,
		onEditorChange,
		onDocumentChange
	);
}

function addFrequencyToListOutput(markdown: string, code: string): string {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const nextLines: string[] = [];

	for (const rawLine of lines) {
		const match = rawLine.match(/^(\s*[-*]\s+)(.+)$/);
		if (!match) {
			nextLines.push(rawLine);
			continue;
		}

		const prefix = match[1];
		const rawItem = match[2].trim();
		if (!rawItem || rawItem === '-') {
			nextLines.push(rawLine);
			continue;
		}

		const cleaned = rawItem.replace(/\s+\(x\d+\)\s*$/, '').trim();
		const count = countSymbolOccurrences(code, cleaned);
		if (count <= 0) {
			nextLines.push(`${prefix}${cleaned}`);
			continue;
		}

		nextLines.push(`${prefix}${cleaned} (x${count})`);
	}

	return nextLines.join('\n');
}

function countSymbolOccurrences(code: string, symbol: string): number {
	const text = symbol.replace(/^`|`$/g, '').trim();
	if (!text || text === '-') {
		return 0;
	}

	// If a line contains aliases/descriptions, focus on the first token-like chunk.
	const baseToken = text.split(/\s+[-–—:|]/)[0].trim();
	const needle = baseToken || text;
	const escaped = escapeRegExp(needle);

	let regex: RegExp;
	if (/^[A-Za-z_$][\w$]*$/.test(needle)) {
		regex = new RegExp(`\\b${escaped}\\b`, 'g');
	} else {
		regex = new RegExp(escaped, 'g');
	}

	const matches = code.match(regex);
	return matches ? matches.length : 0;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
		const messages = [new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, prompt)];

		const response = await model.sendRequest(messages);
		const res: any = response;
		const streamCandidate = res?.stream ?? res;

		if (streamCandidate && typeof streamCandidate[Symbol.asyncIterator] === 'function') {
			let text = '';
			for await (const chunk of streamCandidate) {
				const parsedChunk = extractTextFromChunk(chunk);
				if (parsedChunk) {
					text += parsedChunk;
					onChunk?.(parsedChunk);
				}
			}
			return text;
		}

		if (Array.isArray(res?.content)) {
			let text = '';
			for (const item of res.content) {
				if (typeof item?.text === 'string') {
					text += item.text;
				}
			}
			return text;
		}

		if (typeof res?.text === 'string') {
			return res.text;
		}

		if (typeof res === 'string') {
			return res;
		}

		return JSON.stringify(res, null, 2);
	} catch (error: any) {
		vscode.window.showErrorMessage('Error: ' + error.message);
		return;
	}
}

function extractTextFromChunk(chunk: unknown): string {
	if (typeof chunk === 'string') {
		return chunk;
	}

	if (!chunk || typeof chunk !== 'object') {
		return '';
	}

	const maybeText = (chunk as any).text;
	if (typeof maybeText === 'string') {
		return maybeText;
	}

	const maybeValue = (chunk as any).value;
	if (typeof maybeValue === 'string') {
		return maybeValue;
	}

	if (Array.isArray((chunk as any).content)) {
		return (chunk as any).content
			.map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
			.join('');
	}

	return '';
}
