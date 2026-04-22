import * as path from 'path';
import * as vscode from 'vscode';

import { CircuitEdge, CircuitGraph, CircuitNode } from '../../shared/types/circuitTypes';

type CircuitScope = 'current-file' | 'full-architecture' | 'codeflow';

type EnrichOptions = {
	scope: CircuitScope;
	document: vscode.TextDocument;
	output?: vscode.OutputChannel;
};

type GraphifyNode = {
	id: string;
	label?: string;
	norm_label?: string;
	source_file?: string;
	source_location?: string;
	file_type?: string;
};

type GraphifyLink = {
	source: string;
	target: string;
	relation?: string;
};

type GraphifyGraph = {
	nodes: GraphifyNode[];
	links: GraphifyLink[];
};

type LoadedGraphifyGraph = {
	graph: GraphifyGraph;
	byId: Map<string, GraphifyNode>;
	bySourceFile: Map<string, GraphifyNode[]>;
	path: string;
	mtime: number;
};

const graphCache = new Map<string, LoadedGraphifyGraph>();

export async function enrichCircuitGraphWithGraphifyContext(
	baseGraph: CircuitGraph,
	options: EnrichOptions
): Promise<CircuitGraph> {
	const loaded = await loadGraphifyGraph(options.document);
	if (!loaded) {
		options.output?.appendLine('circuit graphify enrich skipped: graphify-out/graph.json unavailable');
		return baseGraph;
	}

	const mapped = mapCircuitNodesToGraphify(baseGraph.nodes, loaded);
	if (!mapped.size) {
		options.output?.appendLine('circuit graphify enrich skipped: no node mapping found');
		return baseGraph;
	}

	const nodes = [...baseGraph.nodes];
	const edges = [...baseGraph.edges];
	const edgeSeen = new Set(edges.map((edge) => edgeSignature(edge)));
	const nodeSeen = new Set(nodes.map((node) => node.id));

	let addedEdges = 0;
	let addedNodes = 0;
	const maxAugmentEdges = options.scope === 'full-architecture' ? 200 : 120;
	const maxAugmentNodes = options.scope === 'full-architecture' ? 14 : 8;

	const graphToCircuit = invertNodeMapping(mapped);
	for (const link of loaded.graph.links) {
		if (addedEdges >= maxAugmentEdges) {
			break;
		}
		const fromCircuit = graphToCircuit.get(link.source);
		const toCircuit = graphToCircuit.get(link.target);
		if (!fromCircuit?.size || !toCircuit?.size) {
			continue;
		}
		for (const fromId of fromCircuit) {
			for (const toId of toCircuit) {
				if (fromId === toId) {
					continue;
				}
				const edge: CircuitEdge = {
					id: `e:${edges.length}`,
					kind: relationToKind(link.relation),
					from: fromId,
					to: toId,
					label: buildGraphifyLabel(link.relation)
				};
				const sig = edgeSignature(edge);
				if (edgeSeen.has(sig)) {
					continue;
				}
				edgeSeen.add(sig);
				edges.push(edge);
				addedEdges++;
				if (addedEdges >= maxAugmentEdges) {
					break;
				}
			}
			if (addedEdges >= maxAugmentEdges) {
				break;
			}
		}
	}

	const anchorCircuitNodeIds = pickAnchorCircuitNodes(baseGraph.nodes, options.document);
	if (anchorCircuitNodeIds.length) {
		const anchorGraphIds = new Set<string>();
		for (const circuitId of anchorCircuitNodeIds) {
			const graphIds = mapped.get(circuitId);
			if (!graphIds) {
				continue;
			}
			for (const graphId of graphIds) {
				anchorGraphIds.add(graphId);
			}
		}
		const relatedFiles = rankRelatedFiles(anchorGraphIds, loaded);
		for (const related of relatedFiles) {
			if (addedNodes >= maxAugmentNodes) {
				break;
			}
			const externalNodeId = `graphify:file:${related.normalizedPath}`;
			if (!nodeSeen.has(externalNodeId)) {
				nodeSeen.add(externalNodeId);
				nodes.push({
					id: externalNodeId,
					type: 'module',
					layer: 'feature',
					label: path.basename(related.path),
					uri: vscode.Uri.file(related.path).toString(),
					detail: `graphify linked file | relation-count=${related.score}`
				});
				addedNodes++;
			}

			const primaryAnchor = anchorCircuitNodeIds[0];
			if (!primaryAnchor) {
				continue;
			}
			const edge: CircuitEdge = {
				id: `e:${edges.length}`,
				kind: 'architecture',
				from: primaryAnchor,
				to: externalNodeId,
				label: 'graphify-linked [api-high]'
			};
			const sig = edgeSignature(edge);
			if (!edgeSeen.has(sig)) {
				edgeSeen.add(sig);
				edges.push(edge);
				addedEdges++;
			}
		}
	}

	for (let i = 0; i < edges.length; i++) {
		edges[i].id = `e:${i}`;
	}

	options.output?.appendLine(
		`circuit graphify enrich applied: +${addedNodes} nodes, +${addedEdges} edges (${options.scope})`
	);

	return { nodes, edges };
}

