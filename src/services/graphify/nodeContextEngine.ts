import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

import { CircuitNode, NodeGraphifyEvidenceResult } from '../../shared/types/circuitTypes';

type NodeContextScope = 'current-file' | 'full-architecture' | 'codeflow';

type NodeContextEngineInput = {
	workspaceFsPath: string;
	graphFsPath: string;
	scope: NodeContextScope;
	node: CircuitNode;
	targetNode?: CircuitNode;
	output?: vscode.OutputChannel;
	signal?: AbortSignal;
};

type GraphifyCommandResult = {
	success: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

type CachedNodeEvidence = {
	graphMtime: number;
	result: NodeGraphifyEvidenceResult;
};

const QUERY_VERSION = 'v1';
const MAX_QUERY_CALLS = 6;
const MAX_PATH_CALLS = 3;
const CLI_TIMEOUT_MS = 3500;
const EVIDENCE_CHAR_BUDGET = 4800; // ~1200 tokens equivalent

const evidenceCache = new Map<string, CachedNodeEvidence>();

export async function getNodeGraphifyEvidence(input: NodeContextEngineInput): Promise<NodeGraphifyEvidenceResult> {
	const nodeLabel = normalizeSymbol(input.node.label);
	if (!nodeLabel) {
		return fallback('Empty node label; using structural fallback.');
	}

	const graphStat = await safeStat(input.graphFsPath);
	if (!graphStat) {
		input.output?.appendLine('graphify node context fallback: graph file unavailable');
		return fallback('graphify-out/graph.json unavailable; using structural fallback.');
	}

	const cacheKey = buildCacheKey(input, graphStat.mtime);
	const cached = evidenceCache.get(cacheKey);
	if (cached && cached.graphMtime === graphStat.mtime) {
		input.output?.appendLine(`node context cache hit: ${nodeLabel} (${input.scope})`);
		return cached.result;
	}
	input.output?.appendLine(`node context cache miss: ${nodeLabel} (${input.scope})`);

	const queryTexts = buildAdaptiveQueries(input.node, input.scope).slice(0, MAX_QUERY_CALLS);
	const pathPairs = buildPathPairs(input.node, input.targetNode, input.scope).slice(0, MAX_PATH_CALLS);

	let executedQueries = 0;
	let executedPaths = 0;
	const incoming: NodeGraphifyEvidenceResult['incoming'] = [];
	const outgoing: NodeGraphifyEvidenceResult['outgoing'] = [];
	const paths: NodeGraphifyEvidenceResult['paths'] = [];
	const fileScores = new Map<string, number>();
	const evidenceSections: string[] = [];
	const failures: string[] = [];

	for (const query of queryTexts) {
		if (input.signal?.aborted) {
			return fallback('Graphify evidence request aborted.');
		}
		const result = await runGraphifyGraphCommand(['query', query, '--graph', input.graphFsPath], input.workspaceFsPath, input.signal);
		executedQueries++;
		if (!result.success) {
			failures.push(`query "${query}" failed (${formatReason(result)})`);
			continue;
		}
		const cleaned = result.stdout.trim();
		if (!cleaned || /^No matching nodes found\.?$/i.test(cleaned)) {
			continue;
		}
		evidenceSections.push(`Query: ${query}\n${capText(cleaned, 900)}`);
		collectNeighborEvidence(cleaned, query, incoming, outgoing, fileScores);
	}

	for (const pair of pathPairs) {
		if (input.signal?.aborted) {
			return fallback('Graphify evidence request aborted.');
		}
		const result = await runGraphifyGraphCommand(
			['path', pair.from, pair.to, '--graph', input.graphFsPath],
			input.workspaceFsPath,
			input.signal
		);
		executedPaths++;
		if (!result.success) {
			failures.push(`path "${pair.from}" -> "${pair.to}" failed (${formatReason(result)})`);
			continue;
		}
		const cleaned = result.stdout.trim();
		if (!cleaned || /^No path found\.?$/i.test(cleaned) || /^No matching nodes found\.?$/i.test(cleaned)) {
			continue;
		}
		paths.push({
			from: pair.from,
			to: pair.to,
			summary: summarizePath(cleaned),
			source: `path:${pair.from}->${pair.to}`
		});
		evidenceSections.push(`Path: ${pair.from} -> ${pair.to}\n${capText(cleaned, 800)}`);
		collectFileMentions(cleaned, fileScores);
	}

	const topLinkedFiles = Array.from(fileScores.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([file, score]) => ({ path: file, score, source: 'graphify' }));

	const compactText = capText(evidenceSections.join('\n\n'), EVIDENCE_CHAR_BUDGET);
	const hasEvidence =
		incoming.length > 0 ||
		outgoing.length > 0 ||
		paths.length > 0 ||
		topLinkedFiles.length > 0 ||
		compactText.trim().length > 0;

	if (!hasEvidence) {
		const reason = failures[0] || 'No node-specific query/path evidence found.';
		input.output?.appendLine(
			`node context fallback: ${nodeLabel} (${input.scope}) q=${executedQueries}/${queryTexts.length} p=${executedPaths}/${pathPairs.length}; ${reason}`
		);
		return fallback('Graphify node evidence unavailable; using structural fallback.');
	}

	const summary = [
		`Node evidence for "${input.node.label}"`,
		`incoming=${incoming.length}, outgoing=${outgoing.length}, paths=${paths.length}, files=${topLinkedFiles.length}`,
		`scope=${input.scope}`
	].join(' | ');

	const result: NodeGraphifyEvidenceResult = {
		incoming: incoming.slice(0, 10),
		outgoing: outgoing.slice(0, 10),
		paths: paths.slice(0, 6),
		topLinkedFiles: topLinkedFiles.slice(0, 5),
		summary,
		status: 'ok',
		compactText
	};
	evidenceCache.set(cacheKey, { graphMtime: graphStat.mtime, result });
	input.output?.appendLine(
		`node context ok: ${nodeLabel} (${input.scope}) q=${executedQueries}/${queryTexts.length} p=${executedPaths}/${pathPairs.length}`
	);
	return result;
}

function buildAdaptiveQueries(node: CircuitNode, scope: NodeContextScope): string[] {
	const label = normalizeSymbol(node.label);
	const fileName = node.uri ? path.basename(vscode.Uri.parse(node.uri).fsPath) : '';
	const lowerType = String(node.type || '').toLowerCase();

	const base = [
		`what calls ${label}?`,
		`what does ${label} call?`,
		`what connects ${label} to ${fileName || 'this file'}?`,
		`show architecture flow for ${label}`,
		`what modules depend on ${label}?`,
		`what imports connect to ${label}?`
	];

	if (lowerType === 'module') {
		return unique([
			`what modules depend on ${label}?`,
			`show architecture flow for ${label}`,
			`what connects ${label} to ${scope}?`,
			`what does ${label} call?`,
			`what calls ${label}?`,
			`what files import ${label}?`
		]);
	}

	if (lowerType === 'class') {
		return unique([
			`what calls ${label}?`,
			`what does ${label} call?`,
			`what connects ${label} to ${fileName || 'the codebase'}?`,
			`show architecture flow for ${label}`,
			`what methods from ${label} are used?`,
			`what modules depend on ${label}?`
		]);
	}

	if (lowerType === 'function') {
		return unique(base);
	}

	return unique([
		`what connects ${label} to ${fileName || 'the codebase'}?`,
		`what calls ${label}?`,
		`what does ${label} call?`,
		`show architecture flow for ${label}`,
		`what modules depend on ${label}?`,
		`what imports connect to ${label}?`
	]);
}

function buildPathPairs(node: CircuitNode, targetNode: CircuitNode | undefined, scope: NodeContextScope): Array<{ from: string; to: string }> {
	const from = normalizeSymbol(node.label);
	const to = targetNode ? normalizeSymbol(targetNode.label) : '';
	return uniquePairs([
		to && to !== from ? { from, to } : undefined,
		{ from, to: 'requestModelText' },
		scope === 'codeflow' ? { from, to: 'Context Bot' } : undefined
	]);
}

function collectNeighborEvidence(
	outputText: string,
	query: string,
	incoming: NodeGraphifyEvidenceResult['incoming'],
	outgoing: NodeGraphifyEvidenceResult['outgoing'],
	fileScores: Map<string, number>
): void {
	const lines = outputText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 20);
	collectFileMentions(outputText, fileScores);
	const relation = query.toLowerCase().includes('what calls') ? 'calls->node' : 'node->calls';
	for (const line of lines) {
		const entry = {
			node: capText(line, 160),
			relation,
			source: `query:${query}`
		};
		if (relation === 'calls->node') {
			if (!incoming.some((item) => item.node === entry.node)) {
				incoming.push(entry);
			}
		} else if (!outgoing.some((item) => item.node === entry.node)) {
			outgoing.push(entry);
		}
	}
}

