import * as vscode from 'vscode';

import { requestModelText } from '../ai/requestModelText';
import { BlueprintWorkspaceSnapshot } from './scanWorkspaceBlueprint';

export type BlueprintConversationTurn = {
	role: 'user' | 'assistant';
	text: string;
};

export type BlueprintPlannerAssistantTurn = {
	message: string;
	unresolvedQuestions: string[];
	parseWarning?: string;
};

export type BlueprintSpecFunctionRef = {
	name: string;
	path: string;
	status: 'reuse' | 'create' | 'edit';
	inputs: string[];
	outputs: string[];
	duties: string[];
};

export type BlueprintSpecFileAction = {
	path: string;
	action: 'create' | 'edit';
	reason: string;
};

export type BlueprintPlanningSpec = {
	featureName: string;
	goal: string;
	summary: string[];
	userStories: string[];
	reuseFunctions: BlueprintSpecFunctionRef[];
	createFunctions: BlueprintSpecFunctionRef[];
	editFunctions: BlueprintSpecFunctionRef[];
	fileActions: BlueprintSpecFileAction[];
	integrationPlan: string[];
	implementationChanges: string[];
	testPlan: string[];
	assumptionsAndDefaults: string[];
	clarificationsCaptured: string[];
	openQuestions: string[];
	acceptanceCriteria: string[];
};

export type BlueprintPlanningArtifacts = {
	featureName: string;
	spec: BlueprintPlanningSpec;
	prompt: string;
	modelLabel?: string;
	generatedAt: number;
	featureTracking?: {
		featureId: string;
		registryPath: string;
		status: 'draft' | 'saved';
		matchedExistingFeatureId?: string;
		overlapScore?: number;
		isForcedLink?: boolean;
		forcedFeatureId?: string;
		matchBand?: 'high' | 'medium' | 'low';
	};
};

type PlannerTurnEnvelope = {
	message?: string;
	unresolvedQuestions?: string[];
};

type PlannerSpecEnvelope = {
	featureName?: string;
	goal?: string;
	summary?: string[];
	userStories?: string[];
	reuseFunctions?: Array<{
		name?: string;
		path?: string;
		inputs?: string[];
		outputs?: string[];
		duties?: string[];
	}>;
	createFunctions?: Array<{
		name?: string;
		path?: string;
		inputs?: string[];
		outputs?: string[];
		duties?: string[];
	}>;
	editFunctions?: Array<{
		name?: string;
		path?: string;
		inputs?: string[];
		outputs?: string[];
		duties?: string[];
	}>;
	fileActions?: Array<{
		path?: string;
		action?: string;
		reason?: string;
	}>;
	integrationPlan?: string[];
	implementationChanges?: string[];
	testPlan?: string[];
	assumptionsAndDefaults?: string[];
	clarificationsCaptured?: string[];
	openQuestions?: string[];
	acceptanceCriteria?: string[];
};

const BEGIN_BLUEPRINT_JSON = 'BEGIN_BLUEPRINT_JSON';
const END_BLUEPRINT_JSON = 'END_BLUEPRINT_JSON';
const PLANNER_TURN_SCHEMA_TEXT = `{
  "message": "assistant response for user, can include short bullets",
  "unresolvedQuestions": ["question 1", "question 2"]
}`;
const PLANNER_SPEC_SCHEMA_TEXT = `{
  "featureName": "string",
  "goal": "string",
  "summary": ["high-signal implementation bullets"],
  "userStories": ["string"],
  "reuseFunctions": [{"name":"string","path":"src/...","inputs":["string"],"outputs":["string"],"duties":["string"]}],
  "createFunctions": [{"name":"string","path":"src/...","inputs":["string"],"outputs":["string"],"duties":["string"]}],
  "editFunctions": [{"name":"string","path":"src/...","inputs":["string"],"outputs":["string"],"duties":["string"]}],
  "fileActions": [{"path":"src/...","action":"create|edit","reason":"string"}],
  "integrationPlan": ["string"],
  "implementationChanges": ["string"],
  "testPlan": ["string"],
  "assumptionsAndDefaults": ["string"],
  "clarificationsCaptured": ["string"],
  "openQuestions": ["string"],
  "acceptanceCriteria": ["string"]
}`;

