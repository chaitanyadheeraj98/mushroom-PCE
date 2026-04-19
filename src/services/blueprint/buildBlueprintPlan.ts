import * as vscode from 'vscode';

import { requestModelText } from '../ai/requestModelText';
import { CircuitGraph, CircuitLayer, CircuitNode, CircuitNodeType } from '../../shared/types/circuitTypes';
import { BlueprintWorkspaceSnapshot } from './scanWorkspaceBlueprint';

export type BlueprintNodeKind = 'existing-reuse' | 'new-file' | 'new-function' | 'modify-function' | 'test' | 'risk';

export type BlueprintPlanNode = {
	id: string;
	kind: BlueprintNodeKind;
	label: string;
	path?: string;
	details: string;
	reason?: string;
	dependsOn: string[];
};

export type BlueprintPlanResult = {
	title: string;
	explanation: string;
	nodes: BlueprintPlanNode[];
	graph: CircuitGraph;
};

type BlueprintEnvelope = {
	title?: string;
	explanation?: string;
	nodes?: Array<{
		id?: string;
		kind?: string;
		label?: string;
		path?: string;
		details?: string;
		reason?: string;
		dependsOn?: string[];
	}>;
};

const VALID_KINDS: BlueprintNodeKind[] = [
	'existing-reuse',
	'new-file',
	'new-function',
	'modify-function',
	'test',
	'risk'
];

export async function generateBlueprintPlan(
	model: vscode.LanguageModelChat,
	featureRequest: string,
	workspace: BlueprintWorkspaceSnapshot,
	history: Array<{ role: 'user' | 'assistant'; text: string }>,
	signal?: AbortSignal
): Promise<BlueprintPlanResult> {
	const prompt = buildBlueprintPrompt(featureRequest, workspace, history);
	const response = await requestModelText(model, prompt, { signal });
	const parsed = parseBlueprintEnvelope(response || '');
	const nodes = normalizePlanNodes(parsed?.nodes || []);
	const title = String(parsed?.title || featureRequest).trim() || 'Blueprint Plan';
	const explanation = String(parsed?.explanation || '').trim() || 'No explanation provided.';
	return {
		title,
		explanation,
		nodes,
		graph: buildBlueprintGraph(nodes, workspace)
	};
}

export async function askBlueprintChat(
	model: vscode.LanguageModelChat,
	question: string,
	currentPlan: BlueprintPlanResult | undefined,
	workspace: BlueprintWorkspaceSnapshot,
	history: Array<{ role: 'user' | 'assistant'; text: string }>,
	signal?: AbortSignal
): Promise<string> {
	const contextLines = currentPlan
		? [
			`Plan Title: ${currentPlan.title}`,
			`Plan Nodes: ${currentPlan.nodes.length}`,
			...currentPlan.nodes.slice(0, 120).map((node) => `- [${node.kind}] ${node.label}${node.path ? ` @ ${node.path}` : ''}: ${node.details}`)
		]
		: ['No plan has been generated yet.'];

	const prompt = [
		'You are Blueprint Assistant in a VS Code extension.',
		'Answer with practical implementation guidance using concise markdown bullets.',
		'If the question implies plan changes, propose precise node updates (reuse/new-file/new-function/modify-function/test/risk).',
		'Use the workspace snapshot and current plan context only.',
		'',
		`Workspace: ${workspace.workspaceName}`,
		`Source Root: ${workspace.srcRootPath}`,
		`Known files: ${workspace.entries.length}`,
		'',
		'Current Plan Context:',
		...contextLines,
		'',
		'Recent Chat:',
		...history.slice(-12).map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`),
		'',
		`User Question: ${question}`
	].join('\n');

	const response = await requestModelText(model, prompt, { signal });
	return String(response || '').trim() || 'No response generated.';
}

function buildBlueprintPrompt(
	featureRequest: string,
	workspace: BlueprintWorkspaceSnapshot,
	history: Array<{ role: 'user' | 'assistant'; text: string }>
): string {
	const conciseFiles = workspace.files.slice(0, 240).map((file) => ({
		path: file.path,
		exports: file.exports.slice(0, 20),
		functions: file.functions.slice(0, 20)
	}));
	const folderSample = workspace.entries.slice(0, 600);

	return [
		'You are Blueprint Planner for a VS Code extension.',
		'Create a plan-only implementation blueprint for a new feature request.',
		'',
		'REQUIRED NODE KINDS:',
		'- existing-reuse',
		'- new-file',
		'- new-function',
		'- modify-function',
		'- test',
		'- risk',
		'',
		'RULES:',
		'- Use only paths under src/.',
		'- Prefer existing-reuse nodes before proposing new files/functions.',
		'- Every node must be actionable and concise.',
		'- Keep graph acyclic with dependsOn IDs.',
		'- Return valid JSON only.',
		'',
		'JSON SCHEMA:',
		'{',
		'  "title": "string",',
		'  "explanation": "markdown explanation of implementation flow",',
		'  "nodes": [',
		'    {',
		'      "id": "string",',
		'      "kind": "existing-reuse|new-file|new-function|modify-function|test|risk",',
		'      "label": "string",',
		'      "path": "src/...",',
		'      "details": "string",',
		'      "reason": "string",',
		'      "dependsOn": ["id1","id2"]',
		'    }',
		'  ]',
		'}',
		'',
		`Feature Request: ${featureRequest}`,
		'',
		'Recent Chat Context:',
		...history.slice(-12).map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`),
		'',
		`Workspace: ${workspace.workspaceName}`,
		`Source Root: ${workspace.srcRootPath}`,
		'Folder Entries (sample):',
		JSON.stringify(folderSample),
		'',
		'Known File Insights (sample):',
		JSON.stringify(conciseFiles)
	].join('\n');
}

