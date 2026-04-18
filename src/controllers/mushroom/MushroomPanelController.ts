import * as vscode from 'vscode';

import { markdownToHtml, escapeHtml } from '../../utils/markdownToHtml';
import { ResponseMode, SymbolLink } from '../../shared/types/appTypes';

export class MushroomPanel {
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
	private currentResponseMode: ResponseMode = 'developer';
	private languageWarning: string | undefined;

	private pendingRender: ReturnType<typeof setTimeout> | undefined;

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
		this.renderNow();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	dispose(): void {
		this.disposed = true;
		MushroomPanel.currentPanel = undefined;
		if (this.pendingRender) {
			clearTimeout(this.pendingRender);
			this.pendingRender = undefined;
		}
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
		this.renderSoon();
	}

	appendChunk(chunk: string): void {
		this.rawText += chunk;
		// Streaming can be chatty; throttle DOM rebuilds.
		this.renderSoon();
	}

	setExplanation(text: string): void {
		this.rawText = text;
		this.renderNow();
	}

	setStatus(text: string): void {
		this.status = text;
		this.renderSoon();
	}

	setAnalyzing(isAnalyzing: boolean): void {
		this.analyzing = isAnalyzing;
		this.renderSoon();
	}

	setModelInfo(currentModel: string, availableModels: string[]): void {
		this.currentModel = currentModel;
		this.availableModelLabels = availableModels;
		this.renderSoon();
	}

	setSymbolLinks(symbolLinks: SymbolLink[]): void {
		this.symbolLinks = symbolLinks;
		this.renderSoon();
	}

	setResponseModeInfo(mode: ResponseMode): void {
		this.currentResponseMode = mode;
		this.renderSoon();
	}

	setLanguageWarning(warning: string | undefined): void {
		this.languageWarning = warning;
		this.renderSoon();
	}

	private renderSoon(): void {
		if (this.disposed) {
			return;
		}
		if (this.pendingRender) {
			return;
		}
		this.pendingRender = setTimeout(() => {
			this.pendingRender = undefined;
			this.renderNow();
		}, 50);
	}

	private renderNow(): void {
		if (this.disposed) {
			return;
		}
		this.panel.webview.html = this.getHtml();
	}

