import * as vscode from 'vscode';

import { CircuitDetailsPanel } from './CircuitDetailsPanelController';
import { CircuitAiEnrichmentResult, CircuitGraph, CircuitNode } from '../../shared/types/circuitTypes';
import { buildCircuitPanelHtml } from '../../views/circuit/circuitWebview';
import {
	buildChatTranscriptMarkdown,
	exportChatMarkdownFile,
	readChatMarkdownFile
} from '../../services/chat/chatSessionMarkdown';

export class CircuitPanel {
	private static currentPanel: CircuitPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly onNavigate?: (node: CircuitNode, graph: CircuitGraph) => Promise<void>;
	private readonly onBuildSkeletonGraph?: (node: CircuitNode, graph: CircuitGraph) => Promise<CircuitGraph | undefined>;
	private readonly onRequestGraph?: (
		scope: 'current-file' | 'full-architecture' | 'codeflow',
		currentGraph: CircuitGraph,
		options?: { dependencyMode?: 'imports' | 'imports-calls' }
	) => Promise<CircuitGraph | undefined>;
	private readonly onRequestAiEnrichment?: (
		currentGraph: CircuitGraph,
		scope?: 'current-file' | 'full-architecture' | 'codeflow'
	) => Promise<CircuitAiEnrichmentResult | undefined>;
	private readonly onRequestAiRelationExplain?: (
		currentGraph: CircuitGraph,
		options: { fromNodeId?: string; toNodeId?: string; userPrompt?: string; extraContextText?: string }
	) => Promise<string | undefined>;
	private graph: CircuitGraph;
	private graphifyContextEnabled = false;
	private readonly isPrimaryPanel: boolean;
	private lastUnresolvedNodeId?: string;
	private relationChatExtraContextText = '';
	private readonly relationExportCursorByFile = new Map<string, number>();

	static createOrShow(
		extensionUri: vscode.Uri,
		graph: CircuitGraph,
		onNavigate?: (node: CircuitNode, graph: CircuitGraph) => Promise<void>,
		onBuildSkeletonGraph?: (node: CircuitNode, graph: CircuitGraph) => Promise<CircuitGraph | undefined>,
		onRequestGraph?: (
			scope: 'current-file' | 'full-architecture' | 'codeflow',
			currentGraph: CircuitGraph,
			options?: { dependencyMode?: 'imports' | 'imports-calls' }
		) => Promise<CircuitGraph | undefined>,
		onRequestAiEnrichment?: (
			currentGraph: CircuitGraph,
			scope?: 'current-file' | 'full-architecture' | 'codeflow'
		) => Promise<CircuitAiEnrichmentResult | undefined>,
		onRequestAiRelationExplain?: (
			currentGraph: CircuitGraph,
			options: { fromNodeId?: string; toNodeId?: string; userPrompt?: string; extraContextText?: string }
		) => Promise<string | undefined>
		,
		options?: { initialGraphifyContextEnabled?: boolean }
	): CircuitPanel {
		if (CircuitPanel.currentPanel) {
			if (typeof options?.initialGraphifyContextEnabled === 'boolean') {
				CircuitPanel.currentPanel.graphifyContextEnabled = options.initialGraphifyContextEnabled;
				CircuitPanel.currentPanel.panel.webview.postMessage({
					type: 'graphifyContextState',
					enabled: options.initialGraphifyContextEnabled
				});
				CircuitDetailsPanel.setGraphifyContextEnabled(options.initialGraphifyContextEnabled);
			}
			CircuitPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			CircuitPanel.currentPanel.setGraph(graph);
			return CircuitPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel('mushroomPceCircuit', 'Mushroom PCE: Circuit Mode', vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true,
			// Allow loading Three.js from bundled deps.
			localResourceRoots: [extensionUri, vscode.Uri.joinPath(extensionUri, 'node_modules')]
		});

		CircuitPanel.currentPanel = new CircuitPanel(
			panel,
			extensionUri,
			graph,
			onNavigate,
			onBuildSkeletonGraph,
			onRequestGraph,
			onRequestAiEnrichment,
			onRequestAiRelationExplain,
			{
			initialGraphifyContextEnabled: options?.initialGraphifyContextEnabled,
			isPrimaryPanel: true
			}
		);
		return CircuitPanel.currentPanel;
	}

