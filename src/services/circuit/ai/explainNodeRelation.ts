import * as vscode from 'vscode';

import { requestModelText } from '../../ai/requestModelText';
import { CircuitGraph } from '../../../shared/types/circuitTypes';

export type CircuitRelationExplainRequest = {
	fromNodeId?: string;
	toNodeId?: string;
	userPrompt?: string;
	extraContextText?: string;
};

export async function explainCircuitNodeRelationWithAi(
	model: vscode.LanguageModelChat,
	graph: CircuitGraph,
	request: CircuitRelationExplainRequest,
	signal?: AbortSignal
): Promise<string | undefined> {
	const fromNodeId = typeof request.fromNodeId === 'string' ? request.fromNodeId : undefined;
	const toNodeId = typeof request.toNodeId === 'string' ? request.toNodeId : undefined;
	const userPrompt = String(request.userPrompt || '').trim();
	const extraContextText = String(request.extraContextText || '').trim();
	const hasPair = Boolean(fromNodeId && toNodeId && fromNodeId !== toNodeId);
	if (!hasPair && !userPrompt) {
		return undefined;
	}

	const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
	const fromNode = hasPair && fromNodeId ? byId.get(fromNodeId) : undefined;
	const toNode = hasPair && toNodeId ? byId.get(toNodeId) : undefined;
	if (hasPair && (!fromNode || !toNode)) {
		return undefined;
	}

	const localEdges =
		hasPair && fromNodeId && toNodeId
			? graph.edges.filter(
					(edge) => edge.from === fromNodeId || edge.to === fromNodeId || edge.from === toNodeId || edge.to === toNodeId
			  )
			: [];
	const shortestPath = hasPair && fromNodeId && toNodeId ? findShortestPath(graph, fromNodeId, toNodeId) : undefined;
	const graphSummary = buildGraphSummary(graph);

	const prompt = `
You are a software architecture assistant helping explain graph relationships.

TASK:
${hasPair ? 'Explain how node A relates to node B.' : 'Answer the user question about this graph clearly and concretely.'}

RESPONSE STYLE:
- Use concise markdown bullets.
- Include:
  1) most relevant relation/dependency status
  2) likely flow/dependency interpretation
  3) risks/impact if affected nodes change
  4) one practical next debugging/refactor step
- Keep under 12 bullets total.

${hasPair ? `NODE A:
${JSON.stringify({
	id: fromNode!.id,
	label: fromNode!.label,
	type: fromNode!.type,
	layer: fromNode!.layer,
	detail: fromNode!.detail
})}` : ''}

${hasPair ? `NODE B:
${JSON.stringify({
	id: toNode!.id,
	label: toNode!.label,
	type: toNode!.type,
	layer: toNode!.layer,
	detail: toNode!.detail
})}` : ''}

${hasPair ? `LOCAL EDGES:
${JSON.stringify(localEdges)}

SHORTEST PATH (by node ids, directed):
${JSON.stringify(shortestPath ?? [])}` : ''}

USER QUESTION:
${userPrompt || '(none provided; infer the most useful relation summary from graph context)'}

GRAPH SUMMARY:
${graphSummary}

${extraContextText ? `EXTRA CONTEXT FROM /read:
${extraContextText}` : ''}
`;

	return requestModelText(model, prompt, { signal });
}

function buildGraphSummary(graph: CircuitGraph): string {
	const nodeItems = graph.nodes.slice(0, 80).map((node) => ({
		id: node.id,
		label: node.label,
		type: node.type,
		layer: node.layer
	}));
	const edgeItems = graph.edges.slice(0, 140).map((edge) => ({
		from: edge.from,
		to: edge.to,
		kind: edge.kind,
		label: edge.label
	}));
	return JSON.stringify({
		nodeCount: graph.nodes.length,
		edgeCount: graph.edges.length,
		nodes: nodeItems,
		edges: edgeItems
	});
}

function findShortestPath(graph: CircuitGraph, fromId: string, toId: string): string[] | undefined {
	if (fromId === toId) {
		return [fromId];
	}

	const outgoing = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const list = outgoing.get(edge.from) ?? [];
		list.push(edge.to);
		outgoing.set(edge.from, list);
	}

	const queue: string[] = [fromId];
	const prev = new Map<string, string>();
	const visited = new Set<string>([fromId]);
	let head = 0;
	while (head < queue.length) {
		const current = queue[head++];
		const nextList = outgoing.get(current) ?? [];
		for (let i = 0; i < nextList.length; i++) {
			const next = nextList[i];
			if (visited.has(next)) {
				continue;
			}
			visited.add(next);
			prev.set(next, current);
			if (next === toId) {
				const path = [toId];
				let walker = toId;
				while (prev.has(walker)) {
					walker = prev.get(walker)!;
					path.push(walker);
				}
				path.reverse();
				return path;
			}
			queue.push(next);
		}
	}
	return undefined;
}

