import * as vscode from 'vscode';

import {
	BlueprintPlanningArtifacts,
	BlueprintPlannerAssistantTurn
} from '../../services/blueprint/generateBlueprintCode';
import { BlueprintFeatureRegistryOption } from '../../services/blueprint/featureRegistry';

type BlueprintChatTurn = {
	role: 'user' | 'assistant';
	text: string;
};

type HandleUserTurnRequest = {
	userMessage: string;
	history: BlueprintChatTurn[];
};

type HandleRepoChatRequest = {
	userMessage: string;
	history: BlueprintChatTurn[];
};

type HandleGenerateArtifactsRequest = {
	history: BlueprintChatTurn[];
	forcedFeatureId?: string;
};

type SaveResult = {
	saved: boolean;
	path?: string;
	message: string;
};

export class BlueprintPanel {
	private static currentPanel: BlueprintPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly onUserTurn: (request: HandleUserTurnRequest) => Promise<BlueprintPlannerAssistantTurn>;
	private readonly onRepoChat: (request: HandleRepoChatRequest) => Promise<string>;
	private readonly onGenerateArtifacts: (request: HandleGenerateArtifactsRequest) => Promise<BlueprintPlanningArtifacts>;
	private readonly onSaveArtifacts: (artifacts: BlueprintPlanningArtifacts | undefined) => Promise<SaveResult>;
	private readonly onLoadFeatureRegistry: () => Promise<BlueprintFeatureRegistryOption[]>;
	private latestArtifacts: BlueprintPlanningArtifacts | undefined;
	private forcedFeatureId: string | undefined;
	private graphifyContextEnabled = false;

	static createOrShow(
		onUserTurn: (request: HandleUserTurnRequest) => Promise<BlueprintPlannerAssistantTurn>,
		onRepoChat: (request: HandleRepoChatRequest) => Promise<string>,
		onGenerateArtifacts: (request: HandleGenerateArtifactsRequest) => Promise<BlueprintPlanningArtifacts>,
		onSaveArtifacts: (artifacts: BlueprintPlanningArtifacts | undefined) => Promise<SaveResult>,
		onLoadFeatureRegistry: () => Promise<BlueprintFeatureRegistryOption[]>,
		options?: { initialGraphifyContextEnabled?: boolean }
	): BlueprintPanel {
		if (BlueprintPanel.currentPanel) {
			if (typeof options?.initialGraphifyContextEnabled === 'boolean') {
				BlueprintPanel.currentPanel.graphifyContextEnabled = options.initialGraphifyContextEnabled;
				BlueprintPanel.currentPanel.panel.webview.postMessage({
					type: 'graphifyContextState',
					enabled: options.initialGraphifyContextEnabled
				});
			}
			BlueprintPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			return BlueprintPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			'mushroomPceBlueprint',
			'Mushroom PCE: Blueprint Planner',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		BlueprintPanel.currentPanel = new BlueprintPanel(
			panel,
			onUserTurn,
			onRepoChat,
			onGenerateArtifacts,
			onSaveArtifacts,
			onLoadFeatureRegistry,
			options
		);
		return BlueprintPanel.currentPanel;
	}

	static setGraphifyContextEnabled(enabled: boolean): void {
		if (!BlueprintPanel.currentPanel) {
			return;
		}
		BlueprintPanel.currentPanel.graphifyContextEnabled = enabled;
		BlueprintPanel.currentPanel.panel.webview.postMessage({ type: 'graphifyContextState', enabled });
	}

	private constructor(
		panel: vscode.WebviewPanel,
		onUserTurn: (request: HandleUserTurnRequest) => Promise<BlueprintPlannerAssistantTurn>,
		onRepoChat: (request: HandleRepoChatRequest) => Promise<string>,
		onGenerateArtifacts: (request: HandleGenerateArtifactsRequest) => Promise<BlueprintPlanningArtifacts>,
		onSaveArtifacts: (artifacts: BlueprintPlanningArtifacts | undefined) => Promise<SaveResult>,
		onLoadFeatureRegistry: () => Promise<BlueprintFeatureRegistryOption[]>,
		options?: { initialGraphifyContextEnabled?: boolean }
	) {
		this.panel = panel;
		this.onUserTurn = onUserTurn;
		this.onRepoChat = onRepoChat;
		this.onGenerateArtifacts = onGenerateArtifacts;
		this.onSaveArtifacts = onSaveArtifacts;
		this.onLoadFeatureRegistry = onLoadFeatureRegistry;
		this.graphifyContextEnabled = Boolean(options?.initialGraphifyContextEnabled);

		this.panel.webview.html = this.getHtml();
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				if (msg?.type === 'blueprintUserTurn') {
					await this.handleUserTurn({
						userMessage: String(msg?.userMessage || ''),
						history: normalizeHistory(msg?.history)
					});
					return;
				}
				if (msg?.type === 'blueprintRepoChat') {
					await this.handleRepoChat({
						userMessage: String(msg?.userMessage || ''),
						history: normalizeHistory(msg?.history)
					});
					return;
				}
				if (msg?.type === 'blueprintGeneratePrompt') {
					await this.handleGenerateArtifacts({
						history: normalizeHistory(msg?.history),
						forcedFeatureId: String(msg?.forcedFeatureId || '').trim() || this.forcedFeatureId
					});
					return;
				}
				if (msg?.type === 'blueprintSavePromptArtifacts') {
					await this.handleSaveArtifacts();
					return;
				}
				if (msg?.type === 'blueprintLoadFeatureRegistry') {
					await this.handleLoadFeatureRegistry();
					return;
				}
				if (msg?.type === 'blueprintSetForcedFeatureLink') {
					this.forcedFeatureId = String(msg?.featureId || '').trim() || undefined;
					this.panel.webview.postMessage({
						type: 'blueprintForcedFeatureLinkState',
						forcedFeatureId: this.forcedFeatureId
					});
					return;
				}
				if (msg?.type === 'blueprintClearForcedFeatureLink') {
					this.forcedFeatureId = undefined;
					this.panel.webview.postMessage({
						type: 'blueprintForcedFeatureLinkState',
						forcedFeatureId: this.forcedFeatureId
					});
					return;
				}
				if (msg?.type === 'blueprintToggleGraphifyContext') {
					await vscode.commands.executeCommand('mushroom-pce.toggleGraphifyContext');
				}
			},
			null,
			this.disposables
		);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private dispose(): void {
		if (BlueprintPanel.currentPanel === this) {
			BlueprintPanel.currentPanel = undefined;
		}
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}

