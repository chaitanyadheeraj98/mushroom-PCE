import * as vscode from 'vscode';

import {
	BlueprintPlanningArtifacts,
	BlueprintPlannerAssistantTurn
} from '../../services/blueprint/generateBlueprintCode';

type BlueprintChatTurn = {
	role: 'user' | 'assistant';
	text: string;
};

type HandleUserTurnRequest = {
	userMessage: string;
	history: BlueprintChatTurn[];
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
	private readonly onGenerateArtifacts: (history: BlueprintChatTurn[]) => Promise<BlueprintPlanningArtifacts>;
	private readonly onSaveArtifacts: (artifacts: BlueprintPlanningArtifacts | undefined) => Promise<SaveResult>;
	private latestArtifacts: BlueprintPlanningArtifacts | undefined;
	private graphifyContextEnabled = false;

	static createOrShow(
		onUserTurn: (request: HandleUserTurnRequest) => Promise<BlueprintPlannerAssistantTurn>,
		onGenerateArtifacts: (history: BlueprintChatTurn[]) => Promise<BlueprintPlanningArtifacts>,
		onSaveArtifacts: (artifacts: BlueprintPlanningArtifacts | undefined) => Promise<SaveResult>,
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
			onGenerateArtifacts,
			onSaveArtifacts,
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
		onGenerateArtifacts: (history: BlueprintChatTurn[]) => Promise<BlueprintPlanningArtifacts>,
		onSaveArtifacts: (artifacts: BlueprintPlanningArtifacts | undefined) => Promise<SaveResult>,
		options?: { initialGraphifyContextEnabled?: boolean }
	) {
		this.panel = panel;
		this.onUserTurn = onUserTurn;
		this.onGenerateArtifacts = onGenerateArtifacts;
		this.onSaveArtifacts = onSaveArtifacts;
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
				if (msg?.type === 'blueprintGeneratePrompt') {
					await this.handleGenerateArtifacts(normalizeHistory(msg?.history));
					return;
				}
				if (msg?.type === 'blueprintSavePromptArtifacts') {
					await this.handleSaveArtifacts();
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

	private async handleGenerateArtifacts(history: BlueprintChatTurn[]): Promise<void> {
		try {
			const artifacts = await this.onGenerateArtifacts(history);
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
          <button id="graphifyContextIndicator" class="graphify-pill off" title="Toggle Graphify Context" aria-label="Toggle Graphify Context">Graphify Context: Off</button>
          <button id="copyChatBtn" class="icon-btn" title="Copy chat transcript" aria-label="Copy chat transcript">⧉</button>
          <div id="status" class="status">Start by describing the feature. I will ask implementation questions.</div>
        </div>
      </div>
      <div id="chat" class="chat"></div>
      <div class="composer">
        <textarea id="userInput" placeholder="Describe the feature, constraints, and expected behavior..."></textarea>
        <div class="actions">
          <button id="sendBtn" class="primary">Send To Planner</button>
          <button id="generateBtn">Generate JSON Spec + Prompt</button>
          <button id="saveBtn" class="warn" disabled>Save Spec File</button>
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
    const sendBtn = document.getElementById('sendBtn');
    const generateBtn = document.getElementById('generateBtn');
    const saveBtn = document.getElementById('saveBtn');
    const metaEl = document.getElementById('meta');
    const specHead = document.getElementById('specHead');
    const specView = document.getElementById('specView');
    const promptHead = document.getElementById('promptHead');
    const promptView = document.getElementById('promptView');
    const copyChatBtn = document.getElementById('copyChatBtn');
    const copySpecBtn = document.getElementById('copySpecBtn');
    const copyPromptBtn = document.getElementById('copyPromptBtn');
    const graphifyContextIndicator = document.getElementById('graphifyContextIndicator');
    const layoutEl = document.querySelector('.layout');
    const rightWrapEl = document.getElementById('rightWrap');
    const colResizer = document.getElementById('colResizer');
    const rowResizer = document.getElementById('rowResizer');

    const state = {
      busy: false,
      history: [],
      artifacts: null,
      graphifyContextEnabled: ${initialGraphifyContextEnabledJson}
    };

    function setStatus(text) {
      statusEl.textContent = String(text || '');
    }

    function setBusy(next) {
      state.busy = !!next;
      sendBtn.disabled = state.busy;
      generateBtn.disabled = state.busy;
      saveBtn.disabled = state.busy || !state.artifacts;
      userInput.disabled = state.busy;
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

    function sendTurn() {
      if (state.busy) {
        return;
      }
      const message = String(userInput.value || '').trim();
      if (!message) {
        setStatus('Enter a feature message first.');
        return;
      }
      addHistory('user', message);
      pushBubble('user', message);
      userInput.value = '';
      setBusy(true);
      setStatus('Planner is analyzing workspace context and asking next best questions...');
      vscode.postMessage({
        type: 'blueprintUserTurn',
        userMessage: message,
        history: state.history
      });
    }

    function generatePrompt() {
      if (state.busy) {
        return;
      }
      if (!state.history.length) {
        setStatus('Start with at least one chat turn before generating.');
        return;
      }
      setBusy(true);
      setStatus('Generating final JSON spec and detailed implementation prompt...');
      vscode.postMessage({
        type: 'blueprintGeneratePrompt',
        history: state.history
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
      specHead.textContent = artifacts
        ? 'Feature: ' + (artifacts.featureName || 'Untitled') + '\\nGenerated: ' + new Date(artifacts.generatedAt).toLocaleString()
        : 'Waiting for generation.';
      specView.textContent = artifacts ? JSON.stringify(artifacts.spec || {}, null, 2) : '{}';
      promptView.textContent = artifacts ? String(artifacts.prompt || '') : '';
      saveBtn.disabled = state.busy || !state.artifacts;
      metaEl.textContent = artifacts
        ? 'Model: ' + String(artifacts.modelLabel || 'unknown')
        : 'No artifacts generated yet.';
    }

    sendBtn.addEventListener('click', sendTurn);
    generateBtn.addEventListener('click', generatePrompt);
    saveBtn.addEventListener('click', saveArtifacts);
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
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
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
          return;
        }
        const result = msg.result || {};
        const assistantText = String(result.message || '').trim() || 'No response generated.';
        addHistory('assistant', assistantText);
        pushBubble('assistant', assistantText);
        const unresolved = Array.isArray(result.unresolvedQuestions) ? result.unresolvedQuestions.length : 0;
        setStatus(unresolved > 0
          ? ('Planner needs ' + unresolved + ' more clarification item(s).')
          : 'Planner looks complete. Generate when ready.');
        metaEl.textContent = unresolved > 0
          ? ('Unresolved questions:\\n' + result.unresolvedQuestions.join('\\n- '))
          : 'No unresolved questions detected in this turn.';
        return;
      }

      if (msg.type === 'blueprintPromptGenerated') {
        setBusy(false);
        if (msg.error) {
          setStatus('Generation failed: ' + String(msg.error));
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
      }
    });

    initResizers();
    updateGraphifyContextIndicator();
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
