import * as vscode from 'vscode';

import { CircuitEdge, CircuitGraph, CircuitNode } from '../../shared/types/circuitTypes';
import { NormalizedDocumentSymbol, getNormalizedDocumentSymbols } from '../../services/symbols/documentSymbols';

const FILE_SNIPPET_MAX_LINES = 400;
const FILE_SNIPPET_MAX_CHARS = 24000;

export type NodeChatTurn = {
	role: 'user' | 'assistant';
	text: string;
};

export type NodeChatRequest = {
	node: CircuitNode;
	snippet: string;
	developerAnalysis?: string;
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
		node: CircuitNode | undefined,
		graph: CircuitGraph,
		onAsk?: (request: NodeChatRequest) => Promise<string>
	): Promise<CircuitDetailsPanel> {
		const currentPanel = CircuitDetailsPanel.currentPanel;
		if (currentPanel) {
			// Treat Node Details like an inspector: update content without moving the user's chosen editor group.
			currentPanel.currentGraph = graph;
			currentPanel.onAsk = onAsk;
			if (node) {
				await currentPanel.setNode(node);
			}
			return currentPanel;
		}

		const panel = vscode.window.createWebviewPanel('mushroomPceCircuitDetails', 'Mushroom PCE: Node Details', vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true
		});

		CircuitDetailsPanel.currentPanel = new CircuitDetailsPanel(panel, graph, onAsk);
		await CircuitDetailsPanel.currentPanel.setNode(node);
		return CircuitDetailsPanel.currentPanel;
	}

	static async syncGraph(graph: CircuitGraph): Promise<void> {
		if (!CircuitDetailsPanel.currentPanel) {
			return;
		}
		CircuitDetailsPanel.currentPanel.currentGraph = graph;
		await CircuitDetailsPanel.currentPanel.refreshForGraphChange();
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
		this.render();
	}

	dispose(): void {
		CircuitDetailsPanel.currentPanel = undefined;
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}

	private async setNode(node: CircuitNode | undefined): Promise<void> {
		if (!node) {
			// Ignore stale/invalid selections so the existing inspector content does not go blank.
			return;
		}
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

	private async refreshForGraphChange(): Promise<void> {
		if (!this.currentNode) {
			return;
		}
		// Live-refresh Context Bot snippet when connections change.
		if (this.currentNode.id === 'context:bot') {
			this.currentSnippet = await this.getContextBotSnippet(this.currentNode);
			this.render();
		}
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
		this.panel.webview.html = this.currentNode
			? renderHtml(this.currentNode, this.currentSnippet, this.chatTurns, this.asking)
			: renderEmptyHtml();
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
		if (!node.uri) {
			return '';
		}

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(node.uri));
		if (typeof node.line !== 'number') {
			return getFileSnippet(doc);
		}
		if (isImportsNode(node)) {
			const importsSnippet = getImportsBlockSnippet(doc, Math.max(0, node.line));
			if (importsSnippet) {
				return importsSnippet;
			}
		}

		const symbolSnippet = await tryGetSymbolSnippet(doc, node);
		if (symbolSnippet) {
			return symbolSnippet;
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
			let foundEnd = false;
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
							foundEnd = true;
							li = maxLine + 1;
							break;
						}
					}
				}
			}
			if (!foundEnd) {
				endLine = maxLine;
			}
		}

		const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, doc.lineAt(endLine).text.length));
		return doc.getText(range);
	} catch {
		return '';
	}
}

function isImportsNode(node: CircuitNode): boolean {
	const label = String(node.label || '').toLowerCase();
	const detail = String(node.detail || '').toLowerCase();
	return label === 'imports' || detail.includes('codeflow | imports');
}

function getImportsBlockSnippet(doc: vscode.TextDocument, startLine: number): string {
	const importLikeLine = (line: string): boolean => {
		const t = line.trim();
		if (!t) {
			return false;
		}
		return (
			t.startsWith('import ') ||
			t.startsWith('import\t') ||
			t.startsWith('export * from ') ||
			t.startsWith('export {') ||
			t.startsWith('const ') && t.includes('require(')
		);
	};

	let firstImport = -1;
	for (let li = startLine; li < doc.lineCount; li++) {
		const text = doc.lineAt(li).text;
		if (!text.trim()) {
			continue;
		}
		if (importLikeLine(text)) {
			firstImport = li;
		}
		break;
	}
	if (firstImport < 0) {
		return '';
	}

	let endLine = firstImport;
	let seenImport = false;
	let blankRun = 0;
	for (let li = firstImport; li < doc.lineCount; li++) {
		const text = doc.lineAt(li).text;
		const trimmed = text.trim();
		if (!trimmed) {
			if (seenImport) {
				blankRun++;
				// allow single blank separator inside import block
				if (blankRun > 1) {
					break;
				}
				endLine = li;
			}
			continue;
		}
		blankRun = 0;
		if (importLikeLine(text)) {
			seenImport = true;
			endLine = li;
			continue;
		}
		break;
	}

	const range = new vscode.Range(new vscode.Position(firstImport, 0), new vscode.Position(endLine, doc.lineAt(endLine).text.length));
	return doc.getText(range).trimEnd();
}