	private async handleUserTurn(request: HandleUserTurnRequest): Promise<void> {
		try {
			const result = await this.onUserTurn(request);
			this.panel.webview.postMessage({
				type: 'blueprintAssistantTurn',
				result
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintAssistantTurn',
				error: error?.message ?? String(error)
			});
		}
	}

	private async handleRepoChat(request: HandleRepoChatRequest): Promise<void> {
		try {
			const message = await this.onRepoChat(request);
			this.panel.webview.postMessage({
				type: 'blueprintRepoAssistantTurn',
				result: {
					message
				}
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintRepoAssistantTurn',
				error: error?.message ?? String(error)
			});
		}
	}

	private async handleGenerateArtifacts(request: HandleGenerateArtifactsRequest): Promise<void> {
		try {
			const artifacts = await this.onGenerateArtifacts(request);
			this.forcedFeatureId = String(request.forcedFeatureId || '').trim() || undefined;
			this.latestArtifacts = artifacts;
			this.panel.webview.postMessage({
				type: 'blueprintPromptGenerated',
				artifacts
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintPromptGenerated',
				error: error?.message ?? String(error)
			});
		}
	}

	private async handleLoadFeatureRegistry(): Promise<void> {
		try {
			const options = await this.onLoadFeatureRegistry();
			this.panel.webview.postMessage({
				type: 'blueprintFeatureRegistryLoaded',
				options,
				forcedFeatureId: this.forcedFeatureId
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintFeatureRegistryLoaded',
				error: error?.message ?? String(error),
				options: [],
				forcedFeatureId: this.forcedFeatureId
			});
		}
	}

	private async handleSaveArtifacts(): Promise<void> {
		try {
			const result = await this.onSaveArtifacts(this.latestArtifacts);
			this.panel.webview.postMessage({
				type: 'blueprintPromptSaved',
				result
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintPromptSaved',
				result: {
					saved: false,
					message: error?.message ?? String(error)
				}
			});
		}
	}

