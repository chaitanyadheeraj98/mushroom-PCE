import * as vscode from 'vscode';

import { BlueprintPlanningArtifacts } from './generateBlueprintCode';

export type BlueprintTrackedFile = {
	path: string;
	action: 'create' | 'edit';
	reason: string;
};

export type BlueprintTrackedFunction = {
	name: string;
	path: string;
	status: 'reuse' | 'create' | 'edit';
};

export type BlueprintFeatureRecord = {
	featureId: string;
	featureName: string;
	goal: string;
	status: 'draft' | 'saved';
	summary: string[];
	files: BlueprintTrackedFile[];
	functions: BlueprintTrackedFunction[];
	revision: number;
	createdAt: number;
	updatedAt: number;
	lastGeneratedAt: number;
	lastSavedSpecPath?: string;
};

type BlueprintFeatureRegistry = {
	version: 1;
	updatedAt: number;
	features: BlueprintFeatureRecord[];
};

export type UpsertFeatureRegistryResult = {
	record: BlueprintFeatureRecord;
	registryPath: string;
	isNew: boolean;
	matchedExistingFeatureId?: string;
	overlapScore?: number;
};

export type BlueprintFeatureRegistryOption = {
	featureId: string;
	featureName: string;
	revision: number;
	updatedAt: number;
	status: 'draft' | 'saved';
};

const REGISTRY_RELATIVE_PATH = 'docs/.blueprint/feature-registry.json';
const REGISTRY_VERSION = 1 as const;

export async function upsertBlueprintFeatureFromArtifacts(
	workspaceFolder: vscode.WorkspaceFolder,
	artifacts: BlueprintPlanningArtifacts,
	options?: {
		status?: 'draft' | 'saved';
		savedSpecPath?: string;
		forcedFeatureId?: string;
	}
): Promise<UpsertFeatureRegistryResult> {
	const registry = await loadBlueprintFeatureRegistry(workspaceFolder);
	const now = Date.now();
	const normalizedCandidate = buildCandidateRecord(artifacts, now, options);

	const forcedFeatureId = String(
		options?.forcedFeatureId || artifacts.featureTracking?.forcedFeatureId || artifacts.featureTracking?.featureId || ''
	).trim() || undefined;
	const bestMatch = findBestFeatureMatch(registry.features, normalizedCandidate, forcedFeatureId);
	let matchedExistingFeatureId: string | undefined;
	let overlapScore: number | undefined;
	let isNew = false;
	let nextRecord: BlueprintFeatureRecord;

	if (bestMatch) {
		const current = bestMatch.record;
		const nextRevision = current.revision + 1;
		nextRecord = {
			...current,
			featureName: normalizedCandidate.featureName,
			goal: normalizedCandidate.goal,
			status: normalizedCandidate.status,
			summary: normalizedCandidate.summary,
			files: normalizedCandidate.files,
			functions: normalizedCandidate.functions,
			revision: nextRevision,
			updatedAt: now,
			lastGeneratedAt: normalizedCandidate.lastGeneratedAt,
			lastSavedSpecPath: options?.savedSpecPath || current.lastSavedSpecPath
		};
		matchedExistingFeatureId = current.featureId;
		overlapScore = bestMatch.score;
	} else {
		isNew = true;
		const generatedId = forcedFeatureId || generateFeatureId(normalizedCandidate, registry.features);
		nextRecord = {
			...normalizedCandidate,
			featureId: generatedId
		};
	}

	const byId = new Map<string, BlueprintFeatureRecord>();
	for (const feature of registry.features) {
		byId.set(feature.featureId, feature);
	}
	byId.set(nextRecord.featureId, nextRecord);
	const nextRegistry: BlueprintFeatureRegistry = {
		version: REGISTRY_VERSION,
		updatedAt: now,
		features: Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt)
	};

	await saveBlueprintFeatureRegistry(workspaceFolder, nextRegistry);
	return {
		record: nextRecord,
		registryPath: REGISTRY_RELATIVE_PATH,
		isNew,
		matchedExistingFeatureId,
		overlapScore
	};
}

