import * as vscode from 'vscode';

import { CircuitDetailsPanel, NodeChatRequest } from '../controllers/circuit/CircuitDetailsPanelController';
import { buildCodeFlowGraph } from '../services/circuit/buildCodeFlowGraph';
import { buildCircuitGraphHybrid } from '../services/circuit/buildGraphHybrid';
import { buildProjectArchitectureGraph } from '../services/circuit/buildProjectArchitectureGraph';
import { BlueprintPanel } from '../controllers/blueprint/BlueprintPanelController';
import { CircuitPanel } from '../controllers/circuit/CircuitPanelController';
import { buildGlobalSkeletonGraph } from '../services/circuit/buildSkeletonGraph';
import { enrichCircuitGraphWithGraphifyContext } from '../services/circuit/graphifyCircuitContext';
import { MushroomPanel } from '../controllers/mushroom/MushroomPanelController';
import { ResponseMode } from '../shared/types/appTypes';
import { CircuitAiEnrichmentResult, CircuitGraph } from '../shared/types/circuitTypes';

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
	getGraphifyContextEnabled: () => boolean;
	setGraphifyContextEnabled: (enabled: boolean) => void;
	applyGraphifyStateToPanel: (panel: MushroomPanel) => void;
	applyModelStateToPanel: (panel: MushroomPanel) => void;
	applySymbolStateToPanel: (panel: MushroomPanel, document: vscode.TextDocument) => Promise<void>;
	tryRestoreCachedAnalysis: (panel: MushroomPanel) => Promise<boolean>;
	runAnalysis: (panel: MushroomPanel) => Promise<void>;
	askNodeQuestion: (request: NodeChatRequest) => Promise<string>;
	requestCircuitAiEnrichment: (
		graph: CircuitGraph,
		scope?: 'current-file' | 'full-architecture' | 'codeflow'
	) => Promise<CircuitAiEnrichmentResult | undefined>;
	requestCircuitRelationExplain: (
		graph: CircuitGraph,
		options: { fromNodeId?: string; toNodeId?: string; userPrompt?: string; extraContextText?: string }
	) => Promise<string | undefined>;
	openBlueprintPanel: () => Promise<void>;
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
		deps.applyGraphifyStateToPanel(panel);

		const currentDoc = deps.getCurrentDocument();
		if (currentDoc) {
			await deps.applySymbolStateToPanel(panel, currentDoc);
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

	const setDefinitionModeCommand = vscode.commands.registerCommand('mushroom-pce.setDefinitionMode', async () => {
		deps.setSelectedResponseMode('definition');
		const panel = MushroomPanel.getCurrentPanel();
		if (panel && !panel.isDisposed()) {
			deps.applyModeStateToPanel(panel);
			await deps.tryRestoreCachedAnalysis(panel);
		}
		vscode.window.showInformationMessage('Mushroom PCE mode set to Definition Mode');
		deps.output.appendLine('response mode selected: definition');
	});

	const toggleGraphifyContextCommand = vscode.commands.registerCommand(
		'mushroom-pce.toggleGraphifyContext',
		async () => {
			const next = !deps.getGraphifyContextEnabled();
			deps.setGraphifyContextEnabled(next);
			const panel = MushroomPanel.getCurrentPanel();
			if (panel && !panel.isDisposed()) {
				deps.applyGraphifyStateToPanel(panel);
				await deps.tryRestoreCachedAnalysis(panel);
			}
			CircuitPanel.setGraphifyContextEnabled(next);
			CircuitDetailsPanel.setGraphifyContextEnabled(next);
			BlueprintPanel.setGraphifyContextEnabled(next);
			vscode.window.showInformationMessage(
				`Mushroom PCE Graphify context ${next ? 'enabled' : 'disabled'}.`
			);
			deps.output.appendLine(`graphify context toggle: ${next ? 'on' : 'off'}`);
		}
	);

	const openCircuitCommand = vscode.commands.registerCommand('mushroom-pce.openCircuit', async () => {
		const doc = deps.getCurrentDocument();
		if (!doc) {
			vscode.window.showInformationMessage('Open a file to visualize in Circuit Mode.');
			return;
		}

		const baseGraph = await buildCircuitGraphHybrid(doc);
		const graph = deps.getGraphifyContextEnabled()
			? await enrichCircuitGraphWithGraphifyContext(baseGraph, {
				scope: 'current-file',
				document: doc,
				output: deps.output
			})
			: baseGraph;
		CircuitPanel.createOrShow(
			deps.extensionUri,
			graph,
			async (node, currentGraph) => {
				if (node?.uri && typeof node.line === 'number' && typeof node.character === 'number') {
					await vscode.commands.executeCommand('mushroom-pce.goToFunction', node.uri, node.line, node.character);
				}
				await CircuitDetailsPanel.createOrShow(node, currentGraph, deps.askNodeQuestion, {
					graphifyContextEnabled: deps.getGraphifyContextEnabled()
				});
			},
			async (node, currentGraph) => buildGlobalSkeletonGraph(node, currentGraph, 3),
			async (scope, _currentGraph, options) => {
				const currentDoc = deps.getCurrentDocument();
				if (!currentDoc) {
					return undefined;
				}
				let nextGraph: CircuitGraph | undefined;
				if (scope === 'full-architecture') {
					nextGraph = await buildProjectArchitectureGraph(currentDoc, {
						dependencyMode: options?.dependencyMode === 'imports-calls' ? 'imports-calls' : 'imports'
					});
				} else if (scope === 'codeflow') {
					nextGraph = buildCodeFlowGraph(currentDoc);
				} else {
					nextGraph = await buildCircuitGraphHybrid(currentDoc);
				}
				if (!nextGraph) {
					return undefined;
				}
				if (!deps.getGraphifyContextEnabled()) {
					return nextGraph;
				}
				return enrichCircuitGraphWithGraphifyContext(nextGraph, {
					scope,
					document: currentDoc,
					output: deps.output
				});
			},
			async (currentGraph, scope) => {
				return deps.requestCircuitAiEnrichment(currentGraph, scope);
			},
			async (currentGraph, options) => {
				return deps.requestCircuitRelationExplain(currentGraph, options);
			},
			{
				initialGraphifyContextEnabled: deps.getGraphifyContextEnabled()
			}
		);
	});

	const openBlueprintCommand = vscode.commands.registerCommand('mushroom-pce.openBlueprint', async () => {
		await deps.openBlueprintPanel();
	});

	return [
		startCommand,
		analyzeCommand,
		selectModelCommand,
		setListModeCommand,
		setDeveloperModeCommand,
		setDefinitionModeCommand,
		toggleGraphifyContextCommand,
		goToFunctionCommand,
		openCircuitCommand,
		openBlueprintCommand
	];
}

