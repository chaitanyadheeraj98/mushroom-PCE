import * as vscode from 'vscode';
import * as ts from 'typescript';

import { CircuitEdge, CircuitGraph, CircuitNode } from './types';

export type NodeChatTurn = {
	role: 'user' | 'assistant';
	text: string;
};

export type NodeChatRequest = {
	node: CircuitNode;
	snippet: string;
	question: string;
	history: NodeChatTurn[];
	connectionContext: {
		incoming: string[];
		outgoing: string[];
	};
};

export class CircuitDetailsPanel {
	private static currentPanel: CircuitDetailsPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private onAsk?: (request: NodeChatRequest) => Promise<string>;
	private currentGraph?: CircuitGraph;

	private currentNode: CircuitNode | undefined;
	private currentSnippet = '';
	private chatTurns: NodeChatTurn[] = [];
	private asking = false;

	static async createOrShow(
		node: CircuitNode,
		graph: CircuitGraph,
		onAsk?: (request: NodeChatRequest) => Promise<string>
	): Promise<CircuitDetailsPanel> {
		if (CircuitDetailsPanel.currentPanel) {
			CircuitDetailsPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			CircuitDetailsPanel.currentPanel.currentGraph = graph;
			CircuitDetailsPanel.currentPanel.onAsk = onAsk;
			await CircuitDetailsPanel.currentPanel.setNode(node);
			return CircuitDetailsPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel('mushroomPceCircuitDetails', 'Mushroom PCE: Node Details', vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true
		});

		CircuitDetailsPanel.currentPanel = new CircuitDetailsPanel(panel, graph, onAsk);
		await CircuitDetailsPanel.currentPanel.setNode(node);
		return CircuitDetailsPanel.currentPanel;
	}

	private constructor(panel: vscode.WebviewPanel, graph: CircuitGraph, onAsk?: (request: NodeChatRequest) => Promise<string>) {
		this.panel = panel;
		this.onAsk = onAsk;
		this.currentGraph = graph;
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				if (msg?.type !== 'ask') {
					return;
				}
				await this.handleAsk(String(msg?.question ?? ''));
			},
			null,
			this.disposables
		);
	}

	dispose(): void {
		CircuitDetailsPanel.currentPanel = undefined;
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}

	private async setNode(node: CircuitNode): Promise<void> {
		const nodeChanged = this.currentNode?.id !== node.id;
		this.currentNode = node;
		if (node.id === 'context:bot') {
			this.currentSnippet = await this.getContextBotSnippet(node);
		} else {
			this.currentSnippet = await getSnippet(node);
		}
		if (nodeChanged) {
			this.chatTurns = [];
		}
		this.render();
	}

	private async getContextBotSnippet(node: CircuitNode): Promise<string> {
		const graph = this.currentGraph;
		if (!graph) {
			return '(no graph context available)';
		}
		const incoming = graph.edges.filter((edge) => edge.to === node.id);
		if (!incoming.length) {
			return '(no connected context nodes yet)';
		}
		const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
		const chunks: string[] = [];
		for (const edge of incoming) {
			const source = nodeById.get(edge.from);
			if (!source || source.id === node.id) {
				continue;
			}
			const snippet = await getSnippet(source);
			chunks.push(
				`// Context Node: ${source.label} (${source.type})\n${snippet || '(no snippet available)'}`
			);
		}
		return chunks.length ? chunks.join('\n\n') : '(no connected context snippets found)';
	}

	private async handleAsk(rawQuestion: string): Promise<void> {
		if (this.asking || !this.currentNode) {
			return;
		}

		const question = rawQuestion.trim();
		if (!question) {
			return;
		}

		this.chatTurns.push({ role: 'user', text: question });
		this.asking = true;
		this.render();

		try {
			if (!this.onAsk) {
				this.chatTurns.push({ role: 'assistant', text: 'Chat handler is not configured yet.' });
				return;
			}

			const answer = await this.onAsk({
				node: this.currentNode,
				snippet: this.currentSnippet,
				question,
				history: [...this.chatTurns],
				connectionContext: this.getConnectionContext(this.currentNode)
			});
			this.chatTurns.push({ role: 'assistant', text: answer?.trim() || 'No response generated.' });
		} catch (error: any) {
			this.chatTurns.push({ role: 'assistant', text: `Error: ${error?.message ?? String(error)}` });
		} finally {
			this.asking = false;
			this.render();
		}
	}

	private render(): void {
		if (!this.currentNode) {
			return;
		}
		this.panel.webview.html = renderHtml(this.panel.webview, this.currentNode, this.currentSnippet, this.chatTurns, this.asking);
	}

	private getConnectionContext(node: CircuitNode): { incoming: string[]; outgoing: string[] } {
		const graph = this.currentGraph;
		if (!graph) {
			return { incoming: [], outgoing: [] };
		}

		const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
		const incoming = graph.edges
			.filter((edge) => edge.to === node.id)
			.map((edge) => describeEdge(edge, nodeById, 'in'));
		const outgoing = graph.edges
			.filter((edge) => edge.from === node.id)
			.map((edge) => describeEdge(edge, nodeById, 'out'));
		return { incoming, outgoing };
	}
}

