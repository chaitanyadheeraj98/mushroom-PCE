import * as vscode from 'vscode';

import { buildCircuitGraph } from './buildGraph';
import { CircuitEdge, CircuitGraph, CircuitLayer, CircuitNode } from '../../shared/types/circuitTypes';

type NodeMap = Map<string, CircuitNode>;

export async function buildCircuitGraphHybrid(document: vscode.TextDocument): Promise<CircuitGraph> {
	// Fallback graph from existing static analysis (AST/regex heuristics).
	const fallbackGraph = buildCircuitGraph(document);
	const nodes: CircuitNode[] = [...fallbackGraph.nodes];
	const edges: CircuitEdge[] = fallbackGraph.edges.map((edge, index) => ({
		...edge,
		id: `e:${index}`,
		label: addConfidenceTag(edge.label, 'fallback')
	}));

	const nodeById: NodeMap = new Map(nodes.map((node) => [node.id, node] as const));
	const edgeKey = new Set(edges.map((edge) => edgeSignature(edge.from, edge.to, normalizeEdgeLabel(edge.label), edge.kind)));
	const functionNodes = nodes.filter((node) => node.type === 'function' && typeof node.uri === 'string' && typeof node.line === 'number');

	if (!functionNodes.length) {
		return { nodes, edges };
	}

	// API-first enrichment: call hierarchy can resolve global references across files.
	for (const sourceNode of functionNodes) {
		const sourceUri = parseUriSafe(sourceNode.uri);
		if (!sourceUri || !isWorkspaceUri(sourceUri) || isTypeScriptLibFile(sourceUri)) {
			continue;
		}

		const position = new vscode.Position(Math.max(0, sourceNode.line ?? 0), Math.max(0, sourceNode.character ?? 0));
		const items = await safeCallHierarchyPrepare(sourceUri, position);
		if (!items.length) {
			continue;
		}

		const item = items[0];
		const outgoingCalls = await safeOutgoingCalls(item);
		for (const outgoing of outgoingCalls) {
			if (!isWorkspaceUri(outgoing.to.uri) || isTypeScriptLibFile(outgoing.to.uri)) {
				continue;
			}
			const targetNode = ensureNodeForItem(outgoing.to, nodeById, nodes);
			if (!targetNode) {
				continue;
			}
			upsertEdge(edges, edgeKey, {
				from: sourceNode.id,
				to: targetNode.id,
				kind: 'runtime',
				label: 'calls [api-high]'
			});
		}

		const incomingCalls = await safeIncomingCalls(item);
		for (const incoming of incomingCalls) {
			if (!isWorkspaceUri(incoming.from.uri) || isTypeScriptLibFile(incoming.from.uri)) {
				continue;
			}
			const fromNode = ensureNodeForItem(incoming.from, nodeById, nodes);
			if (!fromNode) {
				continue;
			}
			upsertEdge(edges, edgeKey, {
				from: fromNode.id,
				to: sourceNode.id,
				kind: 'runtime',
				label: 'calls [api-high]'
			});
		}
	}

	// Re-id edges after merge.
	for (let index = 0; index < edges.length; index++) {
		edges[index].id = `e:${index}`;
	}

	return { nodes, edges };
}

function ensureNodeForItem(item: vscode.CallHierarchyItem, nodeById: NodeMap, nodes: CircuitNode[]): CircuitNode | undefined {
	const uri = item.uri.toString();
	const line = item.selectionRange.start.line;
	const character = item.selectionRange.start.character;
	const existing = findNodeByLocation(nodeById, uri, line, character, item.name);
	if (existing) {
		return existing;
	}

	const newNode: CircuitNode = {
		id: makeExternalNodeId(uri, line, character, item.name),
		type: 'function',
		layer: classifyLayerFromName(item.name),
		groupId: `group:${classifyLayerFromName(item.name)}`,
		label: item.name,
		uri,
		line,
		character,
		detail: `external symbol (${vscode.SymbolKind[item.kind] ?? 'unknown'})`,
		inputs: [{ id: `in:${item.name}:call`, name: 'call-in', direction: 'in', kind: 'call', detail: 'call hierarchy incoming' }],
		outputs: [{ id: `out:${item.name}:call`, name: 'call-out', direction: 'out', kind: 'call', detail: 'call hierarchy outgoing' }]
	};

	nodeById.set(newNode.id, newNode);
	nodes.push(newNode);
	return newNode;
}

