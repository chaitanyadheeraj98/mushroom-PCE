import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('mushroom-pce.start', async () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			vscode.window.showErrorMessage('Please open a file to analyze.');
			return;
		}

		const code = editor.document.getText();
		const panel = MushroomPanel.createOrShow(context.extensionUri);

		panel.clear();
		panel.setStatus('Analyzing your file...');

		let streamed = false;
		const explanation = await explainCode(code, (chunk) => {
			streamed = true;
			panel.appendChunk(chunk);
		});

		if (!streamed) {
			panel.setExplanation(explanation || 'No explanation generated.');
		}

		panel.setStatus('Done');
	});

	context.subscriptions.push(disposable);
}

async function explainCode(code: string, onChunk?: (chunk: string) => void): Promise<string | undefined> {
	try {
		const models = await vscode.lm.selectChatModels();

		if (!models.length) {
			vscode.window.showErrorMessage('No AI model available.');
			return;
		}

		const model = models[0];

		const messages = [
			new vscode.LanguageModelChatMessage(
				vscode.LanguageModelChatMessageRole.User,
				`
You are a friendly programming teacher.

Explain this code in simple terms.

Break it into:
1. Functions
2. Variables
3. Imports
4. Step-by-step explanation
5. Story explanation

Code:
${code}
				`
			)
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

	static createOrShow(extensionUri: vscode.Uri): MushroomPanel {
		if (MushroomPanel.currentPanel) {
			MushroomPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			return MushroomPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel(
			'mushroomPcePanel',
			'Mushroom PCE',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		MushroomPanel.currentPanel = new MushroomPanel(panel, extensionUri);
		return MushroomPanel.currentPanel;
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel;
		this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri);
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	dispose(): void {
		MushroomPanel.currentPanel = undefined;
		while (this.disposables.length) {
			const item = this.disposables.pop();
			item?.dispose();
		}
	}

	clear(): void {
		this.postMessage({ type: 'clear' });
	}

	appendChunk(chunk: string): void {
		this.postMessage({ type: 'append', value: chunk });
	}

	setExplanation(text: string): void {
		this.postMessage({ type: 'set', value: text });
	}

	setStatus(text: string): void {
		this.postMessage({ type: 'status', value: text });
	}

	private postMessage(message: { type: string; value?: string }): void {
		void this.panel.webview.postMessage(message);
	}

	private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
		const nonce = getNonce();
		const cspSource = webview.cspSource;
		const _styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src'));

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mushroom PCE</title>
  <style>
    :root {
      --bg: #0f172a;
      --panel: #111827;
      --text: #e5e7eb;
      --muted: #94a3b8;
      --accent: #22c55e;
      --border: #1f2937;
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
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .status {
      color: var(--muted);
      font-size: 12px;
    }
    .content {
      flex: 1;
      overflow-y: auto;
      background: color-mix(in oklab, var(--panel) 92%, black);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      display: inline-block;
      margin-right: 6px;
      background: var(--accent);
      box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 65%, white);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="title"><span class="dot"></span>Mushroom PCE</div>
      <div class="status" id="status">Ready</div>
    </div>
    <div class="content" id="content">Run "Start Mushroom PCE" to analyze the active file.</div>
    <div class="hint">Beginner-friendly code explanations appear here with live streaming.</div>
  </div>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const content = document.getElementById('content');
    const status = document.getElementById('status');

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) return;

      if (message.type === 'clear') {
        content.textContent = '';
        return;
      }

      if (message.type === 'append') {
        content.textContent += message.value || '';
        content.scrollTop = content.scrollHeight;
        return;
      }

      if (message.type === 'set') {
        content.textContent = message.value || '';
        return;
      }

      if (message.type === 'status') {
        status.textContent = message.value || '';
      }
    });

    vscodeApi.setState({ ready: true });
  </script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