function getFileSnippet(doc: vscode.TextDocument): string {
	const totalLines = doc.lineCount;
	const cappedEndLine = Math.max(0, Math.min(totalLines, FILE_SNIPPET_MAX_LINES));
	const fullRange = new vscode.Range(
		new vscode.Position(0, 0),
		new vscode.Position(Math.max(0, cappedEndLine - 1), doc.lineAt(Math.max(0, cappedEndLine - 1)).text.length)
	);
	let snippet = doc.getText(fullRange);
	let wasTruncated = totalLines > FILE_SNIPPET_MAX_LINES;

	if (snippet.length > FILE_SNIPPET_MAX_CHARS) {
		snippet = snippet.slice(0, FILE_SNIPPET_MAX_CHARS);
		wasTruncated = true;
	}

	if (wasTruncated) {
		const shownLines = Math.min(totalLines, FILE_SNIPPET_MAX_LINES);
		snippet += `\n\n...truncated... showing first ${shownLines} lines (${Math.min(
			FILE_SNIPPET_MAX_CHARS,
			snippet.length
		)} chars)`;
	}

	return snippet;
}

async function tryGetSymbolSnippet(doc: vscode.TextDocument, node: CircuitNode): Promise<string | undefined> {
	const symbols = await getNormalizedDocumentSymbols(doc.uri);
	if (!symbols.length) {
		return undefined;
	}

	const targetLabel = String(node.label || '').trim();
	if (!targetLabel) {
		return undefined;
	}

	const dotted = targetLabel.split('.');
	const targetName = dotted[dotted.length - 1];
	const targetContainer = dotted.length > 1 ? dotted.slice(0, -1).join('.') : '';

	let best: { symbol: NormalizedDocumentSymbol; score: number } | undefined;
	for (const symbol of symbols) {
		const score = scoreSymbolMatch(symbol, targetLabel, targetName, targetContainer, node.line);
		if (score <= 0) {
			continue;
		}
		if (!best || score > best.score) {
			best = { symbol, score };
		}
	}

	if (!best) {
		return undefined;
	}

	const startLine = Math.max(0, best.symbol.range.start.line);
	const endLine = Math.min(doc.lineCount - 1, best.symbol.range.end.line);
	const range = new vscode.Range(
		new vscode.Position(startLine, 0),
		new vscode.Position(endLine, doc.lineAt(endLine).text.length)
	);
	const snippet = doc.getText(range).trimEnd();
	return snippet || undefined;
}

function scoreSymbolMatch(
	symbol: NormalizedDocumentSymbol,
	targetLabel: string,
	targetName: string,
	targetContainer: string,
	targetLine: number | undefined
): number {
	let score = 0;
	if (symbol.fullName === targetLabel) {
		score += 120;
	}
	if (symbol.name === targetLabel) {
		score += 110;
	}
	if (symbol.name === targetName) {
		score += 80;
	}

	if (targetContainer) {
		if (symbol.fullName.endsWith(`.${targetName}`) && symbol.fullName.includes(targetContainer)) {
			score += 45;
		}
	} else if (!symbol.fullName.includes('.') && symbol.name === targetName) {
		score += 20;
	}

	if (typeof targetLine === 'number') {
		const distance = Math.abs(symbol.selectionRange.start.line - targetLine);
		score += Math.max(0, 40 - distance);
		if (distance === 0) {
			score += 30;
		}
	}

	return score;
}