export async function continueBlueprintPlanningTurn(
	model: vscode.LanguageModelChat,
	userMessage: string,
	history: BlueprintConversationTurn[],
	workspace: BlueprintWorkspaceSnapshot | undefined,
	graphifyContextText?: string,
	signal?: AbortSignal
): Promise<BlueprintPlannerAssistantTurn> {
	const prompt = buildPlanningTurnPrompt(userMessage, history, workspace, graphifyContextText);
	const response = await requestModelText(model, prompt, { signal });
	const parseResult = await parseEnvelopeWithRepair<PlannerTurnEnvelope>(
		model,
		response,
		PLANNER_TURN_SCHEMA_TEXT,
		signal
	);
	const parsed = parseResult.parsed;
	if (!parsed) {
		const rawText = String(response || '').trim();
		return {
			message: rawText || 'Planner returned an invalid structured response. Please retry the same request.',
			unresolvedQuestions: [],
			parseWarning: 'Planner response was not valid JSON; showing raw model text.'
		};
	}
	const unresolvedQuestions = normalizeStringList(parsed?.unresolvedQuestions, 8);
	const message = String(parsed?.message || '').trim() || fallbackAssistantMessage(unresolvedQuestions);
	return {
		message,
		unresolvedQuestions,
		parseWarning: parseResult.repaired
			? 'Planner response required JSON repair pass; validated output is shown.'
			: undefined
	};
}

export async function generateBlueprintPlanningArtifacts(
	model: vscode.LanguageModelChat,
	history: BlueprintConversationTurn[],
	workspace: BlueprintWorkspaceSnapshot | undefined,
	graphifyContextText?: string,
	signal?: AbortSignal
): Promise<BlueprintPlanningArtifacts> {
	const prompt = buildArtifactsPrompt(history, workspace, graphifyContextText);
	const response = await requestModelText(model, prompt, { signal });
	const parseResult = await parseEnvelopeWithRepair<PlannerSpecEnvelope>(
		model,
		response,
		PLANNER_SPEC_SCHEMA_TEXT,
		signal
	);
	const parsed = parseResult.parsed;
	if (!parsed) {
		throwInvalidPlannerJsonResponse('Generate', response, parseResult.repairResponse);
	}
	const draftSpec = normalizeSpec(parsed);
	const targetedContext = await buildTargetedFunctionContext(draftSpec, signal);
	const spec = targetedContext
		? await refineSpecWithCodeContext(model, prompt, draftSpec, targetedContext, signal)
		: draftSpec;
	return {
		featureName: spec.featureName,
		spec,
		prompt: buildImplementationPrompt(spec),
		modelLabel: `${model.name} (${model.vendor}/${model.family})`,
		generatedAt: Date.now()
	};
}

function buildPlanningTurnPrompt(
	userMessage: string,
	history: BlueprintConversationTurn[],
	workspace: BlueprintWorkspaceSnapshot | undefined,
	graphifyContextText?: string
): string {
	const graphifySection = graphifyContextText?.trim()
		? [
			'Graphify Sources (optional, use when helpful):',
			'- Source A (`GRAPH_REPORT.md`): high-level architecture overview and hub abstractions.',
			'- Source B (`graph.json` snapshot): concrete file/folder/function distribution.',
			'- Source C (`graphify query/path`): precise dependency/path evidence.',
			'- Source selection rule: choose minimal sources for answer quality.',
			'  - For overview/orientation: prioritize Source A + B.',
			'  - For implementation planning: prefer Source B + C, and use Source A for architecture sanity-check.',
			'',
			'Graphify Context:',
			graphifyContextText.trim()
		].join('\n')
		: 'Graphify Sources: unavailable or disabled; rely on workspace snapshot + conversation.';

	return [
		'You are Mushroom Blueprint Planner, a detail-oriented software planning assistant inside VS Code.',
		'The user is planning a feature in plain English before implementation.',
		'',
		'Primary behavior requirements:',
		'- Reuse-first: propose existing functions/concepts from workspace before suggesting new code.',
		'- Ask specific implementation questions when details are missing.',
		'- Track unresolved specification questions.',
		'- Keep language practical and concrete.',
		'- Focus follow-up questions on: launch entrypoint, data model shape, interaction UX, persistence, validation rules, and tests.',
		'- When Graphify context is provided, choose the right source(s) instead of using everything blindly.',
		'- Return valid JSON only.',
		'',
		'OUTPUT JSON SCHEMA:',
		PLANNER_TURN_SCHEMA_TEXT,
		'',
		'OUTPUT FORMAT (strict):',
		`- Print only ${BEGIN_BLUEPRINT_JSON} on its own line, then JSON, then ${END_BLUEPRINT_JSON} on its own line.`,
		'- Do not include markdown, commentary, or any text outside the markers.',
		'',
		'RULES:',
		'- Mention reusable existing functions/files when possible.',
		'- If a new function/file is likely required, say so with suggested path.',
		'- Ask at least one targeted question unless the spec looks complete.',
		'- Keep unresolvedQuestions concise and non-duplicative.',
		'',
		renderWorkspaceContext(workspace),
		'',
		graphifySection,
		'',
		'Recent Conversation:',
		...history.slice(-18).map((turn) => `${turn.role.toUpperCase()}: ${sanitizePromptText(turn.text, 1200)}`),
		'',
		`Latest user message: ${sanitizePromptText(userMessage, 1600)}`
	].join('\n');
}

