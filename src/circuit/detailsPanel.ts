import * as vscode from 'vscode';

import { CircuitNode } from './types';

export class CircuitDetailsPanel {
	private static currentPanel: CircuitDetailsPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];

	static async createOrShow(node: CircuitNode): Promise<CircuitDetailsPanel> {
		if (CircuitDetailsPanel.currentPanel) {
			CircuitDetailsPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			await CircuitDetailsPanel.currentPanel.setNode(node);
			return CircuitDetailsPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel('mushroomPceCircuitDetails', 'Mushroom PCE: Node Details', vscode.ViewColumn.Beside, {
			enableScripts: false,
			retainContextWhenHidden: true
		});

		CircuitDetailsPanel.currentPanel = new CircuitDetailsPanel(panel);
		await CircuitDetailsPanel.currentPanel.setNode(node);
		return CircuitDetailsPanel.currentPanel;
	}

	private constructor(panel: vscode.WebviewPanel) {
		this.panel = panel;
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	dispose(): void {
		CircuitDetailsPanel.currentPanel = undefined;
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}

	private async setNode(node: CircuitNode): Promise<void> {
		const snippet = await getSnippet(node);
		this.panel.webview.html = renderHtml(node, snippet);
	}
}

async function getSnippet(node: CircuitNode): Promise<string> {
	try {
		if (!node.uri || typeof node.line !== 'number') {
			return '';
		}

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(node.uri));
		const startLine = Math.max(0, node.line);
		const maxLine = Math.min(doc.lineCount - 1, startLine + 120);

		// Best-effort: expand to block end if the line seems to start a block.
		const startText = doc.lineAt(startLine).text;
		let endLine = startLine;
		if (startText.includes('{')) {
			let depth = 0;
			let started = false;
			for (let li = startLine; li <= maxLine; li++) {
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

function renderHtml(node: CircuitNode, snippet: string): string {
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

	const title = `${node.type}: ${node.label}`;
	const meta = [
		`type: ${node.type}`,
		node.detail ? `detail: ${node.detail}` : '',
		typeof node.line === 'number' ? `line: ${node.line + 1}` : ''
	]
		.filter(Boolean)
		.join(' | ');

	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root { --bg:#0b1020; --panel:#0f172a; --text:#e2e8f0; --muted:#9fb0cc; --border:#21304d; --code:#0b1225; }
    body { margin:0; padding:16px; background: radial-gradient(circle at top right, #1e293b, var(--bg) 55%); color:var(--text); font-family: Segoe UI, Tahoma, sans-serif; }
    h1 { font-size:16px; margin:0 0 6px; }
    .meta { color: var(--muted); font-size:12px; margin-bottom: 12px; }
    pre { background: var(--code); border:1px solid var(--border); border-radius:10px; padding:12px; overflow:auto; }
    code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(meta)}</div>
  <pre><code>${esc(snippet || '(no snippet available)')}</code></pre>
</body>
</html>`;
}

