import * as vscode from 'vscode';
import * as path from 'path';

import { CircuitGraph, CircuitLayer, CircuitNode } from './types';

type BuildOptions = {
	maxFiles?: number;
	dependencyMode?: 'imports' | 'imports-calls';
};

const DEFAULT_MAX_FILES = 1200;
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.cs', '.rb', '.php', '.rs'];

export async function buildProjectArchitectureGraph(
	anchorDocument?: vscode.TextDocument,
	options?: BuildOptions
): Promise<CircuitGraph> {
	const maxFiles = Math.max(50, options?.maxFiles ?? DEFAULT_MAX_FILES);
	const dependencyMode = options?.dependencyMode === 'imports-calls' ? 'imports-calls' : 'imports';
	const workspaceFolder = pickWorkspaceFolder(anchorDocument);
	if (!workspaceFolder) {
		return { nodes: [], edges: [] };
	}

	const anchorUri = resolveAnchorUri(anchorDocument, workspaceFolder);
	if (!anchorUri) {
		return { nodes: [], edges: [] };
	}

	const include = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,cs,rb,php,rs,json}';
	const exclude = '**/{node_modules,dist,out,build,.git,.next,.turbo,coverage,target}/**';
	const files = await vscode.workspace.findFiles(include, exclude, maxFiles);
	const codeFiles = files.filter(isLikelyCodeUri);
	const fileIndex = new Map<string, vscode.Uri>();
	for (const fileUri of codeFiles) {
		fileIndex.set(path.normalize(fileUri.fsPath).toLowerCase(), fileUri);
	}

	const adjacency = new Map<string, Set<string>>();
	for (const fileUri of codeFiles) {
		const doc = await safeOpenDocument(fileUri);
		if (!doc) {
			continue;
		}
		const specs = extractModuleSpecifiers(doc.getText(), doc.languageId);
		for (const spec of specs) {
			const resolved = resolveSpecifierToWorkspaceFile(spec, fileUri, workspaceFolder, fileIndex);
			if (!resolved) {
				continue;
			}
			if (resolved.toString() === fileUri.toString()) {
				continue;
			}
			const from = fileUri.toString();
			const to = resolved.toString();
			const set = adjacency.get(from) ?? new Set<string>();
			set.add(to);
			adjacency.set(from, set);
		}
	}

	const anchorKey = anchorUri.toString();
	const outgoing = adjacency.get(anchorKey) ?? new Set<string>();
	const incoming = new Set<string>();
	for (const [source, targets] of adjacency) {
		if (targets.has(anchorKey)) {
			incoming.add(source);
		}
	}

	const nodes: CircuitNode[] = [];
	const edges: CircuitGraph['edges'] = [];
	const seenNodeIds = new Set<string>();

	const addFileNode = (uriText: string, nodeRole: 'current' | 'neighbor'): string => {
		const uri = vscode.Uri.parse(uriText);
		const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
		const id = `module:file:${uriText}`;
		if (!seenNodeIds.has(id)) {
			seenNodeIds.add(id);
			nodes.push({
				id,
				type: 'module',
				layer: nodeRole === 'current' ? 'system' : classifyLayerFromPath(rel),
				label: path.basename(rel || uri.fsPath),
				uri: uriText,
				detail: `${nodeRole === 'current' ? 'current file' : 'connected file'}: ${rel || uri.fsPath}`
			});
		}
		return id;
	};

	const edgeSeen = new Set<string>();
	const addEdge = (from: string, to: string, label: string): void => {
		const key = `${from}->${to}:${label}`;
		if (edgeSeen.has(key)) {
			return;
		}
		edgeSeen.add(key);
		edges.push({
			id: `e:${edges.length}`,
			kind: 'architecture',
			from,
			to,
			label
		});
		edges.push({
			id: `e:${edges.length}`,
			kind: 'runtime',
			from,
			to,
			label
		});
	};

	const currentNodeId = addFileNode(anchorKey, 'current');
	for (const neighborUri of outgoing) {
		const neighborId = addFileNode(neighborUri, 'neighbor');
		addEdge(currentNodeId, neighborId, 'imports [api-high]');
	}
	for (const neighborUri of incoming) {
		const neighborId = addFileNode(neighborUri, 'neighbor');
		addEdge(neighborId, currentNodeId, 'imports [api-high]');
	}

	if (dependencyMode === 'imports-calls') {
		const callNeighbors = await collectCallHierarchyFileNeighbors(anchorUri);
		for (const calleeUri of callNeighbors.outgoing) {
			const neighborId = addFileNode(calleeUri, 'neighbor');
			addEdge(currentNodeId, neighborId, 'calls [api-high]');
		}
		for (const callerUri of callNeighbors.incoming) {
			const neighborId = addFileNode(callerUri, 'neighbor');
			addEdge(neighborId, currentNodeId, 'calls [api-high]');
		}
	}

	if (nodes.length === 1) {
		nodes.push({
			id: `utility:hint:${anchorKey}`,
			type: 'utility',
			layer: 'utility',
			label: 'No direct file neighbors',
			detail: 'No local import/export dependency detected for this file (1-hop).'
		});
		edges.push({
			id: `e:${edges.length}`,
			kind: 'architecture',
			from: currentNodeId,
			to: `utility:hint:${anchorKey}`,
			label: 'hint'
		});
		edges.push({
			id: `e:${edges.length}`,
			kind: 'runtime',
			from: currentNodeId,
			to: `utility:hint:${anchorKey}`,
			label: 'hint'
		});
	}

	return { nodes, edges };
}