function buildArtifactsPrompt(
	history: BlueprintConversationTurn[],
	workspace: BlueprintWorkspaceSnapshot | undefined,
	graphifyContextText?: string
): string {
	const graphifySection = graphifyContextText?.trim()
		? [
			'Graphify Sources (optional, use when needed for precision):',
			'- Source A (`GRAPH_REPORT.md`): architecture overview/hubs/communities.',
			'- Source B (`graph.json` snapshot): concrete structural inventory (paths/modules/functions).',
			'- Source C (`graphify query/path`): targeted relationships and path evidence.',
			'- Source selection policy:',
			'  - Overview-only requests: Source A + B is usually enough.',
			'  - Precise implementation/file placement requests: combine Source B + C; use Source A for architecture consistency.',
			'- Always prioritize concrete file/function evidence when deciding reuse, create, or edit actions.',
			'',
			'Graphify Context:',
			graphifyContextText.trim()
		].join('\n')
		: 'Graphify Sources: unavailable or disabled; rely on workspace snapshot + conversation.';

	return [
		'You are finalizing a feature implementation planning package.',
		'Return strictly valid JSON only.',
		'',
		'Goal:',
		'- Build a complete machine-usable planning spec from the conversation and workspace context.',
		'- Prefer existing functions first, then list new functions/files only when needed.',
		'- Include file edits and integration duties.',
		'- The final plan must be explicit enough for another coding AI to implement without guessing.',
		'- When Graphify context is provided, choose the right source(s) for precision and cite concrete paths/functions in your reasoning.',
		'',
		'OUTPUT JSON SCHEMA:',
		PLANNER_SPEC_SCHEMA_TEXT,
		'',
		'OUTPUT FORMAT (strict):',
		`- Print only ${BEGIN_BLUEPRINT_JSON} on its own line, then JSON, then ${END_BLUEPRINT_JSON} on its own line.`,
		'- Do not include markdown, links, commentary, or any text outside the markers.',
		'',
		'Constraints:',
		'- Keep paths relative to workspace and prefer src/.',
		'- Every function should have concrete duties and I/O.',
		'- Do not omit required cross-file edits.',
		'- If data is missing, include it under openQuestions.',
		'- Reuse functions must match names/paths from Known Function/Export Sample; do not invent reuse entries.',
		'- If uncertain whether a function exists, do not put it under reuseFunctions.',
		'- Include at least 3 implementationChanges and at least 4 testPlan items when feasible.',
		'',
		renderWorkspaceContext(workspace),
		'',
		graphifySection,
		'',
		'Conversation:',
		...history.slice(-30).map((turn) => `${turn.role.toUpperCase()}: ${sanitizePromptText(turn.text, 1400)}`)
	].join('\n');
}

type BlueprintFunctionContext = {
	path: string;
	name: string;
	snippet: string;
	matchType: 'function' | 'variable' | 'method' | 'fallback';
};

