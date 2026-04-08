import * as vscode from 'vscode';

type ModelOption = {
	id: string;
	label: string;
	detail: string;
};

export function activate(context: vscode.ExtensionContext) {
	let latestRunId = 0;
	const output = vscode.window.createOutputChannel('Mushroom PCE');
	let lastDocument: vscode.TextDocument | undefined;
	let availableModels: vscode.LanguageModelChat[] = [];
	let selectedModelId: string | undefined;

	const rememberEditor = (editor: vscode.TextEditor | undefined): void => {
		if (!editor) {
			return;
		}

		if (editor.document.uri.scheme === 'file' || editor.document.uri.scheme === 'untitled') {
			lastDocument = editor.document;
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
		await loadModels(panel);
		output.appendLine('mushroom-pce.start command triggered');
		await vscode.commands.executeCommand('mushroom-pce.analyzeActive');
	});

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
	});

	context.subscriptions.push(startCommand, analyzeCommand, selectModelCommand, statusBarAnalyze, output, onEditorChange);
}

async function explainCode(model: vscode.LanguageModelChat, code: string, languageId: string, onChunk?: (chunk: string) => void): Promise<string | undefined> {
	try {
		const prompt = `
You are a friendly programming teacher for beginners.

Return Markdown only. Keep it clean and easy to read.

Required structure (use exactly these headings):
# Quick Summary
# Imports
# Functions
# Variables and State
# Step-by-Step Flow
# Beginner Story
# Key Takeaways

Formatting rules:
- Use short bullet points.
- Do not use markdown tables.
- Use backticks for code identifiers.
- If a section has no items, write: - None
- Keep explanations simple and visual.

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
		const explainHtml = markdownToHtml(text);
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

function markdownToHtml(markdown: string): string {
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
			out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
			continue;
		}
		if (line.startsWith('## ')) {
			closeList();
			out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
			continue;
		}
		if (line.startsWith('# ')) {
			closeList();
			out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
			continue;
		}
		if (/^[-*]\s+/.test(line)) {
			if (listMode !== 'ul') {
				closeList();
				out.push('<ul>');
				listMode = 'ul';
			}
			out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ''))}</li>`);
			continue;
		}
		if (/^\d+\.\s+/.test(line)) {
			if (listMode !== 'ol') {
				closeList();
				out.push('<ol>');
				listMode = 'ol';
			}
			out.push(`<li>${inlineMd(line.replace(/^\d+\.\s+/, ''))}</li>`);
			continue;
		}
		closeList();
		out.push(`<p>${inlineMd(line)}</p>`);
	}
	closeList();
	return out.join('') || '<p>No explanation generated.</p>';
}

function inlineMd(text: string): string {
	let result = escapeHtml(text);
	result = result.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
	result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	return result;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
