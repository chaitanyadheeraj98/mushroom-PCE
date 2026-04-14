import * as vscode from 'vscode';

import { CircuitDetailsPanel, NodeChatRequest } from '../circuit/detailsPanel';
import { buildCodeFlowGraph } from '../circuit/buildCodeFlowGraph';
import { buildCircuitGraphHybrid } from '../circuit/buildGraphHybrid';
import { buildProjectArchitectureGraph } from '../circuit/buildProjectArchitectureGraph';
import { CircuitPanel } from '../circuit/panel';
import { buildGlobalSkeletonGraph } from '../circuit/buildSkeletonGraph';
import { MushroomPanel } from '../panel';
import { ResponseMode } from '../types';

type RegisterCommandsDeps = {
	extensionUri: vscode.Uri;
	output: vscode.OutputChannel;
	getCurrentDocument: () => vscode.TextDocument | undefined;
	getLastEditorColumn: () => vscode.ViewColumn;
	setLastEditorColumn: (column: vscode.ViewColumn) => void;
	loadModels: (panel?: MushroomPanel) => Promise<void>;
	getAvailableModels: () => vscode.LanguageModelChat[];
	getSelectedModelId: () => string | undefined;
	setSelectedModelId: (id: string) => void;
	getSelectedResponseMode: () => ResponseMode;
	setSelectedResponseMode: (mode: ResponseMode) => void;
	applyModeStateToPanel: (panel: MushroomPanel) => void;
	applyModelStateToPanel: (panel: MushroomPanel) => void;
	applySymbolStateToPanel: (panel: MushroomPanel, document: vscode.TextDocument) => void;
	tryRestoreCachedAnalysis: (panel: MushroomPanel) => Promise<boolean>;
	runAnalysis: (panel: MushroomPanel) => Promise<void>;
	askNodeQuestion: (request: NodeChatRequest) => Promise<string>;
};