async function refineSpecWithCodeContext(
	model: vscode.LanguageModelChat,
	basePrompt: string,
	draftSpec: BlueprintPlanningSpec,
	targetedContext: string,
	signal?: AbortSignal
): Promise<BlueprintPlanningSpec> {
	const prompt = [
		basePrompt,
		'',
		'Second-pass refinement stage:',
		'- You now have targeted source snippets for reuse/edit candidates.',
		'- Validate whether reuseFunctions actually match intended duties based on code evidence.',
		'- If a reuse candidate does not match behavior, move it to editFunctions or createFunctions.',
		'- Do not keep uncertain items in reuseFunctions.',
		'- Keep all paths under src/.',
		'- Return strictly valid JSON with the same schema.',
		'',
		'Draft Spec JSON:',
		'```json',
		JSON.stringify(draftSpec, null, 2),
		'```',
		'',
		'Targeted Source Evidence:',
		targetedContext
	].join('\n');

	const response = await requestModelText(model, prompt, { signal });
	const parseResult = await parseEnvelopeWithRepair<PlannerSpecEnvelope>(
		model,
		response,
		PLANNER_SPEC_SCHEMA_TEXT,
		signal
	);
	const parsed = parseResult.parsed;
	if (!parsed) {
		throwInvalidPlannerJsonResponse('Refinement', response, parseResult.repairResponse);
	}
	return normalizeSpec(parsed);
}

async function buildTargetedFunctionContext(
	spec: BlueprintPlanningSpec,
	signal?: AbortSignal
): Promise<string | undefined> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return undefined;
	}

	const candidates = dedupeFunctionTargets([...spec.reuseFunctions, ...spec.editFunctions]).slice(0, 10);
	if (!candidates.length) {
		return undefined;
	}

	const contexts: BlueprintFunctionContext[] = [];
	for (const candidate of candidates) {
		if (signal?.aborted) {
			break;
		}

		const normalizedPath = normalizePath(candidate.path);
		if (!normalizedPath || !normalizedPath.startsWith('src/')) {
			continue;
		}

		const uri = vscode.Uri.joinPath(workspaceFolder.uri, ...normalizedPath.split('/'));
		let bytes: Uint8Array;
		try {
			bytes = await vscode.workspace.fs.readFile(uri);
		} catch {
			continue;
		}

		const text = decodeUtf8(bytes);
		if (!text) {
			continue;
		}

		const snippetMatch = findFunctionSnippet(text, candidate.name);
		if (!snippetMatch) {
			continue;
		}

		contexts.push({
			path: normalizedPath,
			name: candidate.name,
			snippet: snippetMatch.snippet,
			matchType: snippetMatch.matchType
		});
		if (contexts.length >= 10) {
			break;
		}
	}

	if (!contexts.length) {
		return undefined;
	}

	return contexts
		.map((item, index) => [
			`### Candidate ${index + 1}`,
			`Path: ${item.path}`,
			`Symbol: ${item.name}`,
			`Match: ${item.matchType}`,
			'```ts',
			item.snippet,
			'```'
		].join('\n'))
		.join('\n\n');
}

function dedupeFunctionTargets(items: BlueprintSpecFunctionRef[]): BlueprintSpecFunctionRef[] {
	const seen = new Set<string>();
	const out: BlueprintSpecFunctionRef[] = [];
	for (const item of items) {
		const name = String(item.name || '').trim();
		const pathValue = normalizePath(String(item.path || '').trim());
		if (!name || !pathValue) {
			continue;
		}
		const key = `${pathValue.toLowerCase()}::${name.toLowerCase()}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({
			...item,
			name,
			path: pathValue
		});
	}
	return out;
}

function findFunctionSnippet(
	text: string,
	functionName: string
): { snippet: string; matchType: BlueprintFunctionContext['matchType'] } | undefined {
	const name = escapeRegExp(functionName.trim());
	if (!name) {
		return undefined;
	}
	const patterns: Array<{ regex: RegExp; matchType: BlueprintFunctionContext['matchType'] }> = [
		{
			regex: new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`),
			matchType: 'function'
		},
		{
			regex: new RegExp(`\\b(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`),
			matchType: 'variable'
		},
		{
			regex: new RegExp(`\\b${name}\\s*:\\s*(?:async\\s*)?\\(`),
			matchType: 'method'
		},
		{
			regex: new RegExp(`\\b${name}\\s*\\(`),
			matchType: 'fallback'
		}
	];

	for (const pattern of patterns) {
		const match = pattern.regex.exec(text);
		if (!match || typeof match.index !== 'number') {
			continue;
		}
		const snippet = extractSnippetWindow(text, match.index);
		if (snippet) {
			return {
				snippet,
				matchType: pattern.matchType
			};
		}
	}
	return undefined;
}