function renderHtml(node: CircuitNode, snippet: string, chatTurns: NodeChatTurn[], asking: boolean): string {
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
    .copy-wrap { position: relative; }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0b1225;
      color: #e2e8f0;
      font-size: 13px;
      font-weight: 700;
      width: 28px;
      height: 24px;
      padding: 0;
      cursor: pointer;
      z-index: 2;
    }
    .copy-btn:hover { border-color: #64748b; background: #0f172a; }
    .chat-wrap { margin-top: 14px; border:1px solid var(--border); border-radius: 10px; background: color-mix(in oklab, var(--panel) 96%, black); }
    .chat-head { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); }
    .chat-log { padding: 10px; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
    .chat-bubble { border-radius: 10px; padding: 8px 10px; border:1px solid var(--border); }
    .chat-bubble.user { align-self: flex-end; background: rgba(34,197,94,0.17); max-width: 86%; }
    .chat-bubble.assistant { align-self: flex-start; background: rgba(59,130,246,0.13); max-width: 92%; }
    .assistant-toolbar { display: flex; justify-content: flex-end; margin-bottom: 6px; }
    .copy-msg-btn {
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0b1225;
      color: #e2e8f0;
      font-size: 13px;
      font-weight: 700;
      width: 28px;
      height: 22px;
      padding: 0;
      cursor: pointer;
      align-self: auto;
    }
    .copy-msg-btn:hover { border-color: #64748b; background: #0f172a; }
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
    .ask-btn { border:none; border-radius: 8px; padding: 10px 12px; background: #16a34a; color: #fff; font-weight: 600; cursor: pointer; align-self: flex-end; }
    .ask-btn:disabled { background: #334155; cursor: default; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(meta)}</div>
  <div class="copy-wrap">
    <button class="copy-btn" id="copySnippetBtn" type="button" title="Copy snippet" aria-label="Copy snippet">⧉</button>
    <pre id="nodeSnippet"><code>${esc(snippet || '(no snippet available)')}</code></pre>
  </div>
  <div class="chat-wrap">
    <div class="chat-head">Node Chat (uses selected model from Mushroom PCE)</div>
    <div id="chatLog" class="chat-log">${chatHtml}</div>
    <div class="ask-row">
      <textarea id="question" placeholder="Ask about this node's logic, bugs, edge cases, improvements..." ${asking ? 'disabled' : ''}></textarea>
      <button id="askBtn" class="ask-btn" ${asking ? 'disabled' : ''}>${asking ? 'Thinking...' : 'Ask'}</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const askBtn = document.getElementById('askBtn');
    const question = document.getElementById('question');
    const chatLog = document.getElementById('chatLog');
    const copySnippetBtn = document.getElementById('copySnippetBtn');
    const nodeSnippet = document.getElementById('nodeSnippet');

    const copyText = async (text) => {
      const value = String(text || '');
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch (_) {}
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.focus();
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return !!ok;
      } catch (_) {
        return false;
      }
    };

    const flashButton = (btn, okLabel = '✓') => {
      if (!btn) return;
      const prev = btn.textContent;
      btn.textContent = okLabel;
      setTimeout(() => {
        btn.textContent = prev;
      }, 1000);
    };

    copySnippetBtn?.addEventListener('click', async () => {
      const text = nodeSnippet?.innerText || '';
      const ok = await copyText(text);
      flashButton(copySnippetBtn, ok ? '✓' : '!');
    });

    const attachAssistantCopyButtons = () => {
      document.querySelectorAll('.chat-bubble.assistant').forEach((bubble) => {
        if (bubble.querySelector('.assistant-toolbar')) return;
        const toolbar = document.createElement('div');
        toolbar.className = 'assistant-toolbar';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copy-msg-btn';
        btn.textContent = '⧉';
        btn.title = 'Copy answer';
        btn.setAttribute('aria-label', 'Copy answer');
        btn.addEventListener('click', async () => {
          const text = bubble.querySelector('.msg-markdown')?.innerText || bubble.innerText || '';
          const ok = await copyText(text);
          flashButton(btn, ok ? '✓' : '!');
        });
        toolbar.appendChild(btn);
        bubble.insertBefore(toolbar, bubble.firstChild);
      });
    };

    const attachCodeBlockCopyButtons = () => {
      document.querySelectorAll('.msg-markdown pre').forEach((pre) => {
        if (pre.parentElement?.classList.contains('copy-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'copy-wrap';
        pre.parentNode?.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copy-btn';
        btn.textContent = '⧉';
        btn.title = 'Copy code';
        btn.setAttribute('aria-label', 'Copy code');
        btn.addEventListener('click', async () => {
          const text = pre.querySelector('code')?.innerText || pre.innerText || '';
          const ok = await copyText(text);
          flashButton(btn, ok ? '✓' : '!');
        });
        wrap.appendChild(btn);
      });
    };
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
    attachAssistantCopyButtons();
    attachCodeBlockCopyButtons();
  </script>
</body>
</html>`;
}

function renderEmptyHtml(): string {
	const nonce = getNonce();
	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mushroom PCE: Node Details</title>
  <style>
    body {
      margin: 0;
      padding: 16px;
      background: radial-gradient(circle at top right, #1e293b, #0b1020 55%);
      color: #e2e8f0;
      font-family: Segoe UI, Tahoma, sans-serif;
    }
    .card {
      border: 1px solid #21304d;
      background: #0f172a;
      border-radius: 12px;
      padding: 14px;
      color: #9fb0cc;
      font-size: 13px;
      line-height: 1.5;
    }
    .title {
      color: #f8fafc;
      font-weight: 700;
      margin-bottom: 6px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">Node Details</div>
    <div>Select a valid node in Circuit Mode to view its code snippet and chat context.</div>
  </div>
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