export function registerPceCommands(deps: RegisterCommandsDeps): vscode.Disposable[] {
	const analyzeCommand = vscode.commands.registerCommand('mushroom-pce.analyzeActive', async () => {
		deps.output.appendLine('mushroom-pce.analyzeActive command triggered');
		const panel = MushroomPanel.getCurrentPanel();
		if (!panel || panel.isDisposed()) {
			vscode.window.showInformationMessage('Run "Start Mushroom PCE" first.');
			deps.output.appendLine('analyzeActive failed: panel missing');
			return;
		}

		await deps.runAnalysis(panel);
	});

	const startCommand = vscode.commands.registerCommand('mushroom-pce.start', async () => {
		const panel = MushroomPanel.createOrShow();

		panel.setStatus('Ready');
		panel.setExplanation('Click Analyze to explain the active file.');
		panel.setLanguageWarning(undefined);
		deps.applyModeStateToPanel(panel);

		const currentDoc = deps.getCurrentDocument();
		if (currentDoc) {
			deps.applySymbolStateToPanel(panel, currentDoc);
		}

		await deps.loadModels(panel);
		deps.output.appendLine('mushroom-pce.start command triggered');
		await vscode.commands.executeCommand('mushroom-pce.analyzeActive');
	});

	const goToFunctionCommand = vscode.commands.registerCommand(
		'mushroom-pce.goToFunction',
		async (uriString?: string, line?: number, character?: number) => {
			try {
				if (typeof uriString !== 'string' || typeof line !== 'number' || typeof character !== 'number') {
					return;
				}

				const targetUri = vscode.Uri.parse(uriString);
				const existingEditor = vscode.window.visibleTextEditors
					.filter((e) => e.document.uri.toString() === targetUri.toString())
					.sort((a, b) => (a.viewColumn ?? 999) - (b.viewColumn ?? 999))[0];
				const document = existingEditor ? existingEditor.document : await vscode.workspace.openTextDocument(targetUri);
				const editor = await vscode.window.showTextDocument(document, {
					viewColumn: existingEditor?.viewColumn ?? deps.getLastEditorColumn() ?? vscode.ViewColumn.One,
					preserveFocus: false,
					preview: true
				});
				const position = new vscode.Position(Math.max(0, line), Math.max(0, character));
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
				if (editor.viewColumn) {
					deps.setLastEditorColumn(editor.viewColumn);
				}
			} catch (error: any) {
				vscode.window.showErrorMessage('Could not navigate to symbol: ' + (error?.message ?? String(error)));
			}
		}
	);

	const selectModelCommand = vscode.commands.registerCommand('mushroom-pce.selectModel', async () => {
		const panel = MushroomPanel.getCurrentPanel();
		await deps.loadModels(panel);

		const availableModels = deps.getAvailableModels();
		const selectedModelId = deps.getSelectedModelId();
		if (!availableModels.length) {
			vscode.window.showErrorMessage('No AI models available to select.');
			return;
		}

		const pickItems = availableModels.map((model) => ({
			label: model.name,
			description: model.id === selectedModelId ? 'Current' : '',
			detail: `${model.vendor} / ${model.family} / ${model.version}`,
			modelId: model.id
		}));

		const picked = await vscode.window.showQuickPick(pickItems, {
			title: 'Mushroom PCE: Select AI Model',
			placeHolder: 'Choose the model used for code explanation'
		});

		if (!picked) {
			return;
		}

		deps.setSelectedModelId(picked.modelId);
		if (panel && !panel.isDisposed()) {
			deps.applyModelStateToPanel(panel);
			await deps.tryRestoreCachedAnalysis(panel);
		}
		vscode.window.showInformationMessage(`Mushroom PCE model set to: ${picked.label}`);
		deps.output.appendLine(`model selected: ${picked.modelId}`);
	});

	const setListModeCommand = vscode.commands.registerCommand('mushroom-pce.setListMode', async () => {
		deps.setSelectedResponseMode('list');
		const panel = MushroomPanel.getCurrentPanel();
		if (panel && !panel.isDisposed()) {
			deps.applyModeStateToPanel(panel);
			await deps.tryRestoreCachedAnalysis(panel);
		}
		vscode.window.showInformationMessage('Mushroom PCE mode set to List Mode');
		deps.output.appendLine('response mode selected: list');
	});

	const setDeveloperModeCommand = vscode.commands.registerCommand('mushroom-pce.setDeveloperMode', async () => {
		deps.setSelectedResponseMode('developer');
		const panel = MushroomPanel.getCurrentPanel();
		if (panel && !panel.isDisposed()) {
			deps.applyModeStateToPanel(panel);
			await deps.tryRestoreCachedAnalysis(panel);
		}
		vscode.window.showInformationMessage('Mushroom PCE mode set to Developer Mode');
		deps.output.appendLine('response mode selected: developer');
	});

	const openCircuitCommand = vscode.commands.registerCommand('mushroom-pce.openCircuit', async () => {
		const doc = deps.getCurrentDocument();
		if (!doc) {
			vscode.window.showInformationMessage('Open a file to visualize in Circuit Mode.');
			return;
		}

		const graph = await buildCircuitGraphHybrid(doc);
		CircuitPanel.createOrShow(
			deps.extensionUri,
			graph,
			async (node) => {
				if (!node?.uri || typeof node.line !== 'number' || typeof node.character !== 'number') {
					return;
				}
				await vscode.commands.executeCommand('mushroom-pce.goToFunction', node.uri, node.line, node.character);
				await CircuitDetailsPanel.createOrShow(node, graph, deps.askNodeQuestion);
			},
			async (node, currentGraph) => buildGlobalSkeletonGraph(node, currentGraph, 3),
			async (scope) => {
				if (scope === 'full-architecture') {
					return buildProjectArchitectureGraph(doc.uri);
				}
				if (scope === 'codeflow') {
					const currentDoc = deps.getCurrentDocument();
					if (!currentDoc) {
						return undefined;
					}
					return buildCodeFlowGraph(currentDoc);
				}
				const currentDoc = deps.getCurrentDocument();
				if (!currentDoc) {
					return undefined;
				}
				return buildCircuitGraphHybrid(currentDoc);
			}
		);
	});

	return [
		startCommand,
		analyzeCommand,
		selectModelCommand,
		setListModeCommand,
		setDeveloperModeCommand,
		goToFunctionCommand,
		openCircuitCommand
	];
}