function extractSnippetWindow(text: string, anchorIndex: number): string | undefined {
	if (anchorIndex < 0 || anchorIndex >= text.length) {
		return undefined;
	}
	const lineStarts = buildLineStarts(text);
	const totalLines = lineStarts.length;
	if (!totalLines) {
		return undefined;
	}
	const anchorLine = findLineNumberAtIndex(lineStarts, anchorIndex);
	const startLine = Math.max(1, anchorLine - 4);
	const endLine = Math.min(totalLines, anchorLine + 36);
	return getLineRange(text, lineStarts, startLine, endLine, 1400);
}

function buildLineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			starts.push(i + 1);
		}
	}
	return starts;
}

function findLineNumberAtIndex(lineStarts: number[], index: number): number {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const start = lineStarts[mid] ?? 0;
		const nextStart = lineStarts[mid + 1] ?? Number.MAX_SAFE_INTEGER;
		if (index >= start && index < nextStart) {
			return mid + 1;
		}
		if (index < start) {
			high = mid - 1;
		} else {
			low = mid + 1;
		}
	}
	return 1;
}

function getLineRange(
	text: string,
	lineStarts: number[],
	startLine: number,
	endLine: number,
	maxChars: number
): string {
	const clampedStart = Math.max(1, startLine);
	const clampedEnd = Math.max(clampedStart, Math.min(endLine, lineStarts.length));
	const startIndex = lineStarts[clampedStart - 1] ?? 0;
	const endIndex = clampedEnd < lineStarts.length ? (lineStarts[clampedEnd] ?? text.length) : text.length;
	const raw = text.slice(startIndex, endIndex);
	if (raw.length <= maxChars) {
		return raw.trimEnd();
	}
	return `${raw.slice(0, maxChars).trimEnd()}\n// ... [snippet truncated]`;
}

