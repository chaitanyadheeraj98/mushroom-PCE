import * as vscode from 'vscode';

import { CircuitEdge, CircuitGraph, CircuitLayer, CircuitNode } from '../../shared/types/circuitTypes';

export async function buildProjectArchitectureGraph(anchorDocument?: vscode.TextDocument): Promise<CircuitGraph> {
	const workspace = pickWorkspaceFolder(anchorDocument);
	if (!workspace) {
		return { nodes: [], edges: [] };
	}

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

	const addEdge = (from: string, to: string, label = 'contains [api-high]'): void => {
		const key = `${from}->${to}:${label}`;
		if (edgeKey.has(key)) {
			return;
		}
		edgeKey.add(key);
		edges.push({
			id: `e:${edges.length}`,
			kind: 'architecture',
			from,
			to,
			label
		});
	};

	const rootId = `module:workspace:${workspace.uri.toString()}`;
	addNode({
		id: rootId,
		type: 'module',
		layer: 'system',
		label: workspace.name,
		uri: workspace.uri.toString(),
		detail: 'workspace root'
	});

	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(workspace, '**/*'),
		'**/{node_modules,dist,out,.git,.vscode,coverage}/**',
		2000
	);

	for (const fileUri of files) {
		const relativePath = vscode.workspace.asRelativePath(fileUri, false).replace(/\\/g, '/');
		if (!relativePath || relativePath.endsWith('/')) {
			continue;
		}

		const fileSegments = relativePath.split('/');
		const fileName = fileSegments[fileSegments.length - 1];
		const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
		if (!isLikelyCodeFile(fileExt)) {
			continue;
		}

		let parentId = rootId;
		let runningPath = '';
		for (let index = 0; index < fileSegments.length; index++) {
			const segment = fileSegments[index];
			runningPath = runningPath ? `${runningPath}/${segment}` : segment;
			const isFile = index === fileSegments.length - 1;
			const nodeId = isFile ? `module:file:${workspace.uri.toString()}:${runningPath}` : `module:folder:${workspace.uri.toString()}:${runningPath}`;
			const node = addNode({
				id: nodeId,
				type: 'module',
				layer: inferLayerFromPath(runningPath),
				groupId: `group:${inferLayerFromPath(runningPath)}`,
				parentId,
				label: segment,
				uri: isFile ? fileUri.toString() : undefined,
				detail: isFile ? `file: ${runningPath}` : `folder: ${runningPath}`
			});
			addEdge(parentId, node.id);
			parentId = node.id;
		}

		await addDocumentSymbols(fileUri, parentId, addNode, addEdge);
	}

	for (let index = 0; index < edges.length; index++) {
		edges[index].id = `e:${index}`;
	}
	return { nodes, edges };
}

async function addDocumentSymbols(
	fileUri: vscode.Uri,
	parentFileNodeId: string,
	addNode: (node: CircuitNode) => CircuitNode,
	addEdge: (from: string, to: string, label?: string) => void
): Promise<void> {
	let symbols: vscode.DocumentSymbol[] = [];
	try {
		const provided = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', fileUri);
		symbols = provided ?? [];
	} catch {
		symbols = [];
	}
	if (!symbols.length) {
		return;
	}

	const walk = (items: vscode.DocumentSymbol[], parentId: string, ownerUri: string) => {
		for (const symbol of items) {
			const symbolType = mapSymbolKindToNodeType(symbol.kind);
			const layer = inferLayerFromSymbol(symbol.kind, symbol.name);
			const symbolId = `symbol:${ownerUri}:${symbol.kind}:${symbol.name}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}`;
			const node = addNode({
				id: symbolId,
				type: symbolType,
				layer,
				groupId: `group:${layer}`,
				parentId,
				label: symbol.name,
				uri: ownerUri,
				line: symbol.selectionRange.start.line,
				character: symbol.selectionRange.start.character,
				detail: `${vscode.SymbolKind[symbol.kind] ?? 'symbol'} in ${vscode.Uri.parse(ownerUri).path.split('/').pop()}`
			});
			addEdge(parentId, node.id);
			if (symbol.children?.length) {
				walk(symbol.children, node.id, ownerUri);
			}
		}
	};

	walk(symbols, parentFileNodeId, fileUri.toString());
}

function mapSymbolKindToNodeType(kind: vscode.SymbolKind): CircuitNode['type'] {
	switch (kind) {
		case vscode.SymbolKind.Function:
		case vscode.SymbolKind.Method:
		case vscode.SymbolKind.Constructor:
			return 'function';
		case vscode.SymbolKind.Variable:
		case vscode.SymbolKind.Constant:
		case vscode.SymbolKind.Field:
		case vscode.SymbolKind.Property:
			return 'state';
		default:
			return 'module';
	}
}

function inferLayerFromSymbol(kind: vscode.SymbolKind, name: string): CircuitLayer {
	const lower = (name || '').toLowerCase();
	if (kind === vscode.SymbolKind.Class || kind === vscode.SymbolKind.Interface || kind === vscode.SymbolKind.Module || kind === vscode.SymbolKind.Namespace) {
		return 'feature';
	}
	if (kind === vscode.SymbolKind.Function || kind === vscode.SymbolKind.Method || kind === vscode.SymbolKind.Constructor) {
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
	return 'feature';
}

function inferLayerFromPath(path: string): CircuitLayer {
	const lower = path.toLowerCase();
	if (lower.includes('/commands/') || lower.endsWith('/commands')) {
		return 'command';
	}
	if (lower.includes('/panel') || lower.includes('/view') || lower.includes('/ui/')) {
		return 'ui';
	}
	if (lower.includes('/state') || lower.includes('/store') || lower.includes('/cache') || lower.includes('/model')) {
		return 'state';
	}
	if (lower.includes('/utils/') || lower.includes('/helper')) {
		return 'utility';
	}
	if (lower.includes('/core/') || lower.includes('/orchestration/') || lower.includes('/analysis/')) {
		return 'orchestration';
	}
	return 'feature';
}

function pickWorkspaceFolder(anchorDocument?: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
	if (anchorDocument) {
		const fromDoc = vscode.workspace.getWorkspaceFolder(anchorDocument.uri);
		if (fromDoc) {
			return fromDoc;
		}
	}
	return vscode.workspace.workspaceFolders?.[0];
}

function isLikelyCodeFile(ext: string | undefined): boolean {
	if (!ext) {
		return false;
	}
	return ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'java', 'cs', 'cpp', 'c', 'h', 'hpp', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'scala', 'lua', 'json'].includes(ext);
}