function describeEdge(edge: CircuitEdge, nodeById: Map<string, CircuitNode>, direction: 'in' | 'out'): string {
	const fromNode = nodeById.get(edge.from);
	const toNode = nodeById.get(edge.to);
	const fromLabel = fromNode ? `${fromNode.type}:${fromNode.label}` : edge.from;
	const toLabel = toNode ? `${toNode.type}:${toNode.label}` : edge.to;
	const label = edge.label ? ` (${edge.label})` : '';
	const kind = edge.kind ? ` [${edge.kind}]` : '';
	return direction === 'in'
		? `${fromLabel} -> ${toLabel}${label}${kind}`
		: `${fromLabel} -> ${toLabel}${label}${kind}`;
}

async function getSnippet(node: CircuitNode): Promise<string> {
	try {
		if (!node.uri || typeof node.line !== 'number') {
			return '';
		}

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(node.uri));
		const astSnippet = tryGetAstSnippet(doc, node);
		if (astSnippet) {
			return astSnippet;
		}

		const startLine = Math.max(0, node.line);
		const maxLine = Math.min(doc.lineCount - 1, startLine + 220);

		let blockStart = startLine;
		for (let li = startLine; li <= Math.min(maxLine, startLine + 8); li++) {
			if (doc.lineAt(li).text.includes('{')) {
				blockStart = li;
				break;
			}
		}

		const startText = doc.lineAt(blockStart).text;
		let endLine = startLine;
		if (startText.includes('{')) {
			let depth = 0;
			let started = false;
			for (let li = blockStart; li <= maxLine; li++) {
				const text = doc.lineAt(li).text;
				for (const ch of text) {
					if (ch === '{') {
						depth++;
						started = true;
					} else if (ch === '}') {
						depth--;
						if (started && depth <= 0) {
							endLine = li;
							li = maxLine + 1;
							break;
						}
					}
				}
			}
		}

		const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, doc.lineAt(endLine).text.length));
		return doc.getText(range);
	} catch {
		return '';
	}
}

function tryGetAstSnippet(doc: vscode.TextDocument, node: CircuitNode): string | undefined {
	const code = doc.getText();
	const sourceFile = ts.createSourceFile(doc.fileName, code, ts.ScriptTarget.Latest, true, inferScriptKind(doc.languageId));

	const targetLabel = node.label;
	const dottedParts = targetLabel.split('.');
	const targetClass = dottedParts.length > 1 ? dottedParts.slice(0, -1).join('.') : undefined;
	const targetName = dottedParts[dottedParts.length - 1];

	let found: ts.Node | undefined;
	const visit = (n: ts.Node, className?: string) => {
		if (found) {
			return;
		}

		if (ts.isFunctionDeclaration(n) && n.name?.text === targetLabel) {
			found = n;
			return;
		}

		if (ts.isVariableStatement(n)) {
			for (const d of n.declarationList.declarations) {
				if (!ts.isIdentifier(d.name) || !d.initializer) {
					continue;
				}
				if ((ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && d.name.text === targetLabel) {
					found = n;
					return;
				}
			}
		}

		if (ts.isClassDeclaration(n)) {
			const nextClass = n.name?.text ?? className;
			ts.forEachChild(n, (child) => visit(child, nextClass));
			return;
		}

		if (ts.isMethodDeclaration(n)) {
			const methodName = getMethodName(n.name);
			if (methodName) {
				const full = className ? `${className}.${methodName}` : methodName;
				if (full === targetLabel || (!targetClass && methodName === targetName)) {
					found = n;
					return;
				}
			}
		}

		ts.forEachChild(n, (child) => visit(child, className));
	};

	visit(sourceFile);

	if (!found) {
		return undefined;
	}
	const start = found.getStart(sourceFile);
	const end = found.getEnd();
	return code.slice(start, end);
}

function getMethodName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return undefined;
}