	private getHtml(): string {
		const nonce = getNonce();
		const csp = this.panel.webview.cspSource;
		const initialGraphifyContextEnabledJson = JSON.stringify(this.graphifyContextEnabled);
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blueprint Planner</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #0f172a;
      --line: #21304d;
      --muted: #9fb0cc;
      --text: #e2e8f0;
      --accent: #22c55e;
      --accent-2: #16a34a;
      --danger: #ef4444;
      --code-bg: #0b1225;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body {
      margin: 0;
      background: radial-gradient(circle at top right, #1e293b, var(--bg) 55%);
      color: var(--text);
      font-family: "Segoe UI", Tahoma, sans-serif;
      min-height: 100dvh;
      overflow: auto;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(360px, var(--left-width, 62%)) 8px minmax(300px, 1fr);
      gap: 10px;
      padding: 12px;
      height: 100%;
      min-height: 0;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in oklab, var(--panel) 94%, black);
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    .header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .header-tools {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .title { font-size: 14px; font-weight: 700; letter-spacing: 0; }
    .status { font-size: 12px; color: var(--muted); min-height: 16px; }
    .mode-badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      color: #dbe7fb;
      background: color-mix(in oklab, #1f2d4f 45%, var(--code-bg));
      white-space: nowrap;
    }
    .mode-badge.mode-blueprint {
      border-color: color-mix(in oklab, #22c55e 55%, var(--line));
      color: #d9ffe8;
    }
    .mode-badge.mode-chat {
      border-color: color-mix(in oklab, #5fb3ff 55%, var(--line));
      color: #d6e9ff;
    }
    .graphify-pill {
      border: 1px solid #36507f;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0;
      color: #cfe3ff;
      background: linear-gradient(180deg, rgba(19, 35, 70, 0.95), rgba(14, 27, 58, 0.95));
      cursor: pointer;
      user-select: none;
      transition: border-color 120ms ease, background-color 120ms ease;
    }
    .graphify-pill:hover {
      border-color: color-mix(in oklab, #5fb3ff 44%, #36507f);
    }
    .graphify-pill.on {
      border-color: color-mix(in oklab, #22c55e 58%, #36507f);
      background: color-mix(in oklab, #22c55e 18%, rgba(14, 27, 58, 0.95));
      color: #d9ffe8;
    }
    .graphify-pill.off {
      border-color: color-mix(in oklab, #5f6d85 58%, #36507f);
      background: color-mix(in oklab, #5f6d85 18%, rgba(14, 27, 58, 0.95));
      color: #d1d9e6;
    }
    .icon-btn {
      border: 1px solid var(--line);
      border-radius: 6px;
      width: 26px;
      height: 26px;
      min-width: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #13203b;
      color: #d6e7ff;
      cursor: pointer;
      font-size: 13px;
      padding: 0;
      line-height: 1;
    }
    .icon-btn:hover {
      border-color: color-mix(in oklab, #5fb3ff 42%, var(--line));
      background: color-mix(in oklab, #5fb3ff 18%, #13203b);
    }
    .chat {
      flex: 1;
      min-height: 220px;
      overflow: auto;
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .bubble {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .bubble.user {
      justify-self: end;
      width: min(88%, 680px);
      background: color-mix(in oklab, #22c55e 18%, var(--panel));
      border-color: color-mix(in oklab, #22c55e 55%, var(--line));
    }
    .bubble.assistant {
      justify-self: start;
      width: min(94%, 760px);
      background: color-mix(in oklab, #93c5fd 8%, var(--panel));
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-line;
    }
    .composer {
      border-top: 1px solid var(--line);
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--code-bg);
      color: var(--text);
      font-family: "Segoe UI", Tahoma, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      padding: 9px;
      min-height: 80px;
      max-height: 180px;
      resize: vertical;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    button {
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #13203b;
      color: var(--text);
      font-size: 12px;
      font-weight: 600;
      padding: 8px 10px;
      cursor: pointer;
    }
    button.primary {
      border-color: color-mix(in oklab, var(--accent) 55%, white);
      background: color-mix(in oklab, var(--accent-2) 70%, #0f172a);
    }
    button.warn {
      border-color: color-mix(in oklab, var(--danger) 60%, white);
      background: color-mix(in oklab, var(--danger) 36%, #0f172a);
    }
    button:disabled { opacity: 0.55; cursor: default; }
    .feature-link-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px;
      background: color-mix(in oklab, var(--code-bg) 72%, var(--panel));
      display: grid;
      gap: 8px;
    }
    .feature-link-head {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
    }
    .feature-match-card {
      font-size: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 8px;
      background: color-mix(in oklab, #1f2d4f 40%, var(--code-bg));
    }
    .feature-match-card.high {
      border-color: color-mix(in oklab, #22c55e 65%, var(--line));
      color: #d9ffe8;
    }
    .feature-match-card.medium {
      border-color: color-mix(in oklab, #f59e0b 65%, var(--line));
      color: #fff1cc;
    }
    .feature-match-card.low {
      border-color: color-mix(in oklab, #ef4444 55%, var(--line));
      color: #ffd8d8;
    }
    .feature-link-chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      width: fit-content;
      font-size: 11px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      background: color-mix(in oklab, #1f2d4f 40%, var(--code-bg));
      color: #dbe7fb;
    }
    .feature-link-chip.mode-forced {
      border-color: color-mix(in oklab, #22c55e 65%, var(--line));
      color: #d9ffe8;
    }
    .feature-link-chip.mode-auto {
      border-color: color-mix(in oklab, #5f6d85 62%, var(--line));
      color: #d1d9e6;
    }
    .feature-link-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    select {
      min-width: 240px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--code-bg);
      color: var(--text);
      padding: 7px 8px;
      font-size: 12px;
    }
    .meta {
      font-size: 11px;
      color: var(--muted);
      white-space: pre-wrap;
      min-height: 32px;
      padding: 8px 10px;
      border-top: 1px solid color-mix(in oklab, var(--line) 80%, black);
    }
    .right-wrap {
      display: grid;
      grid-template-rows: minmax(160px, var(--top-height, 50%)) 8px minmax(180px, 1fr);
      gap: 10px;
      min-height: 0;
    }
    .resizer {
      border-radius: 6px;
      background: color-mix(in oklab, var(--line) 85%, #5d7ba8);
      opacity: 0.85;
      transition: opacity 120ms ease, background-color 120ms ease;
    }
    .resizer:hover {
      opacity: 1;
      background: color-mix(in oklab, #5fb3ff 40%, var(--line));
    }
    .resizer.col {
      cursor: col-resize;
      width: 8px;
      min-width: 8px;
      height: 100%;
    }
    .resizer.row {
      cursor: row-resize;
      width: 100%;
      min-height: 8px;
      height: 8px;
    }
    pre {
      margin: 0;
      padding: 10px;
      font-size: 11px;
      line-height: 1.45;
      color: #dbe7fb;
      background: var(--code-bg);
      border-top: 1px solid var(--line);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      flex: 1;
      min-height: 0;
    }
    .artifact-head {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
      color: var(--muted);
      min-height: 18px;
      white-space: pre-wrap;
    }
    @media (max-width: 1180px) {
      .layout {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(360px, 1fr) minmax(320px, 1fr);
        height: 100%;
      }
      .resizer.col {
        display: none;
      }
      .right-wrap {
        grid-template-rows: minmax(180px, 1fr) 8px minmax(180px, 1fr);
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <section class="panel" id="chatPanel">
      <div class="header">
        <div class="title">Blueprint Planner Chat</div>
        <div class="header-tools">
          <div id="modeBadge" class="mode-badge mode-chat">Mode: Repo Chat</div>
          <button id="graphifyContextIndicator" class="graphify-pill off" title="Toggle Graphify Context" aria-label="Toggle Graphify Context">Graphify Context: Off</button>
          <button id="copyChatBtn" class="icon-btn" title="Copy chat transcript" aria-label="Copy chat transcript">⧉</button>
          <div id="status" class="status">Use /chat for repo Q&A, /start for blueprint session, /generate to build spec, /save to save spec, /end to export and end, /clear to reset visible chat.</div>
        </div>
      </div>
      <div id="chat" class="chat"></div>
      <div class="composer">
        <textarea id="userInput" placeholder="Describe the feature, constraints, and expected behavior..."></textarea>
        <div class="feature-link-panel">
          <div class="feature-link-head">Feature Link</div>
          <div id="featureMatchCard" class="feature-match-card">Auto-match: no data yet.</div>
          <div id="featureLinkChip" class="feature-link-chip mode-auto">Current link: none (Auto)</div>
          <div class="feature-link-row">
            <select id="featureLinkSelect"></select>
            <button id="forceLinkBtn">Force Link</button>
            <button id="clearLinkBtn">Clear Override</button>
            <button id="refreshLinksBtn">Refresh Features</button>
          </div>
        </div>
      </div>
      <div id="meta" class="meta">No artifacts generated yet.</div>
    </section>
    <div id="colResizer" class="resizer col" title="Resize columns"></div>

    <div class="right-wrap" id="rightWrap">
      <section class="panel" id="jsonPanel">
        <div class="header">
          <div class="title">JSON Spec</div>
          <button id="copySpecBtn" class="icon-btn" title="Copy JSON spec" aria-label="Copy JSON spec">⧉</button>
        </div>
        <div id="specHead" class="artifact-head">Waiting for generation.</div>
        <pre id="specView">{}</pre>
      </section>
      <div id="rowResizer" class="resizer row" title="Resize rows"></div>
      <section class="panel" id="promptPanel">
        <div class="header">
          <div class="title">Prompt Output</div>
          <button id="copyPromptBtn" class="icon-btn" title="Copy prompt output" aria-label="Copy prompt output">⧉</button>
        </div>
        <div id="promptHead" class="artifact-head">Use this prompt with coding AI when ready.</div>
        <pre id="promptView"></pre>
      </section>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const statusEl = document.getElementById('status');
    const chatEl = document.getElementById('chat');
    const userInput = document.getElementById('userInput');
    const metaEl = document.getElementById('meta');
    const specHead = document.getElementById('specHead');
    const specView = document.getElementById('specView');
    const promptHead = document.getElementById('promptHead');
    const promptView = document.getElementById('promptView');
    const copyChatBtn = document.getElementById('copyChatBtn');
    const copySpecBtn = document.getElementById('copySpecBtn');
    const copyPromptBtn = document.getElementById('copyPromptBtn');
    const graphifyContextIndicator = document.getElementById('graphifyContextIndicator');
    const modeBadge = document.getElementById('modeBadge');
    const featureMatchCard = document.getElementById('featureMatchCard');
    const featureLinkChip = document.getElementById('featureLinkChip');
    const featureLinkSelect = document.getElementById('featureLinkSelect');
    const forceLinkBtn = document.getElementById('forceLinkBtn');
    const clearLinkBtn = document.getElementById('clearLinkBtn');
    const refreshLinksBtn = document.getElementById('refreshLinksBtn');
    const layoutEl = document.querySelector('.layout');
    const rightWrapEl = document.getElementById('rightWrap');
    const colResizer = document.getElementById('colResizer');
    const rowResizer = document.getElementById('rowResizer');

    const state = {
      busy: false,
      history: [],
      blueprintHistory: [],
      repoHistory: [],
      artifacts: null,
      graphifyContextEnabled: ${initialGraphifyContextEnabledJson},
      forcedFeatureId: null,
      registryOptions: [],
      mode: 'chat'
    };

    function setStatus(text) {
      statusEl.textContent = String(text || '');
    }

    function setBusy(next) {
      state.busy = !!next;
      userInput.disabled = state.busy;
      forceLinkBtn.disabled = state.busy || !featureLinkSelect.value;
      clearLinkBtn.disabled = state.busy || !state.forcedFeatureId;
      refreshLinksBtn.disabled = state.busy;
    }

    function formatAssistantText(text) {
      return String(text || '')
        .replace(/\\r\\n/g, '\\n')
        .replace(/\\*\\*(.*?)\\*\\*/g, '$1')
        .split(String.fromCharCode(96)).join('')
        .replace(/^\\s*-\\s+/gm, '- ')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function updateGraphifyContextIndicator() {
      if (!graphifyContextIndicator) {
        return;
      }
      graphifyContextIndicator.textContent = 'Graphify Context: ' + (state.graphifyContextEnabled ? 'On' : 'Off');
      graphifyContextIndicator.classList.toggle('on', !!state.graphifyContextEnabled);
      graphifyContextIndicator.classList.toggle('off', !state.graphifyContextEnabled);
    }

    async function copyText(text, label) {
      const value = String(text || '').trim();
      if (!value) {
        setStatus('Nothing to copy from ' + label + '.');
        return;
      }
      try {
        await navigator.clipboard.writeText(value);
        setStatus(label + ' copied.');
      } catch {
        setStatus('Copy failed for ' + label + '.');
      }
    }

    function getChatTranscriptText() {
      return state.history
        .map((turn) => (turn.role === 'assistant' ? 'ASSISTANT' : 'USER') + ': ' + String(turn.text || '').trim())
        .join('\\n\\n')
        .trim();
    }

    function setMode(mode) {
      state.mode = mode === 'blueprint' ? 'blueprint' : 'chat';
      if (modeBadge) {
        modeBadge.classList.remove('mode-blueprint', 'mode-chat');
        modeBadge.classList.add(state.mode === 'blueprint' ? 'mode-blueprint' : 'mode-chat');
        modeBadge.textContent = state.mode === 'blueprint' ? 'Mode: Blueprint Session' : 'Mode: Repo Chat';
      }
    }

    function confidencePercent(score) {
      const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
      return Math.max(0, Math.min(100, Math.round(value * 100)));
    }

    function toBand(score, providedBand) {
      if (providedBand === 'high' || providedBand === 'medium' || providedBand === 'low') {
        return providedBand;
      }
      const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
      if (value >= 0.75) return 'high';
      if (value >= 0.5) return 'medium';
      return 'low';
    }

    function findFeatureLabel(featureId) {
      const found = state.registryOptions.find((item) => item.featureId === featureId);
      if (!found) {
        return featureId;
      }
      return found.featureName + ' (' + found.featureId + ')';
    }

    function renderFeatureRegistryOptions() {
      if (!featureLinkSelect) {
        return;
      }
      featureLinkSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = state.registryOptions.length
        ? 'Select existing feature ID...'
        : 'No tracked features found';
      featureLinkSelect.appendChild(placeholder);
      for (const item of state.registryOptions) {
        const option = document.createElement('option');
        option.value = item.featureId;
        option.textContent = item.featureName + ' [' + item.featureId + '] r' + item.revision + ' (' + item.status + ')';
        featureLinkSelect.appendChild(option);
      }
      featureLinkSelect.value = state.forcedFeatureId || '';
      forceLinkBtn.disabled = state.busy || !featureLinkSelect.value;
      clearLinkBtn.disabled = state.busy || !state.forcedFeatureId;
    }

    function renderFeatureTracking() {
      const tracking = state.artifacts && state.artifacts.featureTracking ? state.artifacts.featureTracking : null;
      const score = tracking && typeof tracking.overlapScore === 'number' ? tracking.overlapScore : undefined;
      const band = toBand(score, tracking && tracking.matchBand);
      if (featureMatchCard) {
        featureMatchCard.classList.remove('high', 'medium', 'low');
        featureMatchCard.classList.add(band);
        if (tracking && tracking.matchedExistingFeatureId) {
          featureMatchCard.textContent =
            'Matched existing feature: ' +
            findFeatureLabel(tracking.matchedExistingFeatureId) +
            ' | Confidence: ' + confidencePercent(score) + '% (' + band + ')';
        } else if (tracking) {
          featureMatchCard.textContent = 'No existing feature match. Confidence: ' + confidencePercent(score) + '% (' + band + ')';
        } else {
          featureMatchCard.textContent = 'Auto-match: no data yet.';
          featureMatchCard.classList.remove('high', 'medium', 'low');
        }
      }
      if (featureLinkChip) {
        const activeForced = tracking && tracking.forcedFeatureId ? tracking.forcedFeatureId : state.forcedFeatureId;
        const linkedId = tracking && tracking.featureId ? tracking.featureId : activeForced;
        const modeText = activeForced ? 'Forced' : 'Auto';
        featureLinkChip.classList.remove('mode-auto', 'mode-forced');
        featureLinkChip.classList.add(activeForced ? 'mode-forced' : 'mode-auto');
        featureLinkChip.textContent = 'Current link: ' + (linkedId || 'none') + ' (' + modeText + ')';
      }
    }

    function loadFeatureRegistry() {
      vscode.postMessage({ type: 'blueprintLoadFeatureRegistry' });
    }

    function initResizers() {
      if (!layoutEl || !rightWrapEl || !colResizer || !rowResizer) {
        return;
      }

      colResizer.addEventListener('pointerdown', (ev) => {
        if (window.matchMedia('(max-width: 1180px)').matches) {
          return;
        }
        ev.preventDefault();
        const rect = layoutEl.getBoundingClientRect();
        const minLeft = 320;
        const maxLeft = Math.max(minLeft, rect.width - 320);

        const onMove = (moveEv) => {
          const left = clamp(moveEv.clientX - rect.left - 12, minLeft, maxLeft);
          layoutEl.style.setProperty('--left-width', left + 'px');
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      rowResizer.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const rect = rightWrapEl.getBoundingClientRect();
        const minTop = 140;
        const maxTop = Math.max(minTop, rect.height - 200);

        const onMove = (moveEv) => {
          const top = clamp(moveEv.clientY - rect.top - 8, minTop, maxTop);
          rightWrapEl.style.setProperty('--top-height', top + 'px');
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    function pushBubble(role, text) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
      bubble.textContent = role === 'assistant' ? formatAssistantText(text) : String(text || '');
      chatEl.appendChild(bubble);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    function addHistory(role, text) {
      state.history.push({ role, text: String(text || '') });
    }

    function clearBlueprintChat(options) {
      const keepMode = options && options.keepMode;
      state.history = [];
      state.blueprintHistory = [];
      state.repoHistory = [];
      state.artifacts = null;
      chatEl.innerHTML = '';
      specHead.textContent = 'Waiting for generation.';
      specView.textContent = '{}';
      promptHead.textContent = 'Use this prompt with coding AI when ready.';
      promptView.textContent = '';
      metaEl.textContent = 'Chat cleared. Start a new Blueprint conversation.';
      setStatus(keepMode
        ? 'Blueprint chat cleared. Continue in current mode.'
        : 'Blueprint chat cleared. Use /chat or /start to continue.');
      renderFeatureTracking();
      if (!keepMode) {
        setMode('chat');
      }
    }

    function downloadPromptText(promptText, featureName) {
      const text = String(promptText || '').trim();
      if (!text) {
        setStatus('Cannot end session: no generated prompt available.');
        return false;
      }
      const safeName = String(featureName || 'blueprint-prompt')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'blueprint-prompt';
      const fileName = safeName + '-implementation-prompt.txt';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return true;
    }

    function sendTurn() {
      if (state.busy) {
        return;
      }
      const message = String(userInput.value || '').trim();
      if (!message) {
        setStatus('Enter a feature message first.');
        return;
      }
      if (message.toLowerCase() === '/chat') {
        userInput.value = '';
        setMode('chat');
        setStatus('Switched to repo Q&A mode. Ask about project architecture, files, or stack.');
        return;
      }
      if (message.toLowerCase() === '/start') {
        userInput.value = '';
        clearBlueprintChat({ keepMode: true });
        setMode('blueprint');
        setStatus('Blueprint session started. Describe the feature to plan.');
        metaEl.textContent = 'Blueprint session active. Use /end when ready to export prompt.';
        return;
      }
      if (message.toLowerCase() === '/end') {
        userInput.value = '';
        if (state.mode !== 'blueprint') {
          setStatus('No active blueprint session. Use /start to begin one.');
          return;
        }
        const ok = downloadPromptText(state.artifacts && state.artifacts.prompt, state.artifacts && state.artifacts.featureName);
        if (!ok) {
          metaEl.textContent = 'Generate JSON Spec + Prompt before /end so the prompt can be exported.';
          return;
        }
        setMode('chat');
        setStatus('Blueprint session ended. Prompt exported. You are now in repo Q&A mode.');
        metaEl.textContent = 'Session ended. Start a new one with /start.';
        return;
      }
      if (message.toLowerCase() === '/generate') {
        userInput.value = '';
        generatePrompt();
        return;
      }
      if (message.toLowerCase() === '/save') {
        userInput.value = '';
        saveArtifacts();
        return;
      }
      if (message.toLowerCase() === '/clear') {
        userInput.value = '';
        clearBlueprintChat({ keepMode: true });
        return;
      }
      addHistory('user', message);
      if (state.mode === 'blueprint') {
        state.blueprintHistory.push({ role: 'user', text: message });
      } else {
        state.repoHistory.push({ role: 'user', text: message });
      }
      pushBubble('user', message);
      userInput.value = '';
      setBusy(true);
      if (state.mode === 'blueprint') {
        setStatus('Planner is analyzing workspace context and asking next best questions...');
        vscode.postMessage({
          type: 'blueprintUserTurn',
          userMessage: message,
          history: state.blueprintHistory
        });
      } else {
        setStatus('Answering project/repo question...');
        vscode.postMessage({
          type: 'blueprintRepoChat',
          userMessage: message,
          history: state.repoHistory
        });
      }
    }

    function generatePrompt() {
      if (state.busy) {
        return;
      }
      if (state.mode !== 'blueprint') {
        setStatus('Use /start to open a blueprint session before generating.');
        return;
      }
      if (!state.blueprintHistory.length) {
        setStatus('Start with at least one blueprint chat turn before generating.');
        return;
      }
      setBusy(true);
      setStatus('Generating final JSON spec and detailed implementation prompt...');
      vscode.postMessage({
        type: 'blueprintGeneratePrompt',
        history: state.blueprintHistory,
        forcedFeatureId: state.forcedFeatureId || undefined
      });
    }

    function saveArtifacts() {
      if (state.busy || !state.artifacts) {
        return;
      }
      setBusy(true);
      setStatus('Saving spec artifacts to workspace...');
      vscode.postMessage({ type: 'blueprintSavePromptArtifacts' });
    }

    function applyArtifacts(artifacts) {
      state.artifacts = artifacts || null;
      const featureTracking = artifacts && artifacts.featureTracking ? artifacts.featureTracking : null;
      state.forcedFeatureId = featureTracking && featureTracking.forcedFeatureId
        ? featureTracking.forcedFeatureId
        : state.forcedFeatureId;
      renderFeatureRegistryOptions();
      renderFeatureTracking();
      specHead.textContent = artifacts
        ? 'Feature: ' + (artifacts.featureName || 'Untitled') +
          '\\nGenerated: ' + new Date(artifacts.generatedAt).toLocaleString() +
          (featureTracking && featureTracking.featureId ? '\\nFeature ID: ' + featureTracking.featureId : '')
        : 'Waiting for generation.';
      specView.textContent = artifacts ? JSON.stringify(artifacts.spec || {}, null, 2) : '{}';
      promptView.textContent = artifacts ? String(artifacts.prompt || '') : '';
      metaEl.textContent = artifacts
        ? 'Model: ' + String(artifacts.modelLabel || 'unknown') +
          (featureTracking && featureTracking.registryPath ? '\\nRegistry: ' + featureTracking.registryPath : '') +
          (featureTracking && featureTracking.status ? '\\nTracking status: ' + featureTracking.status : '') +
          (featureTracking && featureTracking.isForcedLink ? '\\nLink mode: Forced override' : '\\nLink mode: Auto match')
        : 'No artifacts generated yet.';
    }

    featureLinkSelect?.addEventListener('change', () => {
      forceLinkBtn.disabled = state.busy || !featureLinkSelect.value;
    });
    forceLinkBtn?.addEventListener('click', () => {
      const featureId = String(featureLinkSelect.value || '').trim();
      if (!featureId) {
        return;
      }
      state.forcedFeatureId = featureId;
      vscode.postMessage({ type: 'blueprintSetForcedFeatureLink', featureId });
      renderFeatureRegistryOptions();
      renderFeatureTracking();
      setStatus('Forced link set: ' + featureId);
    });
    clearLinkBtn?.addEventListener('click', () => {
      state.forcedFeatureId = null;
      vscode.postMessage({ type: 'blueprintClearForcedFeatureLink' });
      renderFeatureRegistryOptions();
      renderFeatureTracking();
      setStatus('Forced link cleared. Auto-match restored.');
    });
    refreshLinksBtn?.addEventListener('click', () => {
      loadFeatureRegistry();
      setStatus('Refreshing tracked feature list...');
    });
    copyChatBtn?.addEventListener('click', () => {
      void copyText(getChatTranscriptText(), 'Blueprint Planner Chat');
    });
    copySpecBtn?.addEventListener('click', () => {
      void copyText(specView.textContent || '', 'JSON Spec');
    });
    copyPromptBtn?.addEventListener('click', () => {
      void copyText(promptView.textContent || '', 'Prompt Output');
    });
    graphifyContextIndicator?.addEventListener('click', () => {
      vscode.postMessage({ type: 'blueprintToggleGraphifyContext' });
    });
    userInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendTurn();
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if (msg.type === 'graphifyContextState') {
        state.graphifyContextEnabled = !!msg.enabled;
        updateGraphifyContextIndicator();
        return;
      }

      if (msg.type === 'blueprintAssistantTurn') {
        setBusy(false);
        if (msg.error) {
          setStatus('Planner error: ' + String(msg.error));
          metaEl.textContent = 'Planner failed to produce a response. Please retry.';
          return;
        }
        const result = msg.result || {};
        const assistantText = String(result.message || '').trim() || 'No response generated.';
        addHistory('assistant', assistantText);
        state.blueprintHistory.push({ role: 'assistant', text: assistantText });
        pushBubble('assistant', assistantText);
        const unresolved = Array.isArray(result.unresolvedQuestions) ? result.unresolvedQuestions.length : 0;
        const parseWarning = String(result.parseWarning || '').trim();
        setStatus(unresolved > 0
          ? ('Planner needs ' + unresolved + ' more clarification item(s).')
          : 'Planner looks complete. Generate when ready.');
        if (parseWarning) {
          const unresolvedBlock = unresolved > 0
            ? ('\\n\\nUnresolved questions:\\n- ' + result.unresolvedQuestions.join('\\n- '))
            : '';
          metaEl.textContent = 'Planner parse warning: ' + parseWarning + unresolvedBlock;
        } else {
          metaEl.textContent = unresolved > 0
            ? ('Unresolved questions:\\n- ' + result.unresolvedQuestions.join('\\n- '))
            : 'No unresolved questions detected in this turn.';
        }
        return;
      }

      if (msg.type === 'blueprintRepoAssistantTurn') {
        setBusy(false);
        if (msg.error) {
          setStatus('Repo chat error: ' + String(msg.error));
          metaEl.textContent = 'Repo Q&A failed. Retry your question.';
          return;
        }
        const result = msg.result || {};
        const assistantText = String(result.message || '').trim() || 'No response generated.';
        addHistory('assistant', assistantText);
        state.repoHistory.push({ role: 'assistant', text: assistantText });
        pushBubble('assistant', assistantText);
        setStatus('Repo Q&A response ready.');
        metaEl.textContent = 'Repo chat mode active. Use /start to begin feature blueprinting.';
        return;
      }

      if (msg.type === 'blueprintPromptGenerated') {
        setBusy(false);
        if (msg.error) {
          const errorText = String(msg.error);
          setStatus('Generation failed: ' + errorText);
          metaEl.textContent = [
            'Generation blocked due to invalid planner JSON.',
            'Fix: Retry Generate and keep output in strict JSON mode.',
            '',
            'Details:',
            errorText
          ].join('\\n');
          return;
        }
        applyArtifacts(msg.artifacts || null);
        setStatus('Artifacts generated. Review JSON spec and prompt, then save.');
        return;
      }

      if (msg.type === 'blueprintPromptSaved') {
        setBusy(false);
        const result = msg.result || {};
        const ok = !!result.saved;
        setStatus(ok ? 'Spec saved.' : 'Save failed.');
        metaEl.textContent = String(result.message || (ok ? 'Saved.' : 'Not saved.'));
        return;
      }

      if (msg.type === 'blueprintFeatureRegistryLoaded') {
        if (msg.error) {
          setStatus('Feature registry load failed: ' + String(msg.error));
        }
        state.registryOptions = Array.isArray(msg.options) ? msg.options : [];
        state.forcedFeatureId = msg.forcedFeatureId ? String(msg.forcedFeatureId) : state.forcedFeatureId;
        renderFeatureRegistryOptions();
        renderFeatureTracking();
        return;
      }

      if (msg.type === 'blueprintForcedFeatureLinkState') {
        state.forcedFeatureId = msg.forcedFeatureId ? String(msg.forcedFeatureId) : null;
        renderFeatureRegistryOptions();
        renderFeatureTracking();
      }
    });

    initResizers();
    updateGraphifyContextIndicator();
    setMode(state.mode);
    renderFeatureRegistryOptions();
    renderFeatureTracking();
    loadFeatureRegistry();
  </script>
</body>
</html>`;
	}
}

function normalizeHistory(raw: any): BlueprintChatTurn[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.map((turn) => ({
			role: (turn?.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
			text: String(turn?.text || '').trim()
		}))
		.filter((turn) => turn.text.length > 0);
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < 32; i++) {
		out += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return out;
}