export async function listBlueprintFeatureOptions(
	workspaceFolder: vscode.WorkspaceFolder
): Promise<BlueprintFeatureRegistryOption[]> {
	const registry = await loadBlueprintFeatureRegistry(workspaceFolder);
	return registry.features
		.map((item) => ({
			featureId: item.featureId,
			featureName: item.featureName,
			revision: item.revision,
			updatedAt: item.updatedAt,
			status: item.status
		}))
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function loadBlueprintFeatureRegistry(workspaceFolder: vscode.WorkspaceFolder): Promise<BlueprintFeatureRegistry> {
	const uri = vscode.Uri.joinPath(workspaceFolder.uri, ...REGISTRY_RELATIVE_PATH.split('/'));
	let bytes: Uint8Array;
	try {
		bytes = await vscode.workspace.fs.readFile(uri);
	} catch {
		return {
			version: REGISTRY_VERSION,
			updatedAt: Date.now(),
			features: []
		};
	}
	const text = decodeUtf8(bytes);
	if (!text.trim()) {
		return {
			version: REGISTRY_VERSION,
			updatedAt: Date.now(),
			features: []
		};
	}
	try {
		const parsed = JSON.parse(text) as BlueprintFeatureRegistry;
		if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.features)) {
			throw new Error('Invalid registry shape');
		}
		return {
			version: REGISTRY_VERSION,
			updatedAt: Number(parsed.updatedAt) || Date.now(),
			features: parsed.features.map((feature) => normalizeRecord(feature)).filter(Boolean) as BlueprintFeatureRecord[]
		};
	} catch {
		return {
			version: REGISTRY_VERSION,
			updatedAt: Date.now(),
			features: []
		};
	}
}

async function saveBlueprintFeatureRegistry(
	workspaceFolder: vscode.WorkspaceFolder,
	registry: BlueprintFeatureRegistry
): Promise<void> {
	const parentUri = vscode.Uri.joinPath(workspaceFolder.uri, 'docs', '.blueprint');
	await vscode.workspace.fs.createDirectory(parentUri);
	const fileUri = vscode.Uri.joinPath(parentUri, 'feature-registry.json');
	const text = JSON.stringify(registry, null, 2);
	await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(text));
}

function normalizeRecord(input: BlueprintFeatureRecord | undefined): BlueprintFeatureRecord | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const featureId = String(input.featureId || '').trim();
	const featureName = String(input.featureName || '').trim();
	const goal = String(input.goal || '').trim();
	if (!featureId || !featureName || !goal) {
		return undefined;
	}
	return {
		featureId,
		featureName,
		goal,
		status: input.status === 'saved' ? 'saved' : 'draft',
		summary: normalizeStringList(input.summary, 8),
		files: normalizeTrackedFiles(input.files),
		functions: normalizeTrackedFunctions(input.functions),
		revision: Number.isFinite(input.revision) ? Math.max(1, Math.floor(input.revision)) : 1,
		createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
		updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
		lastGeneratedAt: Number.isFinite(input.lastGeneratedAt) ? input.lastGeneratedAt : Date.now(),
		lastSavedSpecPath: String(input.lastSavedSpecPath || '').trim() || undefined
	};
}

function buildCandidateRecord(
	artifacts: BlueprintPlanningArtifacts,
	now: number,
	options?: {
		status?: 'draft' | 'saved';
		savedSpecPath?: string;
	}
): Omit<BlueprintFeatureRecord, 'featureId'> {
	const functions = normalizeTrackedFunctions([
		...artifacts.spec.reuseFunctions.map((item) => ({ name: item.name, path: item.path, status: 'reuse' as const })),
		...artifacts.spec.createFunctions.map((item) => ({ name: item.name, path: item.path, status: 'create' as const })),
		...artifacts.spec.editFunctions.map((item) => ({ name: item.name, path: item.path, status: 'edit' as const }))
	]);
	const files = normalizeTrackedFiles(artifacts.spec.fileActions);
	return {
		featureName: String(artifacts.featureName || '').trim() || 'Untitled Feature',
		goal: String(artifacts.spec.goal || '').trim() || 'Deliver planned feature',
		status: options?.status || 'draft',
		summary: normalizeStringList(artifacts.spec.summary, 8),
		files,
		functions,
		revision: 1,
		createdAt: now,
		updatedAt: now,
		lastGeneratedAt: Number.isFinite(artifacts.generatedAt) ? artifacts.generatedAt : now,
		lastSavedSpecPath: options?.savedSpecPath
	};
}

