import * as vscode from 'vscode';

import { CircuitEdge, CircuitGraph, CircuitLayer, CircuitNode } from './types';

type BuildOptions = {
	maxFiles?: number;
};

const DEFAULT_MAX_FILES = 240;

export async function buildProjectArchitectureGraph(
	options?: BuildOptions
): Promise<CircuitGraph> {
	const maxFiles = Math.max(20, options?.maxFiles ?? DEFAULT_MAX_FILES);
	const roots = vscode.workspace.workspaceFolders ?? [];
	if (!roots.length) {
		return { nodes: [], edges: [] };
	}

	const nodeById = new Map<string, CircuitNode>();
	const edges: CircuitEdge[] = [];
	const edgeSeen = new Set<string>();
	const rootNodeId = 'layer:project-root';

	addNode(nodeById, {
		id: rootNodeId,
		type: 'layer',
		layer: 'system',
		label: 'Project',
		detail: 'Workspace architecture root'
	});

	const include = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,cs,rb,php,rs}';
	const exclude = '**/{node_modules,dist,out,build,.git,.next,.turbo,coverage,target}/**';
	const files = await vscode.workspace.findFiles(include, exclude, maxFiles);

	for (const fileUri of files) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri) ?? roots[0];
		const relativePath = vscode.workspace.asRelativePath(fileUri, false);
		const normalized = relativePath.replace(/\\/g, '/');
		const parts = normalized.split('/').filter(Boolean);
		if (!parts.length) {
			continue;
		}

		let parentId = rootNodeId;
		if (workspaceFolder) {
			const wsId = `module:workspace:${workspaceFolder.uri.toString()}`;
			addNode(nodeById, {
				id: wsId,
				type: 'module',
				layer: 'system',
				label: workspaceFolder.name,
				uri: workspaceFolder.uri.toString(),
				detail: 'workspace'
			});
			addEdge(edges, edgeSeen, rootNodeId, wsId, 'contains', 'architecture');
			parentId = wsId;
		}

		for (let i = 0; i < parts.length - 1; i++) {
			const folderPath = parts.slice(0, i + 1).join('/');
			const folderId = `module:folder:${folderPath}`;
			addNode(nodeById, {
				id: folderId,
				type: 'module',
				layer: 'feature',
				label: parts[i],
				uri: fileUri.toString(),
				detail: `folder: ${folderPath}`
			});
			addEdge(edges, edgeSeen, parentId, folderId, 'contains', 'architecture');
			parentId = folderId;
		}

		const fileName = parts[parts.length - 1];
		const fileId = `module:file:${fileUri.toString()}`;
		addNode(nodeById, {
			id: fileId,
			type: 'module',
			layer: classifyLayerFromPath(normalized),
			label: fileName,
			uri: fileUri.toString(),
			detail: `file: ${normalized}`
		});
		addEdge(edges, edgeSeen, parentId, fileId, 'contains', 'architecture');

		const document = await safeOpenDocument(fileUri);
		if (!document) {
			continue;
		}

		const symbols = await safeDocumentSymbols(fileUri);
		if (!symbols.length) {
			continue;
		}
		addSymbolNodes(nodeById, edges, edgeSeen, fileId, fileUri, symbols, normalized);
	}

	// Add a light runtime backbone so runtime mode has readable flow between root modules.
	const topModules = [...nodeById.values()].filter((node) => node.type === 'module' && node.detail === 'workspace');
	for (let i = 0; i < topModules.length - 1; i++) {
		addEdge(edges, edgeSeen, topModules[i].id, topModules[i + 1].id, 'flows-to', 'runtime');
	}

	return { nodes: [...nodeById.values()], edges };
}

