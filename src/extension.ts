import * as vscode from 'vscode';

type ModelOption = {
	id: string;
	label: string;
	detail: string;
};

type SymbolKind = 'function' | 'variable' | 'import';

type SymbolLocation = {
	name: string;
	uri: vscode.Uri;
	line: number;
	character: number;
	kind: SymbolKind;
};

type SymbolLink = {
	name: string;
	kind: SymbolKind;
	commandUri: string;
};

export function activate(context: vscode.ExtensionContext) {
	let latestRunId = 0;
	const output = vscode.window.createOutputChannel('Mushroom PCE');
	let lastDocument: vscode.TextDocument | undefined;
	let lastEditorColumn: vscode.ViewColumn = vscode.ViewColumn.One;
	let availableModels: vscode.LanguageModelChat[] = [];
	let selectedModelId: string | undefined;

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

	rememberEditor(vscode.window.activeTextEditor);

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
			panel.setAnalyzing(false);
			return;
		}

		const runId = ++latestRunId;
		panel.clear();
		panel.setAnalyzing(true);
		panel.setStatus('Analyzing...');
		output.appendLine(`Analyzing language=${document.languageId}, chars=${code.length}`);

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
		const explanation = await explainCode(model, code, document.languageId, (chunk) => {
			if (runId !== latestRunId || panel.isDisposed()) {
				return;
			}
			streamed = true;
			panel.appendChunk(chunk);
		});

		if (runId !== latestRunId || panel.isDisposed()) {
			return;
		}

		if (!streamed) {
			panel.setExplanation(explanation || 'No explanation generated.');
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
				const selection = new vscode.Selection(position, position);
				editor.selection = selection;
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
				if (editor.viewColumn) {
					lastEditorColumn = editor.viewColumn;
				}
			} catch (error: any) {
				vscode.window.showErrorMessage('Could not navigate to function: ' + (error?.message ?? String(error)));
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
		}
		vscode.window.showInformationMessage(`Mushroom PCE model set to: ${picked.label}`);
		output.appendLine(`model selected: ${picked.modelId}`);
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
		if (lastDocument && event.document.uri.toString() === lastDocument.uri.toString()) {
			applySymbolStateToPanel(panel, event.document);
		}
	});

	context.subscriptions.push(
		startCommand,
		analyzeCommand,
		selectModelCommand,
		goToFunctionCommand,
		statusBarAnalyze,
		output,
		onEditorChange,
		onDocumentChange
	);
}