async function loadGraphifyGraph(document: vscode.TextDocument): Promise<LoadedGraphifyGraph | undefined> {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!workspaceFolder) {
		return undefined;
	}
	const graphPath = path.resolve(workspaceFolder.uri.fsPath, 'graphify-out', 'graph.json');
	const graphUri = vscode.Uri.file(graphPath);
	let stats: vscode.FileStat;
	let bytes: Uint8Array;
	try {
		[stats, bytes] = await Promise.all([vscode.workspace.fs.stat(graphUri), vscode.workspace.fs.readFile(graphUri)]);
	} catch {
		return undefined;
	}

	const cacheKey = normalizeFsPath(graphPath);
	const cached = graphCache.get(cacheKey);
	if (cached && cached.mtime === stats.mtime) {
		return cached;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return undefined;
	}

	const graph = parsed as Partial<GraphifyGraph>;
	if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
		return undefined;
	}

	const byId = new Map<string, GraphifyNode>();
	const bySourceFile = new Map<string, GraphifyNode[]>();
	for (const node of graph.nodes) {
		if (!node || typeof node.id !== 'string') {
			continue;
		}
		if (typeof node.source_file === 'string' && isDeclarationFilePath(node.source_file)) {
			continue;
		}
		byId.set(node.id, node);
		if (typeof node.source_file === 'string' && node.source_file.trim()) {
			const key = normalizeFsPath(node.source_file);
			const arr = bySourceFile.get(key) ?? [];
			arr.push(node);
			bySourceFile.set(key, arr);
		}
	}

	const loaded: LoadedGraphifyGraph = {
		graph: {
			nodes: graph.nodes as GraphifyNode[],
			links: graph.links as GraphifyLink[]
		},
		byId,
		bySourceFile,
		path: graphPath,
		mtime: stats.mtime
	};
	graphCache.set(cacheKey, loaded);
	return loaded;
}

function mapCircuitNodesToGraphify(nodes: CircuitNode[], loaded: LoadedGraphifyGraph): Map<string, Set<string>> {
	const mapped = new Map<string, Set<string>>();
	for (const node of nodes) {
		const sourceFile = node.uri ? tryGetFsPath(node.uri) : undefined;
		if (!sourceFile) {
			continue;
		}
		if (isDeclarationFilePath(sourceFile)) {
			continue;
		}
		const candidates = loaded.bySourceFile.get(normalizeFsPath(sourceFile)) ?? [];
		if (!candidates.length) {
			continue;
		}

		const chosen = selectGraphifyCandidates(node, candidates);
		if (!chosen.length) {
			continue;
		}
		mapped.set(
			node.id,
			new Set(
				chosen
					.map((item) => item.id)
					.filter((id): id is string => typeof id === 'string' && id.length > 0)
			)
		);
	}
	return mapped;
}

function selectGraphifyCandidates(node: CircuitNode, candidates: GraphifyNode[]): GraphifyNode[] {
	const normalizedLabel = normalizeSymbol(node.label);
	const lineOneBased = typeof node.line === 'number' ? node.line + 1 : undefined;

	const exactLabelAndLine = candidates.filter((candidate) => {
		if (!normalizedLabel) {
			return false;
		}
		const candidateLabel = normalizeSymbol(candidate.norm_label || candidate.label || '');
		const parsedLine = parseLine(candidate.source_location);
		return candidateLabel === normalizedLabel && parsedLine !== undefined && parsedLine === lineOneBased;
	});
	if (exactLabelAndLine.length) {
		return exactLabelAndLine.slice(0, 2);
	}

	const nearestLine = candidates
		.filter((candidate) => typeof lineOneBased === 'number' && typeof parseLine(candidate.source_location) === 'number')
		.sort((a, b) => {
			const da = Math.abs((parseLine(a.source_location) || 0) - (lineOneBased || 0));
			const db = Math.abs((parseLine(b.source_location) || 0) - (lineOneBased || 0));
			return da - db;
		})
		.filter((candidate) => Math.abs((parseLine(candidate.source_location) || 0) - (lineOneBased || 0)) <= 3);
	if (nearestLine.length) {
		return nearestLine.slice(0, 2);
	}

	const fileNodes = candidates.filter((candidate) => {
		const text = String(candidate.label || '').toLowerCase();
		return text.endsWith('.ts') || text.endsWith('.tsx') || text.endsWith('.js') || text.endsWith('.jsx');
	});
	return fileNodes.slice(0, 1);
}