function addSymbolNodes(
	nodeById: Map<string, CircuitNode>,
	edges: CircuitEdge[],
	edgeSeen: Set<string>,
	fileNodeId: string,
	fileUri: vscode.Uri,
	symbols: vscode.DocumentSymbol[],
	relativePath: string
): void {
	const walk = (items: vscode.DocumentSymbol[], parentId: string): void => {
		for (const symbol of items) {
			const kindName = vscode.SymbolKind[symbol.kind] ?? 'Symbol';
			const isModuleSymbol = isModuleKind(symbol.kind);
			const isFunctionSymbol = isFunctionKind(symbol.kind);

			const nodeId = `sym:${fileUri.toString()}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}:${sanitize(
				symbol.name
			)}`;
			const nodeType: CircuitNode['type'] = isFunctionSymbol ? 'function' : isModuleSymbol ? 'module' : 'utility';
			const layer: CircuitLayer = isFunctionSymbol ? classifyLayerFromName(symbol.name) : classifyLayerFromPath(relativePath);

			addNode(nodeById, {
				id: nodeId,
				type: nodeType,
				layer,
				groupId: fileNodeId,
				parentId,
				label: symbol.name,
				uri: fileUri.toString(),
				line: symbol.selectionRange.start.line,
				character: symbol.selectionRange.start.character,
				detail: `${kindName} in ${relativePath}`
			});
			addEdge(edges, edgeSeen, parentId, nodeId, 'contains', 'architecture');

			if (symbol.children.length) {
				walk(symbol.children, nodeId);
			}
		}
	};

	walk(symbols, fileNodeId);
}

async function safeOpenDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
	try {
		return await vscode.workspace.openTextDocument(uri);
	} catch {
		return undefined;
	}
}

async function safeDocumentSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
	try {
		const result = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			uri
		);
		if (!result?.length || !isDocumentSymbolArray(result)) {
			return [];
		}
		return result;
	} catch {
		return [];
	}
}

function isDocumentSymbolArray(
	values: (vscode.DocumentSymbol | vscode.SymbolInformation)[]
): values is vscode.DocumentSymbol[] {
	return values.every((item) => 'children' in item && 'selectionRange' in item);
}

function addNode(map: Map<string, CircuitNode>, node: CircuitNode): CircuitNode {
	const existing = map.get(node.id);
	if (existing) {
		return existing;
	}
	map.set(node.id, node);
	return node;
}

function addEdge(
	edges: CircuitEdge[],
	seen: Set<string>,
	from: string,
	to: string,
	label: string,
	kind: 'architecture' | 'runtime'
): void {
	if (from === to) {
		return;
	}
	const key = `${kind}:${from}->${to}:${label}`;
	if (seen.has(key)) {
		return;
	}
	seen.add(key);
	edges.push({
		id: `e:${edges.length}`,
		from,
		to,
		label,
		kind
	});
}

function isModuleKind(kind: vscode.SymbolKind): boolean {
	return (
		kind === vscode.SymbolKind.Class ||
		kind === vscode.SymbolKind.Module ||
		kind === vscode.SymbolKind.Namespace ||
		kind === vscode.SymbolKind.Interface ||
		kind === vscode.SymbolKind.Enum
	);
}

function isFunctionKind(kind: vscode.SymbolKind): boolean {
	return (
		kind === vscode.SymbolKind.Function ||
		kind === vscode.SymbolKind.Method ||
		kind === vscode.SymbolKind.Constructor
	);
}

function sanitize(value: string): string {
	return value.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48);
}

function classifyLayerFromPath(path: string): CircuitLayer {
	const lower = path.toLowerCase();
	if (lower.includes('/commands/') || lower.includes('command')) {
		return 'command';
	}
	if (lower.includes('/panel') || lower.includes('/ui/')) {
		return 'ui';
	}
	if (lower.includes('/state/') || lower.includes('cache') || lower.includes('model')) {
		return 'state';
	}
	if (lower.includes('/utils/') || lower.includes('/helpers/')) {
		return 'utility';
	}
	if (lower.includes('/analysis/') || lower.includes('/orchestration/')) {
		return 'orchestration';
	}
	return 'feature';
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