function decodeUtf8(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	} catch {
		return '';
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderWorkspaceContext(workspace: BlueprintWorkspaceSnapshot | undefined): string {
	const sampleEntries = workspace?.entries?.slice(0, 900).map((entry) => entry.path) ?? [];
	const sampleFiles = workspace?.files?.slice(0, 220).map((file) => ({
		path: file.path,
		exports: file.exports.slice(0, 24),
		functions: file.functions.slice(0, 24)
	})) ?? [];
	return [
		`Workspace Name: ${workspace?.workspaceName ?? 'unknown'}`,
		`Source Root: ${workspace?.srcRootPath ?? 'src'}`,
		'Known Paths Sample:',
		JSON.stringify(sampleEntries),
		'Known Function/Export Sample:',
		JSON.stringify(sampleFiles)
	].join('\n');
}

function fallbackAssistantMessage(unresolvedQuestions: string[]): string {
	if (unresolvedQuestions.length) {
		return [
			'I can design this with current details, but I still need these specifics before final prompt generation:',
			...unresolvedQuestions.map((q, index) => `${index + 1}. ${q}`)
		].join('\n');
	}
	return 'Got it. I have enough detail for now. You can continue refining or click Generate.';
}

function throwInvalidPlannerJsonResponse(
	stage: 'Generate' | 'Refinement',
	response: string | undefined,
	repairResponse?: string
): never {
	const raw = String(response || '').trim();
	const snippet = raw ? raw.slice(0, 220).replace(/\s+/g, ' ') : '(empty response)';
	const repairRaw = String(repairResponse || '').trim();
	const repairSnippet = repairRaw ? repairRaw.slice(0, 160).replace(/\s+/g, ' ') : '(no repair output)';
	throw new Error(
		`Invalid planner JSON response during ${stage}. Retry Generate and keep output in strict JSON mode. Debug: ${snippet}. Repair debug: ${repairSnippet}`
	);
}

async function parseEnvelopeWithRepair<T extends object>(
	model: vscode.LanguageModelChat,
	response: string | undefined,
	schemaText: string,
	signal?: AbortSignal
): Promise<{ parsed: T | undefined; repaired: boolean; repairResponse?: string }> {
	const parsed = parseEnvelope<T>(response || '');
	if (parsed) {
		return { parsed, repaired: false };
	}
	const raw = String(response || '').trim();
	if (!raw) {
		return { parsed: undefined, repaired: false };
	}
	const repairPrompt = buildJsonRepairPrompt(raw, schemaText);
	const repairResponse = await requestModelText(model, repairPrompt, { signal });
	const repairedParsed = parseEnvelope<T>(repairResponse || '');
	return {
		parsed: repairedParsed,
		repaired: Boolean(repairedParsed),
		repairResponse
	};
}

function buildJsonRepairPrompt(raw: string, schemaText: string): string {
	return [
		'Convert the following model output into strictly valid JSON matching this schema.',
		'Do not change intent; only repair structure.',
		'Output only the marker block and JSON.',
		`Start with ${BEGIN_BLUEPRINT_JSON}, then JSON, then ${END_BLUEPRINT_JSON}.`,
		'',
		'Schema:',
		schemaText,
		'',
		'Raw output to repair:',
		raw
	].join('\n');
}

function normalizeSpec(input: PlannerSpecEnvelope | undefined): BlueprintPlanningSpec {
	const featureName = String(input?.featureName || '').trim() || 'Untitled Feature';
	const goal = String(input?.goal || '').trim() || 'Implement the planned feature with reuse-first strategy.';
	return {
		featureName,
		goal,
		summary: normalizeStringList(input?.summary, 12, ['Implement the feature as a reusable, scoped extension workflow.']),
		userStories: normalizeStringList(input?.userStories, 20, ['User can use the feature successfully.']),
		reuseFunctions: normalizeFunctions(input?.reuseFunctions, 'reuse'),
		createFunctions: normalizeFunctions(input?.createFunctions, 'create'),
		editFunctions: normalizeFunctions(input?.editFunctions, 'edit'),
		fileActions: normalizeFileActions(input?.fileActions),
		integrationPlan: normalizeStringList(input?.integrationPlan, 30, ['Integrate planned files and verify behavior end-to-end.']),
		implementationChanges: normalizeStringList(
			input?.implementationChanges,
			40,
			['Implement scoped file updates aligned with existing extension architecture.']
		),
		testPlan: normalizeStringList(
			input?.testPlan,
			30,
			['Validate key flows manually and add automated checks for critical behavior.']
		),
		assumptionsAndDefaults: normalizeStringList(
			input?.assumptionsAndDefaults,
			20,
			['Use project defaults unless user explicitly overrides behavior.']
		),
		clarificationsCaptured: normalizeStringList(input?.clarificationsCaptured, 40),
		openQuestions: normalizeStringList(input?.openQuestions, 20),
		acceptanceCriteria: normalizeStringList(input?.acceptanceCriteria, 25, ['Feature behavior matches the agreed specification.'])
	};
}

function normalizeFunctions(
	input: PlannerSpecEnvelope['reuseFunctions' | 'createFunctions' | 'editFunctions'],
	status: 'reuse' | 'create' | 'edit'
): BlueprintSpecFunctionRef[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const out: BlueprintSpecFunctionRef[] = [];
	for (const item of input) {
		const name = String(item?.name || '').trim();
		const path = normalizePath(String(item?.path || '').trim());
		if (!name || !path) {
			continue;
		}
		out.push({
			name,
			path,
			status,
			inputs: normalizeStringList(item?.inputs, 12),
			outputs: normalizeStringList(item?.outputs, 12),
			duties: normalizeStringList(item?.duties, 16)
		});
	}
	return out;
}

function normalizeFileActions(input: PlannerSpecEnvelope['fileActions']): BlueprintSpecFileAction[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const out: BlueprintSpecFileAction[] = [];
	for (const item of input) {
		const path = normalizePath(String(item?.path || '').trim());
		const reason = String(item?.reason || '').trim();
		if (!path || !reason) {
			continue;
		}
		const action = item?.action === 'create' ? 'create' : 'edit';
		out.push({
			path,
			action,
			reason
		});
	}
	return out;
}

function normalizeStringList(input: any, max: number, fallback: string[] = []): string[] {
	if (!Array.isArray(input)) {
		return fallback;
	}
	const out: string[] = [];
	for (const value of input) {
		const text = String(value || '').trim();
		if (!text) {
			continue;
		}
		if (!out.includes(text)) {
			out.push(text);
		}
		if (out.length >= max) {
			break;
		}
	}
	return out.length ? out : fallback;
}

function normalizePath(value: string): string {
	const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
	if (!normalized || normalized.includes('..')) {
		return '';
	}
	return normalized.startsWith('src/') ? normalized : `src/${normalized}`;
}

function parseEnvelope<T extends object>(text: string): T | undefined {
	const trimmed = String(text || '').trim();
	if (!trimmed) {
		return undefined;
	}
	const marked = parseMarkedJsonEnvelope<T>(trimmed);
	if (marked) {
		return marked;
	}
	const direct = safeJson<T>(trimmed);
	if (direct) {
		return direct;
	}
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) {
		return safeJson<T>(fenced[1].trim());
	}
	const first = trimmed.indexOf('{');
	const last = trimmed.lastIndexOf('}');
	if (first >= 0 && last > first) {
		return safeJson<T>(trimmed.slice(first, last + 1));
	}
	return undefined;
}