async function collectCallHierarchyFileNeighbors(anchorUri: vscode.Uri): Promise<{ incoming: Set<string>; outgoing: Set<string> }> {
	const incoming = new Set<string>();
	const outgoing = new Set<string>();
	const doc = await safeOpenDocument(anchorUri);
	if (!doc) {
		return { incoming, outgoing };
	}

	const symbols = await safeDocumentSymbols(anchorUri);
	const functionSymbols = flattenFunctionSymbols(symbols);
	if (!functionSymbols.length) {
		return { incoming, outgoing };
	}

	for (const symbol of functionSymbols) {
		const position = symbol.selectionRange.start;
		const items = await safePrepareCallHierarchy(anchorUri, position);
		if (!items.length) {
			continue;
		}
		const item = items[0];
		const outgoingCalls = await safeOutgoingCalls(item);
		for (const call of outgoingCalls) {
			if (!isWorkspaceUri(call.to.uri) || isTypeScriptLibFile(call.to.uri) || !isLikelyCodeUri(call.to.uri)) {
				continue;
			}
			const toUri = call.to.uri.toString();
			if (toUri !== anchorUri.toString()) {
				outgoing.add(toUri);
			}
		}

		const incomingCalls = await safeIncomingCalls(item);
		for (const call of incomingCalls) {
			if (!isWorkspaceUri(call.from.uri) || isTypeScriptLibFile(call.from.uri) || !isLikelyCodeUri(call.from.uri)) {
				continue;
			}
			const fromUri = call.from.uri.toString();
			if (fromUri !== anchorUri.toString()) {
				incoming.add(fromUri);
			}
		}
	}

	return { incoming, outgoing };
}

function pickWorkspaceFolder(anchorDocument?: vscode.TextDocument): vscode.WorkspaceFolder | undefined {
	if (anchorDocument) {
		const ws = vscode.workspace.getWorkspaceFolder(anchorDocument.uri);
		if (ws) {
			return ws;
		}
	}
	return vscode.workspace.workspaceFolders?.[0];
}

function resolveAnchorUri(anchorDocument: vscode.TextDocument | undefined, workspaceFolder: vscode.WorkspaceFolder): vscode.Uri | undefined {
	if (anchorDocument) {
		return anchorDocument.uri;
	}
	const active = vscode.window.activeTextEditor?.document;
	if (active && vscode.workspace.getWorkspaceFolder(active.uri)?.uri.toString() === workspaceFolder.uri.toString()) {
		return active.uri;
	}
	return undefined;
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
		const provided = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			uri
		);
		if (!provided?.length || !isDocumentSymbolArray(provided)) {
			return [];
		}
		return provided;
	} catch {
		return [];
	}
}

