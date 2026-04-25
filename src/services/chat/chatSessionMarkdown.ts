import * as path from 'path';
import * as vscode from 'vscode';

export type ChatTranscriptTurn = {
	role: string;
	text: string;
};

type ChatFileResolveResult = {
	workspaceFolder: vscode.WorkspaceFolder;
	fileUri: vscode.Uri;
	relativePath: string;
};

export async function exportChatMarkdownFile(options: {
	fileName: string;
	markdown: string;
	mode?: 'update' | 'edit';
	preferredWorkspaceUri?: vscode.Uri;
}): Promise<{ relativePath: string; created: boolean; mode: 'update' | 'edit' }> {
	const resolved = resolveChatFileUri(options.fileName, options.preferredWorkspaceUri);
	await ensureParentDirectory(resolved.fileUri);
	const created = !(await fileExists(resolved.fileUri));
	const exportMode = options.mode === 'edit' ? 'edit' : 'update';
	if (exportMode === 'edit' && !created) {
		const existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(resolved.fileUri));
		const merged = [existing.trimEnd(), '', '---', '', options.markdown.trim(), ''].join('\n');
		await vscode.workspace.fs.writeFile(resolved.fileUri, new TextEncoder().encode(merged));
	} else {
		await vscode.workspace.fs.writeFile(resolved.fileUri, new TextEncoder().encode(options.markdown));
	}
	return {
		relativePath: resolved.relativePath,
		created,
		mode: exportMode
	};
}

export async function readChatMarkdownFile(options: {
	fileName: string;
	preferredWorkspaceUri?: vscode.Uri;
}): Promise<{ relativePath: string; content: string }> {
	const resolved = resolveChatFileUri(options.fileName, options.preferredWorkspaceUri);
	let bytes: Uint8Array;
	try {
		bytes = await vscode.workspace.fs.readFile(resolved.fileUri);
	} catch {
		throw new Error(`Markdown file not found: ${resolved.relativePath}`);
	}
	return {
		relativePath: resolved.relativePath,
		content: new TextDecoder().decode(bytes)
	};
}

export function buildChatTranscriptMarkdown(title: string, turns: ChatTranscriptTurn[]): string {
	const safeTitle = String(title || 'Chat Session').trim() || 'Chat Session';
	const stamp = new Date().toISOString();
	const bodyLines: string[] = [];
	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		const role = normalizeRole(turn?.role);
		const text = normalizeText(turn?.text);
		if (!text) {
			continue;
		}
		bodyLines.push(`## ${role}`);
		bodyLines.push('');
		bodyLines.push(text);
		bodyLines.push('');
	}
	return [
		`# ${safeTitle}`,
		'',
		`Exported: ${stamp}`,
		'',
		...(bodyLines.length ? bodyLines : ['(no chat messages available)', ''])
	].join('\n');
}

function resolveChatFileUri(fileName: string, preferredWorkspaceUri?: vscode.Uri): ChatFileResolveResult {
	const normalizedPath = normalizeRelativeMarkdownPath(fileName);
	const workspaceFolder = pickWorkspaceFolder(preferredWorkspaceUri);
	const segments = normalizedPath.split('/');
	const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
	const workspaceRoot = path.resolve(workspaceFolder.uri.fsPath);
	const filePath = path.resolve(fileUri.fsPath);
	const workspaceRootNormalized = normalizeFsPathForCompare(workspaceRoot);
	const filePathNormalized = normalizeFsPathForCompare(filePath);
	const rootWithSep = workspaceRootNormalized.endsWith(path.sep)
		? workspaceRootNormalized
		: workspaceRootNormalized + path.sep;
	if (!(filePathNormalized === workspaceRootNormalized || filePathNormalized.startsWith(rootWithSep))) {
		throw new Error('Invalid markdown path. Stay within the opened workspace.');
	}
	return {
		workspaceFolder,
		fileUri,
		relativePath: normalizedPath
	};
}

function pickWorkspaceFolder(preferredWorkspaceUri?: vscode.Uri): vscode.WorkspaceFolder {
	if (preferredWorkspaceUri) {
		const byUri = vscode.workspace.getWorkspaceFolder(preferredWorkspaceUri);
		if (byUri) {
			return byUri;
		}
	}
	const editorUri = vscode.window.activeTextEditor?.document?.uri;
	if (editorUri) {
		const byEditor = vscode.workspace.getWorkspaceFolder(editorUri);
		if (byEditor) {
			return byEditor;
		}
	}
	const first = vscode.workspace.workspaceFolders?.[0];
	if (!first) {
		throw new Error('No workspace folder is open.');
	}
	return first;
}

function normalizeRelativeMarkdownPath(input: string): string {
	const raw = String(input || '').trim();
	if (!raw) {
		throw new Error('Provide a markdown filename, for example: /export notes.md');
	}
	const normalized = raw.replace(/\\/g, '/');
	if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')) {
		throw new Error('Use a workspace-relative markdown path, not an absolute path.');
	}
	if (!normalized.toLowerCase().endsWith('.md')) {
		throw new Error('Only markdown files are supported. Use a .md filename.');
	}
	const segments = normalized.split('/').map((segment) => segment.trim());
	if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
		throw new Error('Invalid markdown path.');
	}
	return segments.join('/');
}

async function ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
	const dirPath = path.dirname(fileUri.fsPath);
	const dirUri = vscode.Uri.file(dirPath);
	try {
		await vscode.workspace.fs.createDirectory(dirUri);
	} catch {
		// Best effort; writeFile will surface a real error if path is invalid.
	}
}

function normalizeFsPathForCompare(value: string): string {
	const resolved = path.resolve(value);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function fileExists(fileUri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(fileUri);
		return stat.type === vscode.FileType.File;
	} catch {
		return false;
	}
}

function normalizeRole(input: string): string {
	const value = String(input || '').toLowerCase();
	if (value === 'assistant') {
		return 'Assistant';
	}
	if (value === 'system') {
		return 'System';
	}
	if (value === 'error') {
		return 'Error';
	}
	return 'User';
}

function normalizeText(text: string): string {
	return String(text || '').replace(/\r\n/g, '\n').trim();
}