function findBestFeatureMatch(
	records: BlueprintFeatureRecord[],
	candidate: Omit<BlueprintFeatureRecord, 'featureId'>,
	forcedFeatureId?: string
): { record: BlueprintFeatureRecord; score: number } | undefined {
	if (!records.length) {
		return undefined;
	}
	if (forcedFeatureId) {
		const direct = records.find((item) => item.featureId === forcedFeatureId);
		if (direct) {
			return { record: direct, score: 1 };
		}
	}
	const normalizedName = normalizeText(candidate.featureName);
	let best: { record: BlueprintFeatureRecord; score: number } | undefined;
	for (const record of records) {
		const nameScore = normalizeText(record.featureName) === normalizedName ? 1 : 0;
		const fileScore = overlapRatio(
			record.files.map((item) => normalizeText(item.path)),
			candidate.files.map((item) => normalizeText(item.path))
		);
		const functionScore = overlapRatio(
			record.functions.map((item) => normalizeText(`${item.path}::${item.name}`)),
			candidate.functions.map((item) => normalizeText(`${item.path}::${item.name}`))
		);
		const score = (nameScore * 0.55) + (fileScore * 0.25) + (functionScore * 0.2);
		if (!best || score > best.score) {
			best = { record, score };
		}
	}
	return best && best.score >= 0.38 ? best : undefined;
}

function overlapRatio(a: string[], b: string[]): number {
	const aSet = new Set(a.filter(Boolean));
	const bSet = new Set(b.filter(Boolean));
	if (!aSet.size || !bSet.size) {
		return 0;
	}
	let intersection = 0;
	for (const value of aSet) {
		if (bSet.has(value)) {
			intersection += 1;
		}
	}
	const union = new Set([...aSet, ...bSet]).size;
	return union ? intersection / union : 0;
}

function generateFeatureId(
	record: Omit<BlueprintFeatureRecord, 'featureId'>,
	existing: BlueprintFeatureRecord[]
): string {
	const slug = normalizeText(record.featureName).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'feature';
	const hashInput = [
		record.featureName,
		record.goal,
		record.files.map((item) => item.path).join('|'),
		record.functions.map((item) => `${item.path}:${item.name}`).join('|')
	].join('::');
	const hash = fnv1a(hashInput).toString(36).slice(0, 7);
	const base = `feat_${slug}_${hash}`;
	let next = base;
	let suffix = 2;
	const used = new Set(existing.map((item) => item.featureId));
	while (used.has(next)) {
		next = `${base}_${suffix}`;
		suffix += 1;
	}
	return next;
}

function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function normalizeTrackedFiles(input: Array<{ path?: string; action?: string; reason?: string }> | undefined): BlueprintTrackedFile[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const seen = new Set<string>();
	const out: BlueprintTrackedFile[] = [];
	for (const item of input) {
		const pathValue = normalizePath(String(item?.path || ''));
		const reason = String(item?.reason || '').trim();
		if (!pathValue || !reason) {
			continue;
		}
		const action = item?.action === 'create' ? 'create' : 'edit';
		const key = `${pathValue.toLowerCase()}::${action}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({
			path: pathValue,
			action,
			reason
		});
	}
	return out;
}

function normalizeTrackedFunctions(
	input: Array<{ name?: string; path?: string; status?: string }> | undefined
): BlueprintTrackedFunction[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const seen = new Set<string>();
	const out: BlueprintTrackedFunction[] = [];
	for (const item of input) {
		const name = String(item?.name || '').trim();
		const pathValue = normalizePath(String(item?.path || ''));
		if (!name || !pathValue) {
			continue;
		}
		const status = item?.status === 'reuse' || item?.status === 'create' || item?.status === 'edit' ? item.status : 'edit';
		const key = `${pathValue.toLowerCase()}::${name.toLowerCase()}::${status}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({
			name,
			path: pathValue,
			status
		});
	}
	return out;
}

function normalizeStringList(input: string[] | undefined, max: number): string[] {
	if (!Array.isArray(input)) {
		return [];
	}
	const out: string[] = [];
	for (const item of input) {
		const value = String(item || '').trim();
		if (!value || out.includes(value)) {
			continue;
		}
		out.push(value);
		if (out.length >= max) {
			break;
		}
	}
	return out;
}

function normalizePath(value: string): string {
	const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').trim();
	if (!normalized || normalized.includes('..')) {
		return '';
	}
	return normalized.startsWith('src/') ? normalized : `src/${normalized}`;
}

function normalizeText(value: string): string {
	return String(value || '').trim().toLowerCase();
}

function decodeUtf8(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	} catch {
		return '';
	}
}