function isLikelyCodeUri(uri: vscode.Uri): boolean {
	const ext = path.extname(uri.fsPath).toLowerCase();
	return SUPPORTED_EXTENSIONS.includes(ext);
}

function isDocumentSymbolArray(
	values: (vscode.DocumentSymbol | vscode.SymbolInformation)[]
): values is vscode.DocumentSymbol[] {
	return values.every((item) => 'children' in item && 'selectionRange' in item);
}

function flattenFunctionSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
	const out: vscode.DocumentSymbol[] = [];
	const stack = [...symbols];
	while (stack.length) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		if (
			current.kind === vscode.SymbolKind.Function ||
			current.kind === vscode.SymbolKind.Method ||
			current.kind === vscode.SymbolKind.Constructor
		) {
			out.push(current);
		}
		if (Array.isArray(current.children) && current.children.length) {
			for (let i = 0; i < current.children.length; i++) {
				stack.push(current.children[i]);
			}
		}
	}
	return out.slice(0, 200);
}

async function safePrepareCallHierarchy(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem[]> {
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

function extractModuleSpecifiers(text: string, languageId: string): string[] {
	const specs = new Set<string>();
	const add = (value: string): void => {
		const trimmed = value.trim();
		if (!trimmed) {
			return;
		}
		if (trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('@/') || trimmed.startsWith('~/')) {
			specs.add(trimmed);
		}
	};

	const importRe = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
	const exportFromRe = /\bexport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g;
	const requireRe = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
	const dynamicImportRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
	let match: RegExpExecArray | null = null;
	while ((match = importRe.exec(text))) {
		add(match[1]);
	}
	while ((match = exportFromRe.exec(text))) {
		add(match[1]);
	}
	while ((match = requireRe.exec(text))) {
		add(match[1]);
	}
	while ((match = dynamicImportRe.exec(text))) {
		add(match[1]);
	}

	if (languageId === 'python' || /\.py\b/.test(text.slice(0, 200))) {
		const fromImportRe = /^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm;
		const importSimpleRe = /^\s*import\s+([A-Za-z0-9_\.\s,]+)/gm;
		while ((match = fromImportRe.exec(text))) {
			add('./' + match[1].replace(/\./g, '/'));
		}
		while ((match = importSimpleRe.exec(text))) {
			const parts = match[1]
				.split(',')
				.map((p) => p.trim().split(/\s+as\s+/i)[0]?.trim())
				.filter(Boolean) as string[];
			for (const part of parts) {
				add('./' + part.replace(/\./g, '/'));
			}
		}
	}

	return [...specs];
}

function resolveSpecifierToWorkspaceFile(
	spec: string,
	sourceUri: vscode.Uri,
	workspaceFolder: vscode.WorkspaceFolder,
	fileIndex: Map<string, vscode.Uri>
): vscode.Uri | undefined {
	const candidates: string[] = [];
	const sourceDir = path.dirname(sourceUri.fsPath);

	if (spec.startsWith('./') || spec.startsWith('../')) {
		candidates.push(path.resolve(sourceDir, spec));
	} else if (spec.startsWith('/')) {
		candidates.push(path.resolve(workspaceFolder.uri.fsPath, '.' + spec));
	} else if (spec.startsWith('@/')) {
		candidates.push(path.resolve(workspaceFolder.uri.fsPath, 'src', spec.slice(2)));
	} else if (spec.startsWith('~/')) {
		candidates.push(path.resolve(workspaceFolder.uri.fsPath, spec.slice(2)));
	}

	const expanded: string[] = [];
	for (const base of candidates) {
		expanded.push(base);
		if (!path.extname(base)) {
			for (const ext of SUPPORTED_EXTENSIONS) {
				expanded.push(base + ext);
				expanded.push(path.join(base, 'index' + ext));
			}
		}
	}

	for (const candidate of expanded) {
		const key = path.normalize(candidate).toLowerCase();
		const hit = fileIndex.get(key);
		if (hit) {
			return hit;
		}
	}

	return undefined;
}

function classifyLayerFromPath(pathText: string): CircuitLayer {
	const lower = pathText.toLowerCase();
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