function collectFileMentions(outputText: string, fileScores: Map<string, number>): void {
	const srcRegex = /src=([^\]\r\n]+?)(?:\s|]|$)/g;
	let match: RegExpExecArray | null;
	while ((match = srcRegex.exec(outputText)) !== null) {
		const raw = String(match[1] || '').trim();
		if (!raw || isDeclarationFilePath(raw)) {
			continue;
		}
		const normalized = normalizeFsPath(raw);
		fileScores.set(normalized, (fileScores.get(normalized) ?? 0) + 1);
	}
}

function summarizePath(text: string): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 4);
	return capText(lines.join(' | '), 260);
}

function formatReason(result: GraphifyCommandResult): string {
	if (result.timedOut) {
		return 'timeout';
	}
	const stderr = result.stderr.trim();
	if (stderr) {
		return stderr;
	}
	return `exit=${String(result.exitCode)}`;
}

async function runGraphifyGraphCommand(
	args: string[],
	workspaceFsPath: string,
	signal?: AbortSignal
): Promise<GraphifyCommandResult> {
	return new Promise<GraphifyCommandResult>((resolve) => {
		const child = spawn('graphify', args, {
			cwd: workspaceFsPath,
			shell: false
		});

		let stdout = '';
		let stderr = '';
		let settled = false;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			if (!child.killed) {
				child.kill();
			}
		}, CLI_TIMEOUT_MS);

		const onAbort = () => {
			if (!child.killed) {
				child.kill();
			}
		};
		if (signal) {
			signal.addEventListener('abort', onAbort, { once: true });
		}

		child.stdout.on('data', (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		child.on('error', (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}
			resolve({
				success: false,
				exitCode: null,
				stdout,
				stderr: stderr || String(error?.message ?? error),
				timedOut
			});
		});

		child.on('close', (code) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (signal) {
				signal.removeEventListener('abort', onAbort);
			}
			resolve({
				success: !timedOut && code === 0,
				exitCode: code,
				stdout,
				stderr,
				timedOut
			});
		});
	});
}