	private getHtml(): string {
		const cspSource = this.panel.webview.cspSource;
		const isListMode = this.currentResponseMode === 'list';
		const explainHtml = markdownToHtml(this.rawText, this.symbolLinks, {
			enablePlainSymbolAutoLinking: !isListMode
		});
		const buttonHtml = this.analyzing
			? '<span class="analyze-btn disabled">Analyzing...</span>'
			: '<a id="analyzeBtn" class="analyze-btn" href="command:mushroom-pce.analyzeActive">Analyze</a>';
		const modelListHtml = this.availableModelLabels.length
			? `<ul class="model-list">${this.availableModelLabels.map((model) => `<li>${escapeHtml(model)}</li>`).join('')}</ul>`
			: '<div class="hint">No models found</div>';

		const listActive = this.currentResponseMode === 'list';
		const developerActive = this.currentResponseMode === 'developer';
		const warningHtml = this.languageWarning
			? `<div class="warning-card">${escapeHtml(this.languageWarning)}</div>`
			: '';

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
    .mode-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      background: color-mix(in oklab, var(--panel) 85%, black);
    }
    .mode-title {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .mode-current {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .mode-actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .mode-pill {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      text-decoration: none;
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .mode-pill.active {
      color: #ffffff;
      background: color-mix(in oklab, var(--accent) 70%, black);
      border-color: color-mix(in oklab, var(--accent) 60%, white);
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
    .analyze-btn:hover { background: var(--btn-hover); }
    .analyze-btn.disabled { background: var(--btn-disabled); cursor: not-allowed; pointer-events: none; }
    .fallback-link { color: #93c5fd; font-size: 12px; text-decoration: none; }
    .fallback-link:hover { text-decoration: underline; }
    .warning-card {
      border: 1px solid color-mix(in oklab, #f59e0b 65%, white);
      border-radius: 10px;
      padding: 10px 12px;
      background: color-mix(in oklab, #f59e0b 18%, var(--panel));
      color: #fde68a;
      font-size: 12px;
      line-height: 1.5;
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
    .content h1, .content h2, .content h3 { margin: 16px 0 8px; color: var(--heading); line-height: 1.35; }
    .content h1 { font-size: 20px; }
    .content h2 { font-size: 17px; }
    .content h3 { font-size: 15px; }
    .content p { margin: 8px 0; }
    .content .md-hr {
      border: none;
      border-top: 1px solid color-mix(in oklab, var(--border) 80%, white);
      margin: 18px 0;
      opacity: 0.9;
    }
    .content ul, .content ol { margin: 8px 0 8px 20px; padding: 0; }
    .content li { margin: 4px 0; }
    .content li.list-section-imports { color: #a78bfa; }
    .content li.list-section-exports { color: #c084fc; }
    .content li.list-section-variables { color: #facc15; }
    .content li.list-section-constants { color: #fbbf24; }
    .content li.list-section-functions { color: #93c5fd; }
    .content li.list-section-methods { color: #60a5fa; }
    .content li.list-section-classes { color: #34d399; }
    .content li.list-section-super-classes-inheritance { color: #10b981; }
    .content li.list-section-interfaces-types-enums { color: #22c55e; }
    .content li.list-section-objects-instances { color: #f472b6; }
    .content li.list-section-data-models-schemas { color: #fb7185; }
    .content li.list-section-parameters { color: #38bdf8; }
    .content li.list-section-return-types { color: #0ea5e9; }
    .content li.list-section-control-structures { color: #f87171; }
    .content li.list-section-operators { color: #f97316; }
    .content li.list-section-data-structures { color: #2dd4bf; }
    .content li.list-section-async-concurrency { color: #818cf8; }
    .content li.list-section-module-file-structure { color: #a3a3a3; }
    .content li.list-section-other-concepts-detected { color: #e5e7eb; }
    .content code {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1px 6px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
    }
    .content a.symbol-link { text-decoration: none; cursor: pointer; border-bottom: 1px dashed transparent; }
    .content a.symbol-link code { border-color: transparent; }
    .content a.symbol-link.symbol-function code { color: #93c5fd; }
    .content a.symbol-link.symbol-variable code { color: #facc15; }
    .content a.symbol-link.symbol-import code { color: #a78bfa; }
    .content a.symbol-link:hover { border-bottom-color: currentColor; }
    .content pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; margin: 10px 0; }
    .content pre code { background: transparent; border: none; border-radius: 0; padding: 0; }
    .content.list-mode h1 { font-size: 18px; margin-top: 20px; margin-bottom: 8px; letter-spacing: 0.2px; }
    .content.list-mode h2 { font-size: 16px; margin-top: 14px; margin-bottom: 8px; }
    .content.list-mode h3 { font-size: 14px; margin-top: 10px; margin-bottom: 6px; color: #dbe6f7; }
    .content.list-mode p {
      color: #c5d4ec;
      margin: 6px 0;
      line-height: 1.65;
    }
    .content.list-mode ul,
    .content.list-mode ol {
      margin: 6px 0 10px 18px;
    }
    .content.list-mode li {
      margin: 3px 0;
      line-height: 1.6;
    }
    .content.list-mode code {
      background: color-mix(in oklab, var(--code-bg) 55%, transparent);
      border-color: color-mix(in oklab, var(--border) 65%, transparent);
      padding: 0 4px;
      border-radius: 4px;
      font-size: 12px;
      color: #d8e5fb;
      font-family: Consolas, "Courier New", monospace;
    }
    .content.list-mode li code {
      font-size: 12px;
    }
    .content.list-mode a.symbol-link {
      border-bottom: none;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
      color: #a8c8ff;
    }
    .content.list-mode a.symbol-link code {
      color: inherit;
    }
    .dot { width: 9px; height: 9px; border-radius: 999px; display: inline-block; margin-right: 8px; background: var(--accent); box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 65%, white); }
    .hint { color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="title"><span class="dot"></span>Mushroom PCE</div>
      <div class="status">${escapeHtml(this.status)}</div>
    </div>
    <div class="model-card">
      <div class="model-title">Model In Use</div>
      <div class="model-current">${escapeHtml(this.currentModel)}</div>
      <div class="model-actions">
        <a class="fallback-link" href="command:mushroom-pce.selectModel">Select Model</a>
      </div>
      ${modelListHtml}
    </div>
    <div class="mode-card">
      <div class="mode-title">Response Mode</div>
      <div class="mode-current">${listActive ? 'List Mode' : 'Developer Mode'}</div>
      <div class="mode-actions">
        <a class="mode-pill ${listActive ? 'active' : ''}" href="command:mushroom-pce.setListMode">List Mode</a>
        <a class="mode-pill ${developerActive ? 'active' : ''}" href="command:mushroom-pce.setDeveloperMode">Developer Mode</a>
      </div>
    </div>
    ${warningHtml}
    <div class="toolbar">
      ${buttonHtml}
      <a class="fallback-link" href="command:mushroom-pce.analyzeActive">Analyze (fallback)</a>
      <a class="fallback-link" href="command:mushroom-pce.openCircuit">Circuit Mode</a>
      <div class="hint">Update your code, then click Analyze.</div>
    </div>
    <div class="content ${isListMode ? 'list-mode' : 'developer-mode'}">${explainHtml}</div>
  </div>
</body>
</html>`;
	}
}


