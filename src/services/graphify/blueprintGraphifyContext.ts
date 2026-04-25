import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

import { BlueprintConversationTurn } from '../blueprint/generateBlueprintCode';

type BuildBlueprintGraphifyContextOptions = {
	workspaceFsPath: string;
	featureText: string;
	history: BlueprintConversationTurn[];
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

const QUERY_TIMEOUT_MS = 3500;
const MAX_QUERY_CALLS = 4;
const MAX_PATH_CALLS = 2;
const MAX_TOTAL_CHARS = 7800;

export async function buildBlueprintGraphifyContext(
	options: BuildBlueprintGraphifyContextOptions
): Promise<string | undefined> {
	const reportPath = path.resolve(options.workspaceFsPath, 'graphify-out', 'GRAPH_REPORT.md');
	const graphPath = path.resolve(options.workspaceFsPath, 'graphify-out', 'graph.json');

	const [reportBytes, graphBytes] = await Promise.all([
		readFileIfExists(reportPath),
		readFileIfExists(graphPath)
	]);
	if (!reportBytes && !graphBytes) {
		options.output?.appendLine('blueprint graphify context unavailable: report+graph missing');
		return undefined;
	}

	const reportText = reportBytes ? new TextDecoder().decode(reportBytes).trim() : '';
	const graphSnapshot = graphBytes ? buildGraphSnapshot(graphBytes) : 'graph.json unavailable';

	const focusTerms = extractFocusTerms(options.featureText, options.history);
	const queryResults = await runBlueprintQueries(focusTerms, graphPath, options.workspaceFsPath, options.output, options.signal);
	const pathResults = await runBlueprintPaths(focusTerms, graphPath, options.workspaceFsPath, options.output, options.signal);

	const sections = [
		'Graphify Source A - GRAPH_REPORT.md (overview):',
		`\`\`\`markdown\n${capText(reportText || 'GRAPH_REPORT.md unavailable', 2600)}\n\`\`\``,
		'Graphify Source B - graph.json structural snapshot:',
		`\`\`\`text\n${capText(graphSnapshot, 2200)}\n\`\`\``
	];

	if (queryResults.length || pathResults.length) {
		sections.push('Graphify Source C - query/path targeted evidence:');
		for (const item of queryResults) {
			sections.push(`\`\`\`text\nQuery: ${item.query}\n${capText(item.text, 900)}\n\`\`\``);
		}
		for (const item of pathResults) {
			sections.push(`\`\`\`text\nPath: ${item.from} -> ${item.to}\n${capText(item.text, 800)}\n\`\`\``);
		}
	} else {
		sections.push(
			'Graphify Source C - query/path targeted evidence:',
			'```text\nNo query/path evidence returned for this feature text.\n```'
		);
	}

	sections.push(
		'Source Selection Guide:',
		'```text',
		'- Use Source A for high-level architecture overview, system hubs, and community understanding.',
		'- Use Source B for concrete file/folder/function placement decisions.',
		'- Use Source C for precise dependency edges and path-level reasoning.',
		'- For implementation plans, prioritize Source B + Source C and use Source A as consistency check.',
		'```'
	);

	const combined = sections.join('\n\n');
	return capText(combined, MAX_TOTAL_CHARS);
}

async function runBlueprintQueries(
	focusTerms: string[],
	graphPath: string,
	workspaceFsPath: string,
	output: vscode.OutputChannel | undefined,
	signal?: AbortSignal
): Promise<Array<{ query: string; text: string }>> {
	const focus = focusTerms[0] || 'the requested feature';
	const secondary = focusTerms[1] || 'src';
	const queries = uniqueQueries([
		`show architecture flow for ${focus}`,
		`what modules depend on ${focus}?`,
		`what connects ${focus} to ${secondary}?`,
		`what files are related to ${focus}?`
	]).slice(0, MAX_QUERY_CALLS);

	const out: Array<{ query: string; text: string }> = [];
	for (const query of queries) {
		if (signal?.aborted) {
			break;
		}
		const result = await runGraphifyGraphCommand(['query', query, '--graph', graphPath], workspaceFsPath, signal);
		if (!result.success) {
			output?.appendLine(`blueprint graphify query failed: "${query}" (${formatReason(result)})`);
			continue;
		}
		const cleaned = result.stdout.trim();
		if (!cleaned || /^No matching nodes found\.?$/i.test(cleaned)) {
			continue;
		}
		out.push({ query, text: cleaned });
	}
	return out;
}

async function runBlueprintPaths(
	focusTerms: string[],
	graphPath: string,
	workspaceFsPath: string,
	output: vscode.OutputChannel | undefined,
	signal?: AbortSignal
): Promise<Array<{ from: string; to: string; text: string }>> {
	if (focusTerms.length < 2) {
		return [];
	}
	const pairs = uniquePairs([
		{ from: focusTerms[0], to: focusTerms[1] },
		{ from: focusTerms[0], to: 'requestModelText' }
	]).slice(0, MAX_PATH_CALLS);

	const out: Array<{ from: string; to: string; text: string }> = [];
	for (const pair of pairs) {
		if (signal?.aborted) {
			break;
		}
		const result = await runGraphifyGraphCommand(
			['path', pair.from, pair.to, '--graph', graphPath],
			workspaceFsPath,
			signal
		);
		if (!result.success) {
			output?.appendLine(`blueprint graphify path failed: "${pair.from}" -> "${pair.to}" (${formatReason(result)})`);
			continue;
		}
		const cleaned = result.stdout.trim();
		if (!cleaned || /^No path found\.?$/i.test(cleaned) || /^No matching nodes found\.?$/i.test(cleaned)) {
			continue;
		}
		out.push({ from: pair.from, to: pair.to, text: cleaned });
	}
	return out;
}

function buildGraphSnapshot(graphBytes: Uint8Array): string {
	let parsed: any;
	try {
		parsed = JSON.parse(new TextDecoder().decode(graphBytes));
	} catch {
		return 'graph.json exists but could not be parsed.';
	}
	const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
	const links = Array.isArray(parsed?.links) ? parsed.links : [];

	const fileNodeCounts = new Map<string, number>();
	const relationCounts = new Map<string, number>();
	for (const node of nodes) {
		const sourceFile = String(node?.source_file || '').trim();
		if (!sourceFile || isDeclarationFilePath(sourceFile)) {
			continue;
		}
		fileNodeCounts.set(sourceFile, (fileNodeCounts.get(sourceFile) ?? 0) + 1);
	}
	for (const link of links) {
		const relation = String(link?.relation || 'related').toLowerCase();
		relationCounts.set(relation, (relationCounts.get(relation) ?? 0) + 1);
	}

	const topFiles = Array.from(fileNodeCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([file, count]) => `- ${normalizeFile(file)} (${count} nodes)`);
	const topRelations = Array.from(relationCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([rel, count]) => `- ${rel}: ${count}`);

	return [
		`Nodes: ${nodes.length}`,
		`Edges: ${links.length}`,
		'Top Files by Graph Node Density:',
		...(topFiles.length ? topFiles : ['- none']),
		'Top Relation Types:',
		...(topRelations.length ? topRelations : ['- none'])
	].join('\n');
}

function extractFocusTerms(featureText: string, history: BlueprintConversationTurn[]): string[] {
	const joined = [featureText, ...history.slice(-6).map((turn) => turn.text)].join(' ');
	const identifierRegex = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;
	const stopwords = new Set([
		'the', 'and', 'for', 'with', 'from', 'this', 'that', 'will', 'into', 'about', 'feature', 'create', 'update',
		'plan', 'implement', 'where', 'what', 'when', 'should', 'need', 'user', 'backend', 'frontend', 'code'
	]);
	const terms: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = identifierRegex.exec(joined)) !== null) {
		const term = String(match[0] || '').trim();
		if (!term) {
			continue;
		}
		const lower = term.toLowerCase();
		if (stopwords.has(lower) || /^\d/.test(term)) {
			continue;
		}
		if (!terms.some((item) => item.toLowerCase() === lower)) {
			terms.push(term);
		}
		if (terms.length >= 6) {
			break;
		}
	}
	return terms;
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
		}, QUERY_TIMEOUT_MS);

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

async function readFileIfExists(filePath: string): Promise<Uint8Array | undefined> {
	try {
		return await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
	} catch {
		return undefined;
	}
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

function capText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function uniqueQueries(items: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of items) {
		const normalized = item.trim().toLowerCase();
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		out.push(item.trim());
	}
	return out;
}

function uniquePairs(items: Array<{ from: string; to: string }>): Array<{ from: string; to: string }> {
	const seen = new Set<string>();
	const out: Array<{ from: string; to: string }> = [];
	for (const item of items) {
		if (!item.from || !item.to || item.from === item.to) {
			continue;
		}
		const key = `${item.from.toLowerCase()}::${item.to.toLowerCase()}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(item);
	}
	return out;
}

function normalizeFile(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

function isDeclarationFilePath(filePath: string): boolean {
	return /\.d\.ts$/i.test(filePath.replace(/\\/g, '/').toLowerCase());
}
