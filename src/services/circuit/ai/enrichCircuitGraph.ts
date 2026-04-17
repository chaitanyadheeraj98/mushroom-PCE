import * as vscode from 'vscode';

import { requestModelText } from '../../ai/requestModelText';
import { CircuitAiEnrichmentResult, CircuitAiSuggestedEdge, CircuitGraph } from '../../../shared/types/circuitTypes';

type EnrichmentEnvelope = {
	nodeSummaries?: Array<{ nodeId?: string; summary?: string; confidence?: number }>;
	insights?: Array<{ title?: string; detail?: string; confidence?: number }>;
	suggestedEdges?: Array<{
		from?: string;
		to?: string;
		kind?: string;
		label?: string;
		confidence?: number;
		reason?: string;
	}>;
};

export async function enrichCircuitGraphWithAi(
	model: vscode.LanguageModelChat,
	graph: CircuitGraph
): Promise<CircuitAiEnrichmentResult | undefined> {
	const compact = buildCompactGraphContext(graph);
	if (!compact.nodes.length) {
		return {
			nodeSummaries: [],
			insights: [],
			suggestedEdges: [],
			modelLabel: model.name,
			generatedAt: Date.now()
		};
	}

	const prompt = buildPrompt(compact);
	const response = await requestModelText(model, prompt);
	const parsed = tryParseEnvelope(response || '');
	if (!parsed) {
		return undefined;
	}

	const validNodeIds = new Set(graph.nodes.map((node) => node.id));
	const nodeSummaries = (parsed.nodeSummaries ?? [])
		.map((item) => ({
			nodeId: String(item.nodeId || '').trim(),
			summary: String(item.summary || '').trim(),
			confidence: normalizeConfidence(item.confidence)
		}))
		.filter((item) => item.nodeId && item.summary && validNodeIds.has(item.nodeId))
		.slice(0, 120);

	const insights = (parsed.insights ?? [])
		.map((item) => ({
			title: String(item.title || '').trim(),
			detail: String(item.detail || '').trim(),
			confidence: normalizeConfidence(item.confidence)
		}))
		.filter((item) => item.title && item.detail)
		.slice(0, 12);

	const existingEdgeKey = new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind ?? 'runtime'}`));
	const suggestedEdges: CircuitAiSuggestedEdge[] = (parsed.suggestedEdges ?? [])
		.map((item) => ({
			from: String(item.from || '').trim(),
			to: String(item.to || '').trim(),
			kind: (item.kind === 'architecture' ? 'architecture' : 'runtime') as 'architecture' | 'runtime',
			label: String(item.label || 'ai-suggested').trim(),
			confidence: normalizeConfidence(item.confidence),
			reason: String(item.reason || '').trim()
		}))
		.filter(
			(item) =>
				item.from &&
				item.to &&
				item.from !== item.to &&
				validNodeIds.has(item.from) &&
				validNodeIds.has(item.to) &&
				!existingEdgeKey.has(`${item.from}->${item.to}:${item.kind}`)
		)
		.slice(0, 30);

	return {
		nodeSummaries,
		insights,
		suggestedEdges,
		modelLabel: model.name,
		generatedAt: Date.now()
	};
}

function buildCompactGraphContext(graph: CircuitGraph): {
	nodes: Array<{ id: string; label: string; type: string; layer?: string; detail?: string }>;
	edges: Array<{ from: string; to: string; kind: string; label?: string }>;
} {
	const nodes = graph.nodes
		.slice(0, 140)
		.map((node) => ({
			id: node.id,
			label: String(node.label || '').slice(0, 80),
			type: node.type,
			layer: node.layer,
			detail: String(node.detail || '').slice(0, 140)
		}));

	const validIds = new Set(nodes.map((node) => node.id));
	const edges = graph.edges
		.filter((edge) => validIds.has(edge.from) && validIds.has(edge.to))
		.slice(0, 260)
		.map((edge) => ({
			from: edge.from,
			to: edge.to,
			kind: edge.kind ?? 'runtime',
			label: edge.label
		}));

	return { nodes, edges };
}

function buildPrompt(compact: {
	nodes: Array<{ id: string; label: string; type: string; layer?: string; detail?: string }>;
	edges: Array<{ from: string; to: string; kind: string; label?: string }>;
}): string {
	return `
You are an expert software architecture assistant.

TASK:
Analyze this circuit graph and return JSON ONLY with:
{
  "nodeSummaries": [{ "nodeId": string, "summary": string, "confidence": number }],
  "insights": [{ "title": string, "detail": string, "confidence": number }],
  "suggestedEdges": [
    {
      "from": string,
      "to": string,
      "kind": "runtime" | "architecture",
      "label": string,
      "confidence": number,
      "reason": string
    }
  ]
}

RULES:
- Output valid JSON only (no markdown, no commentary).
- Keep node summaries concise (max ~18 words).
- Confidence range must be 0..1.
- Summarize only node IDs that exist in input.
- Provide up to 10 high-value insights (hotspots, entry points, high fan-in/fan-out, risk coupling).
- Suggested edges must only use existing node IDs from input.
- Suggest only meaningful missing relationships, not duplicates.
- Keep reason short and concrete.

GRAPH:
${JSON.stringify(compact)}
`;
}

function tryParseEnvelope(text: string): EnrichmentEnvelope | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}

	const direct = safeJson(trimmed);
	if (direct) {
		return direct;
	}

	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) {
		return safeJson(fenced[1].trim());
	}

	const first = trimmed.indexOf('{');
	const last = trimmed.lastIndexOf('}');
	if (first >= 0 && last > first) {
		return safeJson(trimmed.slice(first, last + 1));
	}

	return undefined;
}

function safeJson(raw: string): EnrichmentEnvelope | undefined {
	try {
		const parsed = JSON.parse(raw) as EnrichmentEnvelope;
		if (!parsed || typeof parsed !== 'object') {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

function normalizeConfidence(value: unknown): number {
	const num = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(num)) {
		return 0.5;
	}
	if (num < 0) {
		return 0;
	}
	if (num > 1) {
		return 1;
	}
	return Math.round(num * 100) / 100;
}
