import * as vscode from 'vscode';

type BlueprintEntryType = 'file' | 'directory';

export type BlueprintWorkspaceEntry = {
	path: string;
	type: BlueprintEntryType;
};

export type BlueprintFileInsight = {
	path: string;
	functions: string[];
	exports: string[];
};

export type BlueprintWorkspaceSnapshot = {
	workspaceName: string;
	srcRootPath: string;
	entries: BlueprintWorkspaceEntry[];
	files: BlueprintFileInsight[];
};

const MAX_ENTRIES = 1500;
const MAX_FILES = 450;
const MAX_FILE_BYTES = 64 * 1024;
const SUPPORTED_CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.cs', '.rb', '.php', '.rs']);
const SKIP_DIRECTORIES = new Set([
	'.git',
	'.svn',
	'.hg',
	'node_modules',
	'dist',
	'build',
	'out',
	'coverage',
	'.next',
	'.nuxt',
	'.turbo',
	'.cache'
]);

export async function scanSrcWorkspaceSnapshot(): Promise<BlueprintWorkspaceSnapshot | undefined> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return undefined;
	}

	const srcUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src');
	try {
		await vscode.workspace.fs.stat(srcUri);
	} catch {
		return undefined;
	}

	const entries: BlueprintWorkspaceEntry[] = [];
	const files: BlueprintFileInsight[] = [];

	const walk = async (dirUri: vscode.Uri, relDir: string): Promise<void> => {
		if (entries.length >= MAX_ENTRIES || files.length >= MAX_FILES) {
			return;
		}

		let children: [string, vscode.FileType][];
		try {
			children = await vscode.workspace.fs.readDirectory(dirUri);
		} catch {
			return;
		}

		children.sort((a, b) => a[0].localeCompare(b[0]));
		for (const [name, fileType] of children) {
			if (entries.length >= MAX_ENTRIES || files.length >= MAX_FILES) {
				break;
			}
			if (name.startsWith('.')) {
				continue;
			}

			if (fileType === vscode.FileType.Directory && SKIP_DIRECTORIES.has(name.toLowerCase())) {
				continue;
			}

			const childRel = relDir ? `${relDir}/${name}` : name;
			const childPath = `src/${childRel}`;
			const childUri = vscode.Uri.joinPath(dirUri, name);

			if (fileType === vscode.FileType.Directory) {
				entries.push({ path: childPath, type: 'directory' });
				await walk(childUri, childRel);
				continue;
			}

			if (fileType !== vscode.FileType.File) {
				continue;
			}

			entries.push({ path: childPath, type: 'file' });
			const ext = extensionOf(name);
			if (!SUPPORTED_CODE_EXTENSIONS.has(ext)) {
				continue;
			}
			const insight = await readFileInsight(childUri, childPath);
			if (insight) {
				files.push(insight);
			}
		}
	};

	await walk(srcUri, '');

	return {
		workspaceName: workspaceFolder.name,
		srcRootPath: 'src',
		entries,
		files
	};
}

async function readFileInsight(uri: vscode.Uri, filePath: string): Promise<BlueprintFileInsight | undefined> {
	let bytes: Uint8Array;
	try {
		bytes = await vscode.workspace.fs.readFile(uri);
	} catch {
		return undefined;
	}

	const clipped = bytes.byteLength > MAX_FILE_BYTES ? bytes.slice(0, MAX_FILE_BYTES) : bytes;
	const text = decodeUtf8(clipped);
	if (!text.trim()) {
		return undefined;
	}

	const functions = uniqueSorted([
		...captureAll(text, /\b(?:export\s+)?function\s+([A-Za-z_$][\w$]*)/g),
		...captureAll(text, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g),
		...captureAll(text, /\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g)
	]).slice(0, 60);

	const exports = uniqueSorted([
		...captureAll(text, /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g),
		...captureAll(text, /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g),
		...captureAll(text, /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g),
		...captureAll(text, /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g),
		...captureAll(text, /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g),
		...captureAll(text, /\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g)
	]).slice(0, 60);

	return {
		path: filePath,
		functions,
		exports
	};
}

function captureAll(text: string, pattern: RegExp): string[] {
	const out: string[] = [];
	let match: RegExpExecArray | null = null;
	while ((match = pattern.exec(text))) {
		const value = String(match[1] || '').trim();
		if (value) {
			out.push(value);
		}
	}
	return out;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function decodeUtf8(bytes: Uint8Array): string {
	try {
		return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	} catch {
		return '';
	}
}