async function safeStat(filePath: string): Promise<vscode.FileStat | undefined> {
	try {
		return await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
	} catch {
		return undefined;
	}
}

function fallback(reason: string): NodeGraphifyEvidenceResult {
	return {
		incoming: [],
		outgoing: [],
		paths: [],
		topLinkedFiles: [],
		summary: 'Graphify node evidence unavailable; using structural fallback.',
		status: 'fallback',
		fallbackReason: reason,
		compactText: 'Graphify node evidence unavailable; using structural fallback.'
	};
}

function buildCacheKey(input: NodeContextEngineInput, graphMtime: number): string {
	const targetId = input.targetNode?.id || 'none';
	return [
		QUERY_VERSION,
		String(graphMtime),
		input.scope,
		input.node.id,
		targetId
	].join('|');
}

function normalizeSymbol(value: string): string {
	return String(value || '').trim() || 'unknown-symbol';
}

function unique(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const key = value.trim().toLowerCase();
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(value.trim());
	}
	return out;
}

function uniquePairs(
	values: Array<{ from: string; to: string } | undefined>
): Array<{ from: string; to: string }> {
	const seen = new Set<string>();
	const out: Array<{ from: string; to: string }> = [];
	for (const value of values) {
		if (!value?.from || !value.to || value.from === value.to) {
			continue;
		}
		const key = `${value.from.toLowerCase()}::${value.to.toLowerCase()}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(value);
	}
	return out;
}

function capText(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars)}\n... [truncated]`;
}

function normalizeFsPath(filePath: string): string {
	return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

function isDeclarationFilePath(filePath: string): boolean {
	return /\.d\.ts$/i.test(String(filePath).replace(/\\/g, '/').toLowerCase());
}
