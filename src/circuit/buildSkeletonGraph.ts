import * as vscode from 'vscode';

import { CircuitEdge, CircuitGraph, CircuitLayer, CircuitNode } from './types';

type QueueItem = {
	item: vscode.CallHierarchyItem;
	nodeId: string;
	depth: number;
};

export async function buildGlobalSkeletonGraph(
	rootNode: CircuitNode,
	fallbackGraph: CircuitGraph,
	maxDepth = 2
): Promise<CircuitGraph> {
	const nodes: CircuitNode[] = [];
	const edges: CircuitEdge[] = [];
	const nodeById = new Map<string, CircuitNode>();
	const edgeKey = new Set<string>();

	const addNode = (node: CircuitNode): CircuitNode => {
		const existing = nodeById.get(node.id);
		if (existing) {
			return existing;
		}
		nodeById.set(node.id, node);
		nodes.push(node);
		return node;
	};

	const addEdge = (from: string, to: string, label: string): void => {
		const key = `${from}->${to}:${label}`;
		if (edgeKey.has(key)) {
			return;
		}
		edgeKey.add(key);
		edges.push({
			id: `e:${edges.length}`,
			kind: 'runtime',
			from,
			to,
			label
		});
	};

	const root: CircuitNode = {
		...rootNode,
		type: 'function',
		layer: rootNode.layer ?? classifyLayerFromName(rootNode.label)
	};
	addNode(root);

	if (!root.uri || typeof root.line !== 'number') {
		mergeFallbackOneHop(root.id, fallbackGraph, nodeById, addNode, addEdge);
		return { nodes, edges };
	}

	const uri = parseUriSafe(root.uri);
	if (!uri || !isWorkspaceUri(uri) || isTypeScriptLibFile(uri)) {
		mergeFallbackOneHop(root.id, fallbackGraph, nodeById, addNode, addEdge);
		return { nodes, edges };
	}

	const position = new vscode.Position(Math.max(0, root.line), Math.max(0, root.character ?? 0));
	const starts = await safePrepare(uri, position);
	if (!starts.length) {
		mergeFallbackOneHop(root.id, fallbackGraph, nodeById, addNode, addEdge);
		return { nodes, edges };
	}

	const queue: QueueItem[] = [{ item: starts[0], nodeId: root.id, depth: 0 }];
	const visited = new Set<string>();

	while (queue.length) {
		const current = queue.shift();
		if (!current) {
			continue;
		}

		const visitKey = `${current.item.uri.toString()}:${current.item.selectionRange.start.line}:${current.item.selectionRange.start.character}`;
		if (visited.has(visitKey)) {
			continue;
		}
		visited.add(visitKey);

		if (current.depth >= maxDepth) {
			continue;
		}

		const outgoing = await safeOutgoing(current.item);
		for (const call of outgoing) {
			if (!isWorkspaceUri(call.to.uri) || isTypeScriptLibFile(call.to.uri)) {
				continue;
			}
			const toNode = ensureNode(call.to, fallbackGraph, addNode, nodeById);
			addEdge(current.nodeId, toNode.id, 'calls [api-high]');
			queue.push({ item: call.to, nodeId: toNode.id, depth: current.depth + 1 });
		}

		const incoming = await safeIncoming(current.item);
		for (const call of incoming) {
			if (!isWorkspaceUri(call.from.uri) || isTypeScriptLibFile(call.from.uri)) {
				continue;
			}
			const fromNode = ensureNode(call.from, fallbackGraph, addNode, nodeById);
			addEdge(fromNode.id, current.nodeId, 'calls [api-high]');
			queue.push({ item: call.from, nodeId: fromNode.id, depth: current.depth + 1 });
		}
	}

	if (edges.length === 0) {
		mergeFallbackOneHop(root.id, fallbackGraph, nodeById, addNode, addEdge);
	}

	for (let index = 0; index < edges.length; index++) {
		edges[index].id = `e:${index}`;
	}
	return { nodes, edges };
}

function ensureNode(
	item: vscode.CallHierarchyItem,
	fallbackGraph: CircuitGraph,
	addNode: (node: CircuitNode) => CircuitNode,
	nodeById: Map<string, CircuitNode>
): CircuitNode {
	const uri = item.uri.toString();
	const line = item.selectionRange.start.line;
	const character = item.selectionRange.start.character;
	const byLocation = findNodeByLocation(nodeById, uri, line, character, item.name);
	if (byLocation) {
		return byLocation;
	}

	const fallbackNode = fallbackGraph.nodes.find((node) => {
		if (node.type !== 'function' || node.uri !== uri || typeof node.line !== 'number') {
			return false;
		}
		return (node.line === line && (node.character ?? 0) === character) || node.label === item.name;
	});
	if (fallbackNode) {
		return addNode({ ...fallbackNode, layer: fallbackNode.layer ?? classifyLayerFromName(fallbackNode.label) });
	}

	return addNode({
		id: makeExternalNodeId(uri, line, character, item.name),
		type: 'function',
		layer: classifyLayerFromName(item.name),
		groupId: `group:${classifyLayerFromName(item.name)}`,
		label: item.name,
		uri,
		line,
		character,
		detail: `external symbol (${vscode.SymbolKind[item.kind] ?? 'unknown'})`
	});
}

function findNodeByLocation(
	nodeById: Map<string, CircuitNode>,
	uri: string,
	line: number,
	character: number,
	fallbackName?: string
): CircuitNode | undefined {
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

function mergeFallbackOneHop(
	rootNodeId: string,
	fallbackGraph: CircuitGraph,
	nodeById: Map<string, CircuitNode>,
	addNode: (node: CircuitNode) => CircuitNode,
	addEdge: (from: string, to: string, label: string) => void
): void {
	for (const edge of fallbackGraph.edges) {
		if (edge.from !== rootNodeId && edge.to !== rootNodeId) {
			continue;
		}

		const fromNode = fallbackGraph.nodes.find((node) => node.id === edge.from);
		const toNode = fallbackGraph.nodes.find((node) => node.id === edge.to);
		if (!fromNode || !toNode) {
			continue;
		}

		addNode(nodeById.get(fromNode.id) ?? fromNode);
		addNode(nodeById.get(toNode.id) ?? toNode);
		addEdge(fromNode.id, toNode.id, `${normalizeLabel(edge.label)} [fallback-medium]`);
	}
}

function normalizeLabel(label?: string): string {
	return (label ?? 'calls').replace(/\s*\[(api-high|fallback-medium)\]\s*/gi, '').trim() || 'calls';
}

function classifyLayerFromName(name: string): CircuitLayer {
	const lower = (name || '').toLowerCase();
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

function parseUriSafe(uriString: string): vscode.Uri | undefined {
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

async function safePrepare(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[]> {
	try {
		const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position);
		return items ?? [];
	} catch {
		return [];
	}
}

async function safeOutgoing(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[]> {
	try {
		const result = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', item);
		return result ?? [];
	} catch {
		return [];
	}
}

async function safeIncoming(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[]> {
	try {
		const result = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
		return result ?? [];
	} catch {
		return [];
	}
}

function makeExternalNodeId(uri: string, line: number, character: number, name: string): string {
	const safeUri = uri.replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
	const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
	return `function:ext:${safeName}:${line}:${character}:${safeUri}`;
}
