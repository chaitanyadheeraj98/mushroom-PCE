import * as vscode from 'vscode';

import { requestModelText } from '../../ai/requestModelText';
import { CircuitGraph } from '../../../shared/types/circuitTypes';

export async function explainCircuitNodeRelationWithAi(
	model: vscode.LanguageModelChat,
	graph: CircuitGraph,
	fromNodeId: string,
	toNodeId: string
): Promise<string | undefined> {
	const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
	const fromNode = byId.get(fromNodeId);
	const toNode = byId.get(toNodeId);
	if (!fromNode || !toNode) {
		return undefined;
	}

	const localEdges = graph.edges.filter(
		(edge) => edge.from === fromNodeId || edge.to === fromNodeId || edge.from === toNodeId || edge.to === toNodeId
	);
	const shortestPath = findShortestPath(graph, fromNodeId, toNodeId);

	const prompt = `
You are a software architecture assistant helping explain graph relationships.

TASK:
Explain how node A relates to node B.

RESPONSE STYLE:
- Use concise markdown bullets.
- Include:
  1) direct relation status
  2) likely flow/dependency interpretation
  3) risks/impact if either node changes
  4) one practical next debugging/refactor step
- Keep under 12 bullets total.

NODE A:
${JSON.stringify({
	id: fromNode.id,
	label: fromNode.label,
	type: fromNode.type,
	layer: fromNode.layer,
	detail: fromNode.detail
})}

NODE B:
${JSON.stringify({
	id: toNode.id,
	label: toNode.label,
	type: toNode.type,
	layer: toNode.layer,
	detail: toNode.detail
})}

LOCAL EDGES:
${JSON.stringify(localEdges)}

SHORTEST PATH (by node ids, directed):
${JSON.stringify(shortestPath ?? [])}
`;

	return requestModelText(model, prompt);
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

