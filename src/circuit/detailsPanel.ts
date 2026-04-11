import * as vscode from 'vscode';
import * as ts from 'typescript';

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
		const astSnippet = tryGetAstSnippet(doc, node);
		if (astSnippet) {
			return astSnippet;
		}

		const startLine = Math.max(0, node.line);
		const maxLine = Math.min(doc.lineCount - 1, startLine + 220);

		// Best-effort fallback: expand to block end.
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

function renderHtml(node: CircuitNode, snippet: string): string {
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