function findNodeByLocation(nodeById: NodeMap, uri: string, line: number, character: number, fallbackName?: string): CircuitNode | undefined {
	for (const node of nodeById.values()) {
		if (node.type !== 'function') {
			continue;
		}
		if (node.uri !== uri || typeof node.line !== 'number') {
			continue;
		}
		if (node.line === line && (node.character ?? 0) === character) {
			return node;
		}
	}

	if (fallbackName) {
		for (const node of nodeById.values()) {
			if (node.type === 'function' && node.uri === uri && node.label === fallbackName) {
				return node;
			}
		}
	}

	return undefined;
}

function upsertEdge(edges: CircuitEdge[], edgeKey: Set<string>, edge: Omit<CircuitEdge, 'id'>): void {
	const signature = edgeSignature(edge.from, edge.to, normalizeEdgeLabel(edge.label), edge.kind);
	if (edgeKey.has(signature)) {
		// Promote existing edge confidence to API-high if we got provider confirmation.
		for (const existing of edges) {
			if (edgeSignature(existing.from, existing.to, normalizeEdgeLabel(existing.label), existing.kind) === signature) {
				existing.label = addConfidenceTag(existing.label, 'api');
			}
		}
		return;
	}

	edgeKey.add(signature);
	edges.push({
		id: `e:${edges.length}`,
		from: edge.from,
		to: edge.to,
		fromPort: edge.fromPort,
		toPort: edge.toPort,
		kind: edge.kind,
		label: edge.label
	});
}

function edgeSignature(from: string, to: string, label: string, kind?: 'architecture' | 'runtime'): string {
	return `${kind ?? 'runtime'}:${from}->${to}:${label}`;
}

function normalizeEdgeLabel(label?: string): string {
	const text = (label ?? '').toLowerCase();
	return text.replace(/\s*\[(api-high|fallback-medium)\]\s*/g, '').trim();
}

function addConfidenceTag(label: string | undefined, source: 'api' | 'fallback'): string {
	const base = normalizeEdgeLabel(label || 'calls');
	if (source === 'api') {
		return `${base} [api-high]`;
	}
	return `${base} [fallback-medium]`;
}

function makeExternalNodeId(uri: string, line: number, character: number, name: string): string {
	const safeUri = uri.replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
	const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
	return `function:ext:${safeName}:${line}:${character}:${safeUri}`;
}

function classifyLayerFromName(name: string): CircuitLayer {
	const lower = name.toLowerCase();
	if (name === 'activate') {
		return 'system';
	}
	if (lower.includes('command') || lower.startsWith('set') || lower.startsWith('open') || lower.startsWith('select')) {
		return 'command';
	}
	if (lower.startsWith('run') || lower.startsWith('load') || lower.includes('analysis') || lower.includes('restore')) {
		return 'orchestration';
	}
	if (lower.includes('panel') || lower.includes('view') || lower.includes('render') || lower.includes('mode')) {
		return 'ui';
	}
	if (lower.includes('state') || lower.includes('cache') || lower.includes('model') || lower.includes('editor')) {
		return 'state';
	}
	if (lower.startsWith('escape') || lower.startsWith('extract') || lower.startsWith('count') || lower.startsWith('get') || lower.startsWith('infer')) {
		return 'utility';
	}
	return 'feature';
}

function parseUriSafe(uriString?: string): vscode.Uri | undefined {
	if (!uriString) {
		return undefined;
	}
	try {
		return vscode.Uri.parse(uriString);
	} catch {
		return undefined;
	}
}

function isWorkspaceUri(uri: vscode.Uri): boolean {
	if (uri.scheme !== 'file') {
		return false;
	}
	return !!vscode.workspace.getWorkspaceFolder(uri);
}

function isTypeScriptLibFile(uri: vscode.Uri): boolean {
	const p = uri.fsPath.replace(/\\/g, '/').toLowerCase();
	if (p.includes('/typescript/lib/') && /\/lib\..*\.d\.ts$/.test(p)) {
		return true;
	}
	return /\/lib\..*\.d\.ts$/.test(p);
}

async function safeCallHierarchyPrepare(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[]> {
	try {
		const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position);
		return items ?? [];
	} catch {
		return [];
	}
}

async function safeOutgoingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[]> {
	try {
		const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', item);
		return calls ?? [];
	} catch {
		return [];
	}
}

async function safeIncomingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[]> {
	try {
		const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
		return calls ?? [];
	} catch {
		return [];
	}
}