function parseBlueprintEnvelope(text: string): BlueprintEnvelope | undefined {
	const trimmed = String(text || '').trim();
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

function safeJson(raw: string): BlueprintEnvelope | undefined {
	try {
		const parsed = JSON.parse(raw) as BlueprintEnvelope;
		if (!parsed || typeof parsed !== 'object') {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

function normalizePlanNodes(input: BlueprintEnvelope['nodes']): BlueprintPlanNode[] {
	const seen = new Set<string>();
	const nodes: BlueprintPlanNode[] = [];
	const fallbackPrefix = 'bp';
	for (let i = 0; i < (input?.length || 0); i++) {
		const raw = input?.[i];
		if (!raw) {
			continue;
		}
		const kind = VALID_KINDS.includes(raw.kind as BlueprintNodeKind)
			? (raw.kind as BlueprintNodeKind)
			: 'modify-function';
		const label = String(raw.label || '').trim();
		const details = String(raw.details || '').trim();
		if (!label || !details) {
			continue;
		}
		let id = String(raw.id || '').trim() || `${fallbackPrefix}${i + 1}`;
		id = id.replace(/[^\w.-]/g, '_');
		if (seen.has(id)) {
			id = `${id}_${i + 1}`;
		}
		seen.add(id);
		const dependsOn = Array.isArray(raw.dependsOn)
			? raw.dependsOn.map((value) => String(value || '').trim()).filter(Boolean)
			: [];
		const path = String(raw.path || '').trim();
		nodes.push({
			id,
			kind,
			label,
			path: path.startsWith('src/') ? path : (path ? `src/${path.replace(/^\/+/, '')}` : undefined),
			details,
			reason: String(raw.reason || '').trim() || undefined,
			dependsOn
		});
	}

	if (!nodes.length) {
		return [
			{
				id: 'bp1',
				kind: 'risk',
				label: 'Insufficient blueprint output',
				path: 'src',
				details: 'AI did not return valid structured nodes. Re-run with a more specific feature request.',
				dependsOn: []
			}
		];
	}

	const validIds = new Set(nodes.map((node) => node.id));
	for (const node of nodes) {
		node.dependsOn = node.dependsOn.filter((id) => validIds.has(id) && id !== node.id);
	}

	return nodes;
}

function buildBlueprintGraph(nodes: BlueprintPlanNode[], workspace: BlueprintWorkspaceSnapshot): CircuitGraph {
	const graphNodes: CircuitNode[] = [];
	const edges: CircuitGraph['edges'] = [];
	const nodeById = new Map<string, CircuitNode>();

	const rootId = 'blueprint:root';
	const rootNode: CircuitNode = {
		id: rootId,
		type: 'module',
		layer: 'system',
		groupId: 'group:blueprint',
		label: `${workspace.workspaceName} Blueprint`,
		detail: 'Blueprint root (plan-only implementation graph)'
	};
	graphNodes.push(rootNode);
	nodeById.set(rootId, rootNode);

	for (let i = 0; i < nodes.length; i++) {
		const planNode = nodes[i];
		const nodeId = `blueprint:${planNode.id}`;
		const mapped = mapPlanNode(planNode);
		const node: CircuitNode = {
			id: nodeId,
			type: mapped.type,
			layer: mapped.layer,
			groupId: 'group:blueprint',
			label: planNode.label,
			detail: `${planNode.kind}${planNode.path ? ` | ${planNode.path}` : ''} | ${planNode.details}`
		};
		graphNodes.push(node);
		nodeById.set(nodeId, node);
		edges.push({
			id: `bp:e:${edges.length}`,
			kind: 'architecture',
			from: rootId,
			to: nodeId,
			label: planNode.kind
		});
		edges.push({
			id: `bp:e:${edges.length}`,
			kind: 'runtime',
			from: rootId,
			to: nodeId,
			label: planNode.kind
		});
	}

	for (let i = 0; i < nodes.length; i++) {
		const fromNode = nodes[i];
		const fromId = `blueprint:${fromNode.id}`;
		for (const depId of fromNode.dependsOn) {
			const toId = `blueprint:${depId}`;
			if (!nodeById.has(toId)) {
				continue;
			}
			edges.push({
				id: `bp:e:${edges.length}`,
				kind: 'runtime',
				from: toId,
				to: fromId,
				label: 'depends-on [blueprint]'
			});
			edges.push({
				id: `bp:e:${edges.length}`,
				kind: 'architecture',
				from: toId,
				to: fromId,
				label: 'depends-on [blueprint]'
			});
		}
	}

	return { nodes: graphNodes, edges };
}

function mapPlanNode(planNode: BlueprintPlanNode): { type: CircuitNodeType; layer: CircuitLayer } {
	switch (planNode.kind) {
		case 'existing-reuse':
			return { type: 'function', layer: 'utility' };
		case 'new-file':
			return { type: 'module', layer: 'feature' };
		case 'new-function':
			return { type: 'function', layer: 'orchestration' };
		case 'modify-function':
			return { type: 'function', layer: 'command' };
		case 'test':
			return { type: 'utility', layer: 'state' };
		case 'risk':
			return { type: 'state', layer: 'ui' };
		default:
			return { type: 'function', layer: 'feature' };
	}
}