async function explainCode(model: vscode.LanguageModelChat, code: string, languageId: string, onChunk?: (chunk: string) => void): Promise<string | undefined> {
	try {
		const prompt = `
You are a friendly programming teacher for complete beginners.

Return Markdown only. Keep it clean, simple, and easy to read.

Required structure (use exactly these headings):
# Quick Summary
# Logic and Flow
# Functions
# Data Structures
# Program Structure
# Debugging and Quality
# Real-World Reading Path
# Imports and External Packages
# Example Input and Output
# Important Lines Explained
# Step-by-Step Flow
# Beginner Story
# Key Takeaways

Formatting rules:
- Use short bullet points.
- Do not use markdown tables.
- Use backticks for code identifiers.
- When referencing a symbol, wrap only the bare identifier in backticks (for example, \`myFunction\`, not \`myFunction(arg)\`).
- If a section has no items, write: - None
- Keep explanations simple, visual, and beginner-friendly.
- Start with what the code is trying to achieve in 1-2 sentences.
- Explain every new technical term in one short line.
- Explain not only what each part does, but why it exists.
- Use a beginner tone: "assume I have never seen this before."
- Explain what each import/package is used for in plain language.
- Explain what would happen without each important import/package.
- In "Logic and Flow", explicitly cover condition checks, loops, and boolean/comparison usage.
- In "Functions", explain input -> process -> output for each important function.
- In "Data Structures", show simple example values and how data changes over time.
- In "Program Structure", explain where execution starts and how parts connect.
- In "Debugging and Quality", include 2-3 common beginner mistakes and how to fix them.
- In "Real-World Reading Path", explain how data flows through variables, arrays/objects, and function calls.
- In "Example Input and Output", provide concrete sample input and expected output.
- In "Important Lines Explained", explain key lines only (not every single line).
- In "Step-by-Step Flow", simulate execution with a small sample and show state changes.
- In "Beginner Story", use one short real-life analogy (recipe/shopping/etc.) and keep it memorable.
- In "Deeper Concepts", mention async/promises/recursion/complexity only if actually present.
- In "Deeper Concepts", keep each concept to 1-2 lines max.
- Avoid jargon unless you also define it in one sentence.
- Keep each section concise to avoid overload (roughly 3-7 bullets per section when possible).

Code (${languageId}):
\`\`\`${languageId}
${code}
\`\`\`
`;

		const messages = [
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, prompt)
		];

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

function parseSymbolLocations(document: vscode.TextDocument): SymbolLocation[] {
	const locations: SymbolLocation[] = [];
	const seen = new Set<string>();

	for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
		const rawLine = document.lineAt(lineIndex).text;
		const trimmed = rawLine.trim();
		if (!trimmed) {
			continue;
		}

		const matches: Array<{ name: string; index: number; kind: SymbolKind }> = [];

		const importNamed = /^\s*import\s+(?:type\s+)?\{([^}]+)\}\s+from\b/.exec(rawLine);
		if (importNamed?.[1]) {
			for (const part of importNamed[1].split(',')) {
				const cleaned = part.trim().split(/\s+as\s+/i)[0]?.trim();
				if (cleaned) {
					matches.push({ name: cleaned, index: rawLine.indexOf(cleaned), kind: 'import' });
				}
			}
		}

		const importDefault = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\b/.exec(rawLine);
		if (importDefault?.[1]) {
			matches.push({ name: importDefault[1], index: rawLine.indexOf(importDefault[1]), kind: 'import' });
		}

		const importAlias = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\b/.exec(rawLine);
		if (importAlias?.[1]) {
			matches.push({ name: importAlias[1], index: rawLine.indexOf(importAlias[1]), kind: 'import' });
		}

		const varDecl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(rawLine);
		if (varDecl?.[1]) {
			matches.push({ name: varDecl[1], index: rawLine.indexOf(varDecl[1]), kind: 'variable' });
		}
		const reassignment = /^\s*([A-Za-z_$][\w$]*)\s*=/.exec(rawLine);
		if (reassignment?.[1] && !['const', 'let', 'var'].includes(reassignment[1])) {
			matches.push({ name: reassignment[1], index: rawLine.indexOf(reassignment[1]), kind: 'variable' });
		}

		const fnDecl = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/.exec(rawLine);
		if (fnDecl?.[1]) {
			matches.push({ name: fnDecl[1], index: fnDecl.index, kind: 'function' });
		}
		for (const param of extractParameterNames(rawLine)) {
			matches.push({ name: param, index: rawLine.indexOf(param), kind: 'variable' });
		}

		const arrowFn = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.exec(rawLine);
		if (arrowFn?.[1]) {
			matches.push({ name: arrowFn[1], index: arrowFn.index, kind: 'function' });
		}

		const classMethod = /^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(rawLine);
		if (classMethod?.[1]) {
			const disallowed = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor']);
			if (!disallowed.has(classMethod[1])) {
				matches.push({ name: classMethod[1], index: rawLine.indexOf(classMethod[1]), kind: 'function' });
			}
		}

		const pyFn = /^\s*def\s+([A-Za-z_]\w*)\s*\(/.exec(rawLine);
		if (pyFn?.[1]) {
			matches.push({ name: pyFn[1], index: rawLine.indexOf(pyFn[1]), kind: 'function' });
		}

		const goFn = /^\s*func\s+([A-Za-z_]\w*)\s*\(/.exec(rawLine);
		if (goFn?.[1]) {
			matches.push({ name: goFn[1], index: rawLine.indexOf(goFn[1]), kind: 'function' });
		}

		for (const match of matches) {
			const key = `${match.kind}:${match.name}:${lineIndex}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			locations.push({
				name: match.name,
				uri: document.uri,
				line: lineIndex,
				character: Math.max(0, match.index),
				kind: match.kind
			});
		}
	}

	return locations;
}

function extractParameterNames(line: string): string[] {
	const matches: string[] = [];
	const parenMatch = /\(([^)]*)\)/.exec(line);
	if (!parenMatch?.[1]) {
		return matches;
	}

	for (const rawPart of parenMatch[1].split(',')) {
		const trimmed = rawPart.trim();
		if (!trimmed) {
			continue;
		}
		const base = trimmed
			.replace(/^[.\s]*\.{3}/, '')
			.replace(/[:=].*$/, '')
			.replace(/[{}\[\]\s]/g, '')
			.trim();
		if (/^[A-Za-z_$][\w$]*$/.test(base) && !matches.includes(base)) {
			matches.push(base);
		}
	}

	return matches;
}

class MushroomPanel {
	private static currentPanel: MushroomPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;
	private status = 'Ready';
	private rawText = 'Click Analyze to explain the active file.';
	private analyzing = false;
	private currentModel = 'No model selected';
	private availableModelLabels: string[] = [];
	private symbolLinks: SymbolLink[] = [];

	static getCurrentPanel(): MushroomPanel | undefined {
		return MushroomPanel.currentPanel;
	}

	static createOrShow(): MushroomPanel {
		if (MushroomPanel.currentPanel && !MushroomPanel.currentPanel.isDisposed()) {
			MushroomPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			return MushroomPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			'mushroomPcePanel',
			'Mushroom PCE',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				enableCommandUris: true,
				retainContextWhenHidden: true
			}
		);

		MushroomPanel.currentPanel = new MushroomPanel(panel);
		return MushroomPanel.currentPanel;
	}

	private constructor(panel: vscode.WebviewPanel) {
		this.panel = panel;
		this.render();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	dispose(): void {
		this.disposed = true;
		MushroomPanel.currentPanel = undefined;
		while (this.disposables.length) {
			const item = this.disposables.pop();
			item?.dispose();
		}
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	clear(): void {
		this.rawText = '';
		this.render();
	}

	appendChunk(chunk: string): void {
		this.rawText += chunk;
		this.render();
	}

	setExplanation(text: string): void {
		this.rawText = text;
		this.render();
	}

	setStatus(text: string): void {
		this.status = text;
		this.render();
	}

	setAnalyzing(isAnalyzing: boolean): void {
		this.analyzing = isAnalyzing;
		this.render();
	}

	setModelInfo(currentModel: string, availableModels: string[]): void {
		this.currentModel = currentModel;
		this.availableModelLabels = availableModels;
		this.render();
	}

	setSymbolLinks(symbolLinks: SymbolLink[]): void {
		this.symbolLinks = symbolLinks;
		this.render();
	}

	private render(): void {
		if (this.disposed) {
			return;
		}
		this.panel.webview.html = this.getHtml(
			this.panel.webview,
			this.status,
			this.rawText,
			this.analyzing,
			this.currentModel,
			this.availableModelLabels
		);
	}

	private getHtml(
		webview: vscode.Webview,
		status: string,
		text: string,
		analyzing: boolean,
		currentModel: string,
		availableModels: string[]
	): string {
		const cspSource = webview.cspSource;
		const explainHtml = markdownToHtml(text, this.symbolLinks);
		const buttonHtml = analyzing
			? '<span class="analyze-btn disabled">Analyzing...</span>'
			: '<a id="analyzeBtn" class="analyze-btn" href="command:mushroom-pce.analyzeActive">Analyze</a>';
		const modelListHtml = availableModels.length
			? `<ul class="model-list">${availableModels.map((model) => `<li>${escapeHtml(model)}</li>`).join('')}</ul>`
			: '<div class="hint">No models found</div>';

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mushroom PCE</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #0f172a;
      --text: #e2e8f0;
      --muted: #9fb0cc;
      --accent: #22c55e;
      --border: #21304d;
      --code-bg: #0b1225;
      --heading: #f8fafc;
      --btn: #16a34a;
      --btn-hover: #15803d;
      --btn-disabled: #334155;
    }
    body {
      margin: 0;
      padding: 0;
      background: radial-gradient(circle at top right, #1e293b, var(--bg) 55%);
      color: var(--text);
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
      padding: 16px;
      gap: 10px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }
    .title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.2px;
      color: var(--heading);
    }
    .status {
      color: var(--muted);
      font-size: 12px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .model-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      background: color-mix(in oklab, var(--panel) 85%, black);
    }
    .model-title {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .model-current {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .model-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .model-list {
      margin: 4px 0 0 16px;
      padding: 0;
      font-size: 12px;
      color: var(--muted);
      max-height: 90px;
      overflow-y: auto;
    }
    .analyze-btn {
      display: inline-block;
      border: none;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 600;
      color: #ffffff;
      background: var(--btn);
      cursor: pointer;
      text-decoration: none;
    }
    .analyze-btn:hover {
      background: var(--btn-hover);
    }
    .analyze-btn.disabled {
      background: var(--btn-disabled);
      cursor: not-allowed;
      pointer-events: none;
    }
    .fallback-link {
      color: #93c5fd;
      font-size: 12px;
      text-decoration: none;
    }
    .fallback-link:hover {
      text-decoration: underline;
    }
    .content {
      flex: 1;
      overflow-y: auto;
      background: color-mix(in oklab, var(--panel) 95%, black);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      line-height: 1.65;
      font-size: 14px;
    }
    .content h1,
    .content h2,
    .content h3 {
      margin: 16px 0 8px;
      color: var(--heading);
      line-height: 1.35;
    }
    .content h1 { font-size: 20px; }
    .content h2 { font-size: 17px; }
    .content h3 { font-size: 15px; }
    .content p { margin: 8px 0; }
    .content ul,
    .content ol {
      margin: 8px 0 8px 20px;
      padding: 0;
    }
    .content li { margin: 4px 0; }
    .content code {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1px 6px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
    }
    .content a.symbol-link {
      text-decoration: none;
      cursor: pointer;
      border-bottom: 1px dashed transparent;
    }
    .content a.symbol-link code {
      border-color: transparent;
    }
    .content a.symbol-link.symbol-function code {
      color: #93c5fd;
    }
    .content a.symbol-link.symbol-variable code {
      color: #facc15;
    }
    .content a.symbol-link.symbol-import code {
      color: #a78bfa;
    }
    .content a.symbol-link:hover {
      border-bottom-color: currentColor;
    }
    .content pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .content pre code {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 0;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      display: inline-block;
      margin-right: 8px;
      background: var(--accent);
      box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 65%, white);
    }
    .spacer { height: 4px; }
    .hint { color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="title"><span class="dot"></span>Mushroom PCE</div>
      <div class="status">${escapeHtml(status)}</div>
    </div>
    <div class="model-card">
      <div class="model-title">Model In Use</div>
      <div class="model-current">${escapeHtml(currentModel)}</div>
      <div class="model-actions">
        <a class="fallback-link" href="command:mushroom-pce.selectModel">Select Model</a>
      </div>
      ${modelListHtml}
    </div>
    <div class="toolbar">
      ${buttonHtml}
      <a class="fallback-link" href="command:mushroom-pce.analyzeActive">Analyze (fallback)</a>
      <div class="hint">Update your code, then click Analyze.</div>
    </div>
    <div class="content">${explainHtml}</div>
  </div>
</body>
</html>`;
	}
}

function markdownToHtml(markdown: string, symbolLinks: SymbolLink[]): string {
	if (!markdown.trim()) {
		return '<p>Click Analyze to explain the active file.</p>';
	}

	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let inCode = false;
	let listMode: '' | 'ul' | 'ol' = '';

	const closeList = () => {
		if (listMode === 'ul') {
			out.push('</ul>');
		}
		if (listMode === 'ol') {
			out.push('</ol>');
		}
		listMode = '';
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.startsWith('```')) {
			closeList();
			out.push(inCode ? '</code></pre>' : '<pre><code>');
			inCode = !inCode;
			continue;
		}
		if (inCode) {
			out.push(`${escapeHtml(rawLine)}\n`);
			continue;
		}
		if (!line) {
			closeList();
			continue;
		}
		if (line.startsWith('### ')) {
			closeList();
			out.push(`<h3>${inlineMd(line.slice(4), symbolLinks)}</h3>`);
			continue;
		}
		if (line.startsWith('## ')) {
			closeList();
			out.push(`<h2>${inlineMd(line.slice(3), symbolLinks)}</h2>`);
			continue;
		}
		if (line.startsWith('# ')) {
			closeList();
			out.push(`<h1>${inlineMd(line.slice(2), symbolLinks)}</h1>`);
			continue;
		}
		if (/^[-*]\s+/.test(line)) {
			if (listMode !== 'ul') {
				closeList();
				out.push('<ul>');
				listMode = 'ul';
			}
			out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ''), symbolLinks)}</li>`);
			continue;
		}
		if (/^\d+\.\s+/.test(line)) {
			if (listMode !== 'ol') {
				closeList();
				out.push('<ol>');
				listMode = 'ol';
			}
			out.push(`<li>${inlineMd(line.replace(/^\d+\.\s+/, ''), symbolLinks)}</li>`);
			continue;
		}
		closeList();
		out.push(`<p>${inlineMd(line, symbolLinks)}</p>`);
	}
	closeList();
	return out.join('') || '<p>No explanation generated.</p>';
}

function inlineMd(text: string, symbolLinks: SymbolLink[]): string {
	let result = escapeHtml(text);
	const symbolMap = new Map<string, SymbolLink[]>();
	for (const symbol of symbolLinks) {
		const existing = symbolMap.get(symbol.name) ?? [];
		existing.push(symbol);
		symbolMap.set(symbol.name, existing);
	}

	result = result.replace(/#sym:([A-Za-z_$][\w$]*)/g, (_whole, token: string) => {
		const symbol = resolveSymbolForToken(token, symbolMap);
		if (!symbol) {
			return `#sym:${escapeHtml(token)}`;
		}
		return `<a class="symbol-link symbol-${symbol.kind}" href="${symbol.commandUri}" title="Go to ${escapeHtml(token)}"><code>${escapeHtml(token)}</code></a>`;
	});

	result = result.replace(/\x60([^\x60]+)\x60/g, (_whole, token: string) => {
		const clean = token.trim();
		const symbol = resolveSymbolForToken(clean, symbolMap);
		const codeTag = `<code>${escapeHtml(clean)}</code>`;
		if (!symbol) {
			return codeTag;
		}
		return `<a class="symbol-link symbol-${symbol.kind}" href="${symbol.commandUri}" title="Go to ${escapeHtml(clean)}">${codeTag}</a>`;
	});
	result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	result = linkPlainSymbolsInHtml(result, symbolLinks);
	return result;
}