function invertNodeMapping(mapped: Map<string, Set<string>>): Map<string, Set<string>> {
	const inverted = new Map<string, Set<string>>();
	for (const [circuitId, graphIds] of mapped) {
		for (const graphId of graphIds) {
			const set = inverted.get(graphId) ?? new Set<string>();
			set.add(circuitId);
			inverted.set(graphId, set);
		}
	}
	return inverted;
}

function pickAnchorCircuitNodes(nodes: CircuitNode[], document: vscode.TextDocument): string[] {
	const docUri = document.uri.toString();
	const sameFileNodes = nodes.filter((node) => node.uri === docUri);
	if (sameFileNodes.length) {
		const functionNodes = sameFileNodes.filter((node) => node.type === 'function');
		if (functionNodes.length) {
			return functionNodes.slice(0, 4).map((node) => node.id);
		}
		return sameFileNodes.slice(0, 2).map((node) => node.id);
	}
	return nodes.slice(0, 1).map((node) => node.id);
}

function rankRelatedFiles(anchorGraphIds: Set<string>, loaded: LoadedGraphifyGraph): Array<{ path: string; normalizedPath: string; score: number }> {
	const scores = new Map<string, number>();
	for (const link of loaded.graph.links) {
		const sourceIsAnchor = anchorGraphIds.has(link.source);
		const targetIsAnchor = anchorGraphIds.has(link.target);
		if (!sourceIsAnchor && !targetIsAnchor) {
			continue;
		}
		const oppositeId = sourceIsAnchor ? link.target : link.source;
		const oppositeNode = loaded.byId.get(oppositeId);
		const sourceFile = oppositeNode?.source_file;
		if (!sourceFile) {
			continue;
		}
		if (isDeclarationFilePath(sourceFile)) {
			continue;
		}
		const key = normalizeFsPath(sourceFile);
		const current = scores.get(key) ?? 0;
		scores.set(key, current + relationWeight(link.relation));
	}

	return Array.from(scores.entries())
		.map(([normalizedPath, score]) => ({
			path: denormalizeFsPath(normalizedPath),
			normalizedPath,
			score
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, 8);
}

function relationWeight(relation?: string): number {
	const text = (relation || '').toLowerCase();
	if (text.includes('calls')) {
		return 3;
	}
	if (text.includes('imports')) {
		return 2;
	}
	return 1;
}

function relationToKind(relation?: string): 'architecture' | 'runtime' {
	const text = (relation || '').toLowerCase();
	if (text.includes('imports') || text.includes('contains')) {
		return 'architecture';
	}
	return 'runtime';
}

function buildGraphifyLabel(relation?: string): string {
	const normalized = (relation || 'related').trim().toLowerCase();
	return `${normalized} [graphify-high]`;
}

function edgeSignature(edge: Pick<CircuitEdge, 'from' | 'to' | 'kind' | 'label'>): string {
	return `${edge.kind ?? 'runtime'}:${edge.from}->${edge.to}:${(edge.label || '').toLowerCase()}`;
}

function parseLine(sourceLocation?: string): number | undefined {
	if (!sourceLocation) {
		return undefined;
	}
	const m = sourceLocation.match(/L(\d+)/i);
	if (!m?.[1]) {
		return undefined;
	}
	const line = Number.parseInt(m[1], 10);
	return Number.isFinite(line) ? line : undefined;
}

function normalizeSymbol(value: string): string {
	return String(value || '')
		.toLowerCase()
		.replace(/[^\w]/g, '');
}

function normalizeFsPath(filePath: string): string {
	return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function isDeclarationFilePath(filePath: string): boolean {
	return /\.d\.ts$/i.test(String(filePath).replace(/\\/g, '/').toLowerCase());
}

function denormalizeFsPath(filePath: string): string {
	return filePath.replace(/\//g, path.sep);
}

function tryGetFsPath(uriString: string): string | undefined {
	try {
		return vscode.Uri.parse(uriString).fsPath;
	} catch {
		return undefined;
	}
}