	static setGraphifyContextEnabled(enabled: boolean): void {
		const panel = CircuitPanel.currentPanel;
		if (!panel) {
			return;
		}
		panel.graphifyContextEnabled = enabled;
		panel.panel.webview.postMessage({ type: 'graphifyContextState', enabled });
		CircuitDetailsPanel.setGraphifyContextEnabled(enabled);
	}

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		graph: CircuitGraph,
		onNavigate?: (node: CircuitNode, graph: CircuitGraph) => Promise<void>,
		onBuildSkeletonGraph?: (node: CircuitNode, graph: CircuitGraph) => Promise<CircuitGraph | undefined>,
		onRequestGraph?: (
			scope: 'current-file' | 'full-architecture' | 'codeflow',
			currentGraph: CircuitGraph,
			options?: { dependencyMode?: 'imports' | 'imports-calls' }
		) => Promise<CircuitGraph | undefined>,
		onRequestAiEnrichment?: (
			currentGraph: CircuitGraph,
			scope?: 'current-file' | 'full-architecture' | 'codeflow'
		) => Promise<CircuitAiEnrichmentResult | undefined>,
		onRequestAiRelationExplain?: (
			currentGraph: CircuitGraph,
			options: { fromNodeId?: string; toNodeId?: string; userPrompt?: string; extraContextText?: string }
		) => Promise<string | undefined>,
		options?: {
			initialSkeletonRootNodeId?: string;
			initialViewMode?: 'architecture' | 'runtime';
			isPrimaryPanel?: boolean;
			initialGraphifyContextEnabled?: boolean;
		}
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.graph = graph;
		this.onNavigate = onNavigate;
		this.onBuildSkeletonGraph = onBuildSkeletonGraph;
		this.onRequestGraph = onRequestGraph;
		this.onRequestAiEnrichment = onRequestAiEnrichment;
		this.onRequestAiRelationExplain = onRequestAiRelationExplain;
		this.graphifyContextEnabled = Boolean(options?.initialGraphifyContextEnabled);
		this.isPrimaryPanel = options?.isPrimaryPanel ?? false;
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				const openNodeById = async (nodeId: string): Promise<void> => {
					if (!this.onNavigate) {
						return;
					}
					const node = this.graph.nodes.find((item) => item.id === nodeId);
					if (!node) {
						if (this.lastUnresolvedNodeId !== nodeId) {
							this.lastUnresolvedNodeId = nodeId;
							vscode.window.showInformationMessage('Node details are unavailable for this selection right now.');
						}
						return;
					}
					this.lastUnresolvedNodeId = undefined;
					await this.onNavigate(node, this.graph);
				};
				if (msg?.type === 'navigate' && typeof msg?.nodeId === 'string') {
					await openNodeById(msg.nodeId);
					return;
				}
				if (msg?.type === 'openSkeleton' && typeof msg?.nodeId === 'string') {
					await this.openSkeletonPanel(msg.nodeId, typeof msg?.label === 'string' ? msg.label : undefined);
					return;
				}
				if (
					msg?.type === 'requestGraph' &&
					this.onRequestGraph &&
					(msg?.scope === 'current-file' || msg?.scope === 'full-architecture' || msg?.scope === 'codeflow')
				) {
					const nextGraph = await this.onRequestGraph(msg.scope, this.graph, {
						dependencyMode: msg?.dependencyMode === 'imports-calls' ? 'imports-calls' : 'imports'
					});
					if (nextGraph) {
						this.setGraph(nextGraph);
					}
					return;
				}
				if (msg?.type === 'viewNode' && typeof msg?.nodeId === 'string') {
					await openNodeById(msg.nodeId);
					return;
				}
				if (msg?.type === 'updateGraph' && msg?.graph) {
					this.setGraph(msg.graph as CircuitGraph);
					return;
				}
				if (msg?.type === 'requestAiEnrichment' && this.onRequestAiEnrichment) {
					try {
						const scope =
							msg?.scope === 'full-architecture' || msg?.scope === 'codeflow' || msg?.scope === 'current-file'
								? msg.scope
								: 'current-file';
						const result = await this.onRequestAiEnrichment(this.graph, scope);
						this.panel.webview.postMessage({ type: 'aiEnrichment', result });
					} catch (error: any) {
						this.panel.webview.postMessage({
							type: 'aiEnrichment',
							error: error?.message ?? String(error ?? 'AI enrichment failed')
						});
					}
					return;
				}
				if (
					msg?.type === 'requestAiRelationExplain' &&
					this.onRequestAiRelationExplain
				) {
					const fromNodeId = typeof msg?.fromNodeId === 'string' ? msg.fromNodeId : undefined;
					const toNodeId = typeof msg?.toNodeId === 'string' ? msg.toNodeId : undefined;
					const userPrompt = typeof msg?.userPrompt === 'string' ? msg.userPrompt.trim() : undefined;
					const hasPair = Boolean(fromNodeId && toNodeId);
					if (!hasPair && !userPrompt) {
						this.panel.webview.postMessage({
							type: 'aiRelationExplain',
							error: 'Relation explain needs a From/To pair or a prompt.'
						});
						return;
					}
					try {
						const text = await this.onRequestAiRelationExplain(this.graph, {
							fromNodeId,
							toNodeId,
							userPrompt,
							extraContextText: this.relationChatExtraContextText
						});
						this.panel.webview.postMessage({
							type: 'aiRelationExplain',
							fromNodeId,
							toNodeId,
							userPrompt,
							extraContextText: this.relationChatExtraContextText,
							text
						});
					} catch (error: any) {
						this.panel.webview.postMessage({
							type: 'aiRelationExplain',
							fromNodeId,
							toNodeId,
							userPrompt,
							extraContextText: this.relationChatExtraContextText,
							error: error?.message ?? String(error ?? 'Relation explain failed')
						});
					}
					return;
				}
				if (msg?.type === 'exportRelationChatTranscript') {
					const fileName = String(msg?.fileName || '').trim();
					const exportMode = msg?.exportMode === 'edit' ? 'edit' : 'update';
					const turns = Array.isArray(msg?.turns) ? msg.turns : [];
					try {
						const fileKey = fileName.toLowerCase();
						const previousCursorRaw = this.relationExportCursorByFile.get(fileKey) ?? 0;
						const previousCursor = previousCursorRaw > turns.length ? 0 : previousCursorRaw;
						const exportTurns =
							exportMode === 'edit'
								? turns.slice(Math.max(0, previousCursor))
								: turns;
						if (exportMode === 'edit' && !exportTurns.length) {
							this.panel.webview.postMessage({
								type: 'relationChatExported',
								fileName,
								path: fileName,
								created: false,
								exportMode,
								skipped: true,
								message: 'No new chat turns since last /export ... -e for this file.'
							});
							return;
						}
						const markdown = buildChatTranscriptMarkdown(
							'Circuit Relation Chat',
							exportTurns.map((turn: { role?: string; text?: string }) => ({
								role: String(turn?.role || 'user'),
								text: String(turn?.text || '')
							}))
						);
						const result = await exportChatMarkdownFile({
							fileName,
							markdown,
							mode: exportMode
						});
						this.relationExportCursorByFile.set(fileKey, turns.length);
						this.panel.webview.postMessage({
							type: 'relationChatExported',
							fileName,
							path: result.relativePath,
							created: result.created,
							exportMode,
							exportedTurns: exportTurns.length
						});
					} catch (error: any) {
						this.panel.webview.postMessage({
							type: 'relationChatExported',
							fileName,
							exportMode,
							error: error?.message ?? String(error)
						});
					}
					return;
				}
				if (msg?.type === 'readRelationChatContext') {
					const fileName = String(msg?.fileName || '').trim();
					try {
						const result = await readChatMarkdownFile({
							fileName
						});
						this.relationChatExtraContextText = result.content;
						this.panel.webview.postMessage({
							type: 'relationChatContextRead',
							fileName,
							path: result.relativePath,
							contextText: result.content
						});
					} catch (error: any) {
						this.panel.webview.postMessage({
							type: 'relationChatContextRead',
							fileName,
							error: error?.message ?? String(error)
						});
					}
				}
			},
			null,
			this.disposables
		);
		this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri, graph, {
			initialSkeletonRootNodeId: options?.initialSkeletonRootNodeId,
			initialViewMode: options?.initialViewMode,
			initialGraphifyContextEnabled: this.graphifyContextEnabled
		});
	}

	dispose(): void {
		if (this.isPrimaryPanel && CircuitPanel.currentPanel === this) {
			CircuitPanel.currentPanel = undefined;
		}
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}

	setGraph(graph: CircuitGraph): void {
		this.graph = graph;
		this.panel.webview.postMessage({ type: 'graph', graph });
		this.panel.webview.postMessage({ type: 'graphifyContextState', enabled: this.graphifyContextEnabled });
		void CircuitDetailsPanel.syncGraph(graph);
	}

	private async openSkeletonPanel(rootNodeId: string, nodeLabel?: string): Promise<void> {
		const title = nodeLabel
			? `Mushroom PCE: Skeleton - ${nodeLabel}`
			: 'Mushroom PCE: Skeleton';
		let graphForSkeleton = this.graph;
		if (this.onBuildSkeletonGraph) {
			const rootNode = this.graph.nodes.find((node) => node.id === rootNodeId);
			if (rootNode) {
				try {
					const built = await this.onBuildSkeletonGraph(rootNode, this.graph);
					if (built && built.nodes.length) {
						graphForSkeleton = built;
					}
				} catch {
					// Keep fallback graph if global skeleton build fails.
				}
			}
		}
		const panel = vscode.window.createWebviewPanel('mushroomPceCircuitSkeleton', title, vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [this.extensionUri, vscode.Uri.joinPath(this.extensionUri, 'node_modules')]
		});
		new CircuitPanel(
			panel,
			this.extensionUri,
			graphForSkeleton,
			this.onNavigate,
			this.onBuildSkeletonGraph,
			this.onRequestGraph,
			this.onRequestAiEnrichment,
			this.onRequestAiRelationExplain,
			{
			initialSkeletonRootNodeId: rootNodeId,
			initialViewMode: 'runtime',
			initialGraphifyContextEnabled: this.graphifyContextEnabled,
			isPrimaryPanel: false
			}
		);
	}


	private getHtml(
		webview: vscode.Webview,
		extensionUri: vscode.Uri,
		graph: CircuitGraph,
		options?: {
			initialSkeletonRootNodeId?: string;
			initialViewMode?: 'architecture' | 'runtime';
			initialGraphifyContextEnabled?: boolean;
		}
	): string {
		return buildCircuitPanelHtml(webview, extensionUri, graph, options);
	}
}