function parseMarkedJsonEnvelope<T extends object>(text: string): T | undefined {
	const beginIndex = text.indexOf(BEGIN_BLUEPRINT_JSON);
	const endIndex = text.lastIndexOf(END_BLUEPRINT_JSON);
	if (beginIndex < 0 || endIndex < 0 || endIndex <= beginIndex) {
		return undefined;
	}
	const start = beginIndex + BEGIN_BLUEPRINT_JSON.length;
	const candidate = text.slice(start, endIndex).trim();
	return safeJson<T>(candidate);
}

function sanitizePromptText(text: string, maxChars: number): string {
	const raw = String(text || '');
	const withoutMarkdownLinks = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$1');
	const withoutBareUrls = withoutMarkdownLinks.replace(/https?:\/\/\S+/gi, '');
	const normalizedWhitespace = withoutBareUrls.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
	if (normalizedWhitespace.length <= maxChars) {
		return normalizedWhitespace;
	}
	return `${normalizedWhitespace.slice(0, maxChars)} ...[truncated]`;
}

function safeJson<T extends object>(raw: string): T | undefined {
	try {
		const parsed = JSON.parse(raw) as T;
		return parsed && typeof parsed === 'object' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function buildImplementationPrompt(spec: BlueprintPlanningSpec): string {
	const asLines = (rows: string[]): string => rows.length ? rows.map((row, index) => `${index + 1}. ${row}`).join('\n') : 'None.';
	const functionRows = (items: BlueprintSpecFunctionRef[]): string => {
		if (!items.length) {
			return 'None.';
		}
		return items
			.map((item, index) => [
				`${index + 1}. ${item.name} (${item.status})`,
				`   - Path: ${item.path}`,
				`   - Inputs: ${item.inputs.join('; ') || 'None'}`,
				`   - Outputs: ${item.outputs.join('; ') || 'None'}`,
				`   - Duties: ${item.duties.join('; ') || 'None'}`
			].join('\n'))
			.join('\n');
	};
	const fileRows = spec.fileActions.length
		? spec.fileActions.map((item, index) => `${index + 1}. ${item.action.toUpperCase()} ${item.path}: ${item.reason}`).join('\n')
		: 'None.';
	return [
		'## Build Plan',
		'',
		'### Summary',
		asLines(spec.summary),
		'',
		`Feature Name: ${spec.featureName}`,
		`Goal: ${spec.goal}`,
		'',
		'User Stories:',
		asLines(spec.userStories),
		'',
		'Reused Functions:',
		functionRows(spec.reuseFunctions),
		'',
		'Functions To Create:',
		functionRows(spec.createFunctions),
		'',
		'Functions To Edit:',
		functionRows(spec.editFunctions),
		'',
		'File Actions:',
		fileRows,
		'',
		'Integration Plan:',
		asLines(spec.integrationPlan),
		'',
		'Implementation Changes:',
		asLines(spec.implementationChanges),
		'',
		'Test Plan:',
		asLines(spec.testPlan),
		'',
		'Assumptions and Defaults:',
		asLines(spec.assumptionsAndDefaults),
		'',
		'Clarifications Captured:',
		asLines(spec.clarificationsCaptured),
		'',
		'Open Questions:',
		asLines(spec.openQuestions),
		'',
		'Acceptance Criteria:',
		asLines(spec.acceptanceCriteria),
		'',
		'Implementation instructions for coding AI:',
		'- Follow existing project conventions and naming.',
		'- Reuse listed functions before creating new abstractions.',
		'- Apply listed file edits and keep scope constrained to this feature.',
		'- Implement tests or validation paths needed to verify acceptance criteria.',
		'- Return complete code with no placeholders.'
	].join('\n');
}
