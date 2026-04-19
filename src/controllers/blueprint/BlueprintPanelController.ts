import * as vscode from 'vscode';

import { CircuitGraph } from '../../shared/types/circuitTypes';
import { BlueprintPlanResult } from '../../services/blueprint/buildBlueprintPlan';

type ChatTurn = { role: 'user' | 'assistant'; text: string };

type GenerateRequest = {
	featureRequest: string;
	history: ChatTurn[];
};

type AskRequest = {
	question: string;
	history: ChatTurn[];
};

type ApplyResult = {
	approved: boolean;
	message: string;
};

export class BlueprintPanel {
	private static currentPanel: BlueprintPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly onGenerate: (request: GenerateRequest) => Promise<BlueprintPlanResult | undefined>;
	private readonly onAsk: (request: AskRequest, plan: BlueprintPlanResult | undefined) => Promise<string>;
	private readonly onApply: (plan: BlueprintPlanResult | undefined) => Promise<ApplyResult>;
	private readonly onOpenCircuit: (plan: BlueprintPlanResult | undefined) => Promise<void>;
	private currentPlan: BlueprintPlanResult | undefined;

	static createOrShow(
		onGenerate: (request: GenerateRequest) => Promise<BlueprintPlanResult | undefined>,
		onAsk: (request: AskRequest, plan: BlueprintPlanResult | undefined) => Promise<string>,
		onApply: (plan: BlueprintPlanResult | undefined) => Promise<ApplyResult>,
		onOpenCircuit: (plan: BlueprintPlanResult | undefined) => Promise<void>
	): BlueprintPanel {
		if (BlueprintPanel.currentPanel) {
			BlueprintPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			return BlueprintPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			'mushroomPceBlueprint',
			'Mushroom PCE: Blueprint',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		BlueprintPanel.currentPanel = new BlueprintPanel(panel, onGenerate, onAsk, onApply, onOpenCircuit);
		return BlueprintPanel.currentPanel;
	}

	private constructor(
		panel: vscode.WebviewPanel,
		onGenerate: (request: GenerateRequest) => Promise<BlueprintPlanResult | undefined>,
		onAsk: (request: AskRequest, plan: BlueprintPlanResult | undefined) => Promise<string>,
		onApply: (plan: BlueprintPlanResult | undefined) => Promise<ApplyResult>,
		onOpenCircuit: (plan: BlueprintPlanResult | undefined) => Promise<void>
	) {
		this.panel = panel;
		this.onGenerate = onGenerate;
		this.onAsk = onAsk;
		this.onApply = onApply;
		this.onOpenCircuit = onOpenCircuit;

		this.panel.webview.html = this.getHtml();
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				if (msg?.type === 'generateBlueprint') {
					await this.handleGenerate({
						featureRequest: String(msg?.featureRequest ?? ''),
						history: Array.isArray(msg?.history) ? msg.history : []
					});
					return;
				}
				if (msg?.type === 'askBlueprint') {
					await this.handleAsk({
						question: String(msg?.question ?? ''),
						history: Array.isArray(msg?.history) ? msg.history : []
					});
					return;
				}
				if (msg?.type === 'applyBlueprint') {
					await this.handleApply();
					return;
				}
				if (msg?.type === 'openBlueprintCircuit') {
					await this.handleOpenCircuit();
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

	private async handleGenerate(request: GenerateRequest): Promise<void> {
		try {
			const plan = await this.onGenerate(request);
			this.currentPlan = plan;
			this.panel.webview.postMessage({
				type: 'blueprintGenerated',
				plan
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintGenerated',
				error: error?.message ?? String(error)
			});
		}
	}

	private async handleAsk(request: AskRequest): Promise<void> {
		try {
			const answer = await this.onAsk(request, this.currentPlan);
			this.panel.webview.postMessage({
				type: 'blueprintAnswered',
				answer
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintAnswered',
				error: error?.message ?? String(error)
			});
		}
	}

	private async handleApply(): Promise<void> {
		try {
			const result = await this.onApply(this.currentPlan);
			this.panel.webview.postMessage({
				type: 'blueprintApplied',
				result
			});
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintApplied',
				result: { approved: false, message: error?.message ?? String(error) }
			});
		}
	}

	private async handleOpenCircuit(): Promise<void> {
		try {
			await this.onOpenCircuit(this.currentPlan);
		} catch (error: any) {
			this.panel.webview.postMessage({
				type: 'blueprintOpenedCircuit',
				error: error?.message ?? String(error)
			});
		}
	}

	private getHtml(): string {
		const nonce = getNonce();
		const csp = this.panel.webview.cspSource;
		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blueprint</title>
  <style>
    body {
      margin: 0;
      padding: 12px;
      font-family: Segoe UI, Tahoma, sans-serif;
      color: #e2e8f0;
      background: radial-gradient(circle at top right, #1e293b, #0b1020 58%);
    }
    .wrap {
      display: flex;
      flex-direction: column;
      gap: 10px;
      height: calc(100vh - 24px);
    }
    .card {
      border: 1px solid #243553;
      border-radius: 10px;
      background: rgba(11, 18, 37, 0.9);
      padding: 10px;
    }
    .title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .muted {
      color: #a8bbd9;
      font-size: 12px;
      line-height: 1.4;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
    }
    textarea {
      width: 100%;
      min-height: 76px;
      max-height: 220px;
      resize: vertical;
      border: 1px solid #2f456b;
      border-radius: 8px;
      padding: 8px;
      background: #0b1225;
      color: #e2e8f0;
      font-family: Segoe UI, Tahoma, sans-serif;
      font-size: 13px;
      box-sizing: border-box;
    }
    button {
      border: 1px solid #2f456b;
      border-radius: 8px;
      padding: 7px 10px;
      background: rgba(15, 32, 62, 0.85);
      color: #e2e8f0;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    button.primary {
      border-color: rgba(34, 197, 94, 0.8);
      background: rgba(22, 163, 74, 0.25);
      color: #dcfce7;
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .status {
      color: #9fb4d7;
      font-size: 12px;
      margin-top: 6px;
      min-height: 16px;
    }
    #explanationPane {
      min-height: 130px;
      max-height: 55vh;
      resize: vertical;
      overflow: auto;
      border: 1px solid #2f456b;
      border-radius: 8px;
      padding: 9px;
      background: rgba(9, 18, 38, 0.9);
      line-height: 1.5;
      font-size: 12px;
      white-space: pre-wrap;
    }
    #nodesList {
      margin: 8px 0 0 16px;
      padding: 0;
      font-size: 12px;
      line-height: 1.45;
      max-height: 160px;
      overflow: auto;
    }
    .chat-log {
      border: 1px solid #2f456b;
      border-radius: 8px;
      background: rgba(9, 18, 38, 0.9);
      padding: 8px;
      max-height: 220px;
      overflow: auto;
      display: grid;
      gap: 8px;
    }
    .bubble {
      border-radius: 8px;
      border: 1px solid #2f456b;
      padding: 7px 8px;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .bubble.user {
      background: rgba(34, 197, 94, 0.14);
    }
    .bubble.assistant {
      background: rgba(59, 130, 246, 0.12);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="title">Blueprint</div>
      <div class="muted">Plan-only feature implementation mode. Scans src/ structure, proposes reusable nodes, new nodes, tests, and risks.</div>
      <textarea id="featureRequest" placeholder="Describe the new feature to implement..."></textarea>
      <div class="row">
        <button id="generateBtn" class="primary">Generate Blueprint</button>
        <button id="openCircuitBtn">Open In Circuit</button>
        <button id="applyBtn">Apply Blueprint</button>
      </div>
      <div id="status" class="status">Ready</div>
    </div>

    <div class="card">
      <div class="title">Implementation Explanation</div>
      <div id="explanationPane">No blueprint generated yet.</div>
      <ul id="nodesList"></ul>
    </div>

    <div class="card" style="flex: 1; min-height: 220px; display: flex; flex-direction: column; gap: 8px;">
      <div class="title">Blueprint Chat</div>
      <div id="chatLog" class="chat-log" style="flex:1;">
        <div class="bubble assistant">Ask follow-up questions about the plan, reuse candidates, file placement, risks, and tests.</div>
      </div>
      <div class="row">
        <textarea id="chatInput" placeholder="Ask about this blueprint..." style="min-height: 52px;"></textarea>
        <button id="askBtn">Ask</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const featureRequest = document.getElementById('featureRequest');
    const generateBtn = document.getElementById('generateBtn');
    const openCircuitBtn = document.getElementById('openCircuitBtn');
    const applyBtn = document.getElementById('applyBtn');
    const statusEl = document.getElementById('status');
    const explanationPane = document.getElementById('explanationPane');
    const nodesList = document.getElementById('nodesList');
    const chatLog = document.getElementById('chatLog');
    const chatInput = document.getElementById('chatInput');
    const askBtn = document.getElementById('askBtn');

    let history = [];
    let isBusy = false;

    function setStatus(text) {
      statusEl.textContent = String(text || '');
    }

    function setBusy(next) {
      isBusy = !!next;
      generateBtn.disabled = isBusy;
      askBtn.disabled = isBusy;
      openCircuitBtn.disabled = isBusy;
      applyBtn.disabled = isBusy;
    }

    function appendChat(role, text) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
      bubble.textContent = String(text || '');
      chatLog.appendChild(bubble);
      chatLog.scrollTop = chatLog.scrollHeight;
      history.push({ role, text: String(text || '') });
    }

    function renderPlan(plan) {
      explanationPane.textContent = plan?.explanation || 'No explanation generated.';
      nodesList.textContent = '';
      const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
      for (const node of nodes) {
        const li = document.createElement('li');
        li.textContent = '[' + String(node.kind || 'node') + '] ' + String(node.label || '') + (node.path ? ' (' + node.path + ')' : '');
        nodesList.appendChild(li);
      }
    }

    generateBtn.addEventListener('click', () => {
      const text = String(featureRequest.value || '').trim();
      if (!text || isBusy) return;
      appendChat('user', text);
      setBusy(true);
      setStatus('Generating blueprint...');
      vscode.postMessage({ type: 'generateBlueprint', featureRequest: text, history });
    });

    askBtn.addEventListener('click', () => {
      const text = String(chatInput.value || '').trim();
      if (!text || isBusy) return;
      chatInput.value = '';
      appendChat('user', text);
      setBusy(true);
      setStatus('Thinking...');
      vscode.postMessage({ type: 'askBlueprint', question: text, history });
    });

    openCircuitBtn.addEventListener('click', () => {
      if (isBusy) return;
      vscode.postMessage({ type: 'openBlueprintCircuit' });
      setStatus('Opening Circuit view for blueprint graph...');
    });

    applyBtn.addEventListener('click', () => {
      if (isBusy) return;
      setBusy(true);
      setStatus('Awaiting apply confirmation...');
      vscode.postMessage({ type: 'applyBlueprint' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'blueprintGenerated') {
        setBusy(false);
        if (msg.error) {
          setStatus('Blueprint generation failed.');
          appendChat('assistant', 'Error: ' + String(msg.error));
          return;
        }
        renderPlan(msg.plan);
        const nodeCount = Array.isArray(msg?.plan?.nodes) ? msg.plan.nodes.length : 0;
        setStatus('Blueprint generated (' + nodeCount + ' nodes).');
        appendChat('assistant', 'Blueprint plan ready. Review implementation explanation, then open in Circuit or ask follow-up questions.');
        return;
      }

      if (msg.type === 'blueprintAnswered') {
        setBusy(false);
        if (msg.error) {
          setStatus('Chat request failed.');
          appendChat('assistant', 'Error: ' + String(msg.error));
          return;
        }
        appendChat('assistant', String(msg.answer || 'No response generated.'));
        setStatus('Response received.');
        return;
      }

      if (msg.type === 'blueprintApplied') {
        setBusy(false);
        const result = msg.result || { approved: false, message: 'Unknown result.' };
        setStatus(String(result.message || 'Done.'));
        appendChat('assistant', String(result.message || 'Done.'));
        return;
      }

      if (msg.type === 'blueprintOpenedCircuit' && msg.error) {
        setStatus('Could not open Circuit view.');
        appendChat('assistant', 'Error: ' + String(msg.error));
      }
    });
  </script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < 32; i++) {
		out += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return out;
}