function resolveSymbolForToken(token: string, symbolMap: Map<string, SymbolLink[]>): SymbolLink | undefined {
	const candidates = extractTokenCandidates(token);
	for (const candidate of candidates) {
		const direct = pickPreferredSymbol(symbolMap.get(candidate));
		if (direct) {
			return direct;
		}
	}

	const lower = token.toLowerCase();
	for (const [name, symbols] of symbolMap.entries()) {
		if (name.toLowerCase() === lower) {
			return pickPreferredSymbol(symbols);
		}
	}

	return undefined;
}

function extractTokenCandidates(token: string): string[] {
	const out: string[] = [];
	const add = (value: string) => {
		const v = value.trim();
		if (v && !out.includes(v)) {
			out.push(v);
		}
	};

	add(token);
	add(token.replace(/^[^\w$]+|[^\w$]+$/g, ''));

	const identifierMatches = token.match(/[A-Za-z_$][\w$]*/g) ?? [];
	for (const id of identifierMatches) {
		add(id);
	}

	if (token.includes('.')) {
		for (const part of token.split('.')) {
			add(part);
		}
	}

	return out;
}

function pickPreferredSymbol(symbols: SymbolLink[] | undefined): SymbolLink | undefined {
	if (!symbols || symbols.length === 0) {
		return undefined;
	}
	const order: Record<SymbolKind, number> = {
		function: 0,
		variable: 1,
		import: 2
	};
	return [...symbols].sort((a, b) => order[a.kind] - order[b.kind])[0];
}

function linkPlainSymbolsInHtml(html: string, symbolLinks: SymbolLink[]): string {
	if (!html || !symbolLinks.length) {
		return html;
	}

	const symbolMap = new Map<string, SymbolLink>();
	for (const symbol of symbolLinks) {
		if (!symbolMap.has(symbol.name)) {
			symbolMap.set(symbol.name, symbol);
		}
	}

	const names = [...symbolMap.keys()]
		.filter((name) => name.length >= 2)
		.sort((a, b) => b.length - a.length);
	if (!names.length) {
		return html;
	}

	const escapedNames = names.map(escapeRegExp);
	const pattern = new RegExp(`\\b(${escapedNames.join('|')})\\b`, 'g');

	return html
		.split(/(<[^>]+>)/g)
		.map((part) => {
			if (!part || part.startsWith('<')) {
				return part;
			}

			return part.replace(pattern, (match: string) => {
				const symbol = symbolMap.get(match);
				if (!symbol) {
					return match;
				}
				return `<a class="symbol-link symbol-${symbol.kind}" href="${symbol.commandUri}" title="Go to ${escapeHtml(match)}"><code>${escapeHtml(match)}</code></a>`;
			});
		})
		.join('');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