function inferScriptKind(languageId: string): ts.ScriptKind {
	switch ((languageId || '').toLowerCase()) {
		case 'javascript':
		case 'javascriptreact':
			return ts.ScriptKind.JS;
		case 'typescript':
		case 'typescriptreact':
			return ts.ScriptKind.TS;
		case 'json':
			return ts.ScriptKind.JSON;
		default:
			return ts.ScriptKind.Unknown;
	}
}

function renderHtml(webview: vscode.Webview, node: CircuitNode, snippet: string, chatTurns: NodeChatTurn[], asking: boolean): string {
	const nonce = getNonce();
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

	const title = `${node.type}: ${node.label}`;
	const meta = [
		`type: ${node.type}`,
		node.layer ? `layer: ${node.layer}` : '',
		node.detail ? `detail: ${node.detail}` : '',
		typeof node.line === 'number' ? `line: ${node.line + 1}` : ''
	]
		.filter(Boolean)
		.join(' | ');

	const chatHtml = chatTurns.length
		? chatTurns
				.map((turn) => {
					const css = turn.role === 'user' ? 'chat-bubble user' : 'chat-bubble assistant';
					const label = turn.role === 'user' ? 'You' : 'Mushroom AI';
					const messageHtml =
						turn.role === 'assistant'
							? markdownToChatHtml(turn.text)
							: `<div class="msg msg-user">${esc(turn.text)}</div>`;
					return `<div class="${css}"><div class="who">${label}</div>${messageHtml}</div>`;
				})
				.join('')
		: '<div class="chat-empty">Ask anything about this node, logic, edge-cases, or improvements.</div>';

	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root { --bg:#0b1020; --panel:#0f172a; --text:#e2e8f0; --muted:#9fb0cc; --border:#21304d; --code:#0b1225; --accent:#22c55e; }
    body { margin:0; padding:16px; background: radial-gradient(circle at top right, #1e293b, var(--bg) 55%); color:var(--text); font-family: Segoe UI, Tahoma, sans-serif; }
    h1 { font-size:16px; margin:0 0 6px; }
    .meta { color: var(--muted); font-size:12px; margin-bottom: 12px; }
    pre { background: var(--code); border:1px solid var(--border); border-radius:10px; padding:12px; overflow:auto; max-height: 260px; }
    code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
    .chat-wrap { margin-top: 14px; border:1px solid var(--border); border-radius: 10px; background: color-mix(in oklab, var(--panel) 96%, black); }
    .chat-head { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); }
    .chat-log { padding: 10px; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
    .chat-bubble { border-radius: 10px; padding: 8px 10px; border:1px solid var(--border); }
    .chat-bubble.user { align-self: flex-end; background: rgba(34,197,94,0.17); max-width: 86%; }
    .chat-bubble.assistant { align-self: flex-start; background: rgba(59,130,246,0.13); max-width: 92%; }
    .who { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
    .msg-user { white-space: pre-wrap; line-height: 1.45; font-size: 13px; }
    .msg-markdown { line-height: 1.52; font-size: 13px; }
    .msg-markdown p { margin: 6px 0; }
    .msg-markdown ul, .msg-markdown ol { margin: 6px 0 6px 18px; padding: 0; }
    .msg-markdown li { margin: 3px 0; }
    .msg-markdown h1, .msg-markdown h2, .msg-markdown h3, .msg-markdown h4 {
      margin: 8px 0 6px;
      color: #f1f5f9;
      line-height: 1.3;
    }
    .msg-markdown h1 { font-size: 16px; }
    .msg-markdown h2 { font-size: 15px; }
    .msg-markdown h3, .msg-markdown h4 { font-size: 14px; }
    .msg-markdown code {
      background: #0b1225;
      border: 1px solid #21304d;
      border-radius: 6px;
      padding: 1px 5px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 12px;
    }
    .msg-markdown pre {
      background: #0b1225;
      border: 1px solid #21304d;
      border-radius: 8px;
      padding: 8px;
      overflow: auto;
      margin: 8px 0;
    }
    .msg-markdown pre code {
      background: transparent;
      border: none;
      border-radius: 0;
      padding: 0;
    }
    .msg-markdown strong { color: #f8fafc; }
    .chat-empty { color: var(--muted); font-size: 12px; }
    .ask-row { display: flex; gap: 8px; padding: 10px; border-top:1px solid var(--border); }
    textarea { flex:1; resize: vertical; min-height: 56px; max-height: 120px; border-radius: 8px; border:1px solid var(--border); background: #0b1225; color: var(--text); padding: 8px; font-family: Segoe UI, Tahoma, sans-serif; font-size: 13px; }
    button { border:none; border-radius: 8px; padding: 10px 12px; background: #16a34a; color: #fff; font-weight: 600; cursor: pointer; align-self: flex-end; }
    button:disabled { background: #334155; cursor: default; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(meta)}</div>
  <pre><code>${esc(snippet || '(no snippet available)')}</code></pre>
  <div class="chat-wrap">
    <div class="chat-head">Node Chat (uses selected model from Mushroom PCE)</div>
    <div id="chatLog" class="chat-log">${chatHtml}</div>
    <div class="ask-row">
      <textarea id="question" placeholder="Ask about this node's logic, bugs, edge cases, improvements..." ${asking ? 'disabled' : ''}></textarea>
      <button id="askBtn" ${asking ? 'disabled' : ''}>${asking ? 'Thinking...' : 'Ask'}</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const askBtn = document.getElementById('askBtn');
    const question = document.getElementById('question');
    const chatLog = document.getElementById('chatLog');
    const submit = () => {
      const text = String(question.value || '').trim();
      if (!text) return;
      vscode.postMessage({ type: 'ask', question: text });
    };
    askBtn?.addEventListener('click', submit);
    question?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    if (chatLog) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  </script>
</body>
</html>`;
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function markdownToChatHtml(markdown: string): string {
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

	const inline = (text: string): string => {
		let result = esc(text);
		result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
		return result;
	};

	const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let inCode = false;
	let listMode: '' | 'ul' | 'ol' = '';

	const closeList = () => {
		if (listMode === 'ul') {
			out.push('</ul>');
		} else if (listMode === 'ol') {
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
			out.push(`${esc(rawLine)}\n`);
			continue;
		}
		if (!line) {
			closeList();
			continue;
		}

		if (line.startsWith('#### ')) {
			closeList();
			out.push(`<h4>${inline(line.slice(5))}</h4>`);
			continue;
		}
		if (line.startsWith('### ')) {
			closeList();
			out.push(`<h3>${inline(line.slice(4))}</h3>`);
			continue;
		}
		if (line.startsWith('## ')) {
			closeList();
			out.push(`<h2>${inline(line.slice(3))}</h2>`);
			continue;
		}
		if (line.startsWith('# ')) {
			closeList();
			out.push(`<h1>${inline(line.slice(2))}</h1>`);
			continue;
		}
		if (/^[-*]\s+/.test(line)) {
			if (listMode !== 'ul') {
				closeList();
				out.push('<ul>');
				listMode = 'ul';
			}
			out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
			continue;
		}
		if (/^\d+\.\s+/.test(line)) {
			if (listMode !== 'ol') {
				closeList();
				out.push('<ol>');
				listMode = 'ol';
			}
			out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
			continue;
		}

		closeList();
		out.push(`<p>${inline(line)}</p>`);
	}

	closeList();
	return `<div class="msg msg-markdown">${out.join('') || '<p>No response generated.</p>'}</div>`;
}
