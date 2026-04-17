import * as vscode from 'vscode';

import { countSymbolOccurrences } from './frequency';

type SectionKey =
	| 'imports'
	| 'exports'
	| 'variables'
	| 'constants'
	| 'functions'
	| 'methods'
	| 'classes'
	| 'super'
	| 'interfaces'
	| 'objects'
	| 'models'
	| 'parameters'
	| 'returns'
	| 'control'
	| 'operators'
	| 'structures'
	| 'async'
	| 'modules'
	| 'other';

const SECTION_ORDER: Array<{ key: SectionKey; heading: string }> = [
	{ key: 'imports', heading: '## Imports' },
	{ key: 'exports', heading: '## Exports' },
	{ key: 'variables', heading: '## Variables' },
	{ key: 'constants', heading: '## Constants' },
	{ key: 'functions', heading: '## Functions' },
	{ key: 'methods', heading: '## Methods' },
	{ key: 'classes', heading: '## Classes' },
	{ key: 'super', heading: '## Super Classes / Inheritance' },
	{ key: 'interfaces', heading: '## Interfaces / Types / Enums' },
	{ key: 'objects', heading: '## Objects / Instances' },
	{ key: 'models', heading: '## Data Models / Schemas' },
	{ key: 'parameters', heading: '## Parameters' },
	{ key: 'returns', heading: '## Return Types' },
	{ key: 'control', heading: '## Control Structures' },
	{ key: 'operators', heading: '## Operators' },
	{ key: 'structures', heading: '## Data Structures' },
	{ key: 'async', heading: '## Async / Concurrency' },
	{ key: 'modules', heading: '## Module / File Structure' },
	{ key: 'other', heading: '## Other Concepts Detected' }
];

export async function buildListModeOutput(document: vscode.TextDocument): Promise<string> {
	const code = document.getText();
	const sections = new Map<SectionKey, Set<string>>();
	for (const section of SECTION_ORDER) {
		sections.set(section.key, new Set<string>());
	}

	parseImportsAndExports(code, sections);
	parseDeclarations(code, sections);
	parseLanguageSignals(code, sections);
	addModuleStructure(document, sections);
	await addSymbolsFromProvider(document, sections);

	const blocks: string[] = [];
	for (const section of SECTION_ORDER) {
		blocks.push(section.heading);
		const items = [...(sections.get(section.key) ?? new Set())].sort((a, b) => a.localeCompare(b));
		if (!items.length) {
			blocks.push('- -');
			blocks.push('');
			continue;
		}
		for (const item of items) {
			blocks.push(`- ${formatWithFrequency(item, code)}`);
		}
		blocks.push('');
	}

	return blocks.join('\n').trim();
}

function parseImportsAndExports(code: string, sections: Map<SectionKey, Set<string>>): void {
	const imports = sections.get('imports')!;
	const exportsSet = sections.get('exports')!;

	const importMatches = code.matchAll(/^\s*import\s+(.+)$/gm);
	for (const match of importMatches) {
		const full = match[1]?.trim();
		if (!full) {
			continue;
		}
		const cleaned = full.replace(/\s+from\s+['"][^'"]+['"]\s*;?$/, '').trim();
		if (!cleaned) {
			continue;
		}
		for (const token of extractIdentifierTokens(cleaned)) {
			imports.add(`#sym:${token}`);
		}
	}

	const exportMatches = code.matchAll(/^\s*export\s+(.+)$/gm);
	for (const match of exportMatches) {
		const full = match[1]?.trim();
		if (!full) {
			continue;
		}
		for (const token of extractIdentifierTokens(full)) {
			exportsSet.add(`#sym:${token}`);
		}
	}
}

function parseDeclarations(code: string, sections: Map<SectionKey, Set<string>>): void {
	const variables = sections.get('variables')!;
	const constants = sections.get('constants')!;
	const functions = sections.get('functions')!;
	const classes = sections.get('classes')!;
	const interfaces = sections.get('interfaces')!;
	const parameters = sections.get('parameters')!;
	const returns = sections.get('returns')!;
	const objects = sections.get('objects')!;
	const models = sections.get('models')!;
	const superClasses = sections.get('super')!;

	for (const match of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)/g)) {
		const name = match[1];
		constants.add(`#sym:${name}`);
		if (/(model|schema|dto|entity|state)/i.test(name)) {
			models.add(`#sym:${name}`);
		}
	}
	for (const match of code.matchAll(/\b(?:let|var)\s+([A-Za-z_$][\w$]*)/g)) {
		variables.add(`#sym:${match[1]}`);
	}
	for (const match of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^\s{]+))?/g)) {
		const name = match[1];
		functions.add(`#sym:${name}`);
		for (const param of parseParamList(match[2] ?? '')) {
			parameters.add(`#sym:${param}`);
		}
		if (match[3]) {
			returns.add(match[3].trim());
		}
	}
	for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*(?::\s*([^\s{]+))?/g)) {
		const name = match[1];
		functions.add(`#sym:${name}`);
		for (const param of parseParamList(match[2] ?? '')) {
			parameters.add(`#sym:${param}`);
		}
		if (match[3]) {
			returns.add(match[3].trim());
		}
	}

	for (const match of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$]*))?/g)) {
		classes.add(`#sym:${match[1]}`);
		if (match[2]) {
			superClasses.add(`#sym:${match[2]}`);
		}
	}

	for (const match of code.matchAll(/\b(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
		interfaces.add(`#sym:${match[1]}`);
	}

	for (const match of code.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)/g)) {
		objects.add(`#sym:${match[1]}`);
	}
}

async function addSymbolsFromProvider(document: vscode.TextDocument, sections: Map<SectionKey, Set<string>>): Promise<void> {
	try {
		const result = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			document.uri
		);
		if (!result || !result.length || !isDocumentSymbolArray(result)) {
			return;
		}

		const functions = sections.get('functions')!;
		const methods = sections.get('methods')!;
		const classes = sections.get('classes')!;
		const interfaces = sections.get('interfaces')!;
		const constants = sections.get('constants')!;
		const variables = sections.get('variables')!;
		const objects = sections.get('objects')!;

		const walk = (nodes: vscode.DocumentSymbol[]): void => {
			for (const symbol of nodes) {
				switch (symbol.kind) {
					case vscode.SymbolKind.Function:
						functions.add(`#sym:${symbol.name}`);
						break;
					case vscode.SymbolKind.Method:
					case vscode.SymbolKind.Constructor:
						methods.add(`#sym:${symbol.name}`);
						break;
					case vscode.SymbolKind.Class:
						classes.add(`#sym:${symbol.name}`);
						break;
					case vscode.SymbolKind.Interface:
					case vscode.SymbolKind.Enum:
					case vscode.SymbolKind.TypeParameter:
						interfaces.add(`#sym:${symbol.name}`);
						break;
					case vscode.SymbolKind.Constant:
						constants.add(`#sym:${symbol.name}`);
						break;
					case vscode.SymbolKind.Variable:
					case vscode.SymbolKind.Field:
						variables.add(`#sym:${symbol.name}`);
						break;
					case vscode.SymbolKind.Object:
						objects.add(`#sym:${symbol.name}`);
						break;
					default:
						break;
				}
				if (symbol.children.length) {
					walk(symbol.children);
				}
			}
		};

		walk(result);
	} catch {
		// Provider may be unavailable for some languages.
	}
}

function isDocumentSymbolArray(
	values: (vscode.DocumentSymbol | vscode.SymbolInformation)[]
): values is vscode.DocumentSymbol[] {
	return values.every((item) => 'children' in item && 'selectionRange' in item);
}

function parseLanguageSignals(code: string, sections: Map<SectionKey, Set<string>>): void {
	const control = sections.get('control')!;
	const operators = sections.get('operators')!;
	const structures = sections.get('structures')!;
	const asyncSet = sections.get('async')!;
	const other = sections.get('other')!;

	for (const token of ['if', 'else', 'switch', 'for', 'while', 'do', 'try', 'catch', 'finally', 'return']) {
		const count = countToken(code, token);
		if (count > 0) {
			control.add(`${token} (x${count})`);
		}
	}

	for (const op of ['===', '!==', '==', '!=', '>=', '<=', '=>', '&&', '||', '??', '+', '-', '*', '/', '%', '=']) {
		const count = countOperator(code, op);
		if (count > 0) {
			operators.add(`${op} (x${count})`);
		}
	}

	const structureSignals: Array<[RegExp, string]> = [
		[/\bArray\b|\[[^\]]*\]/g, 'Array'],
		[/\bObject\b|\{[^}]*\}/g, 'Object'],
		[/\bMap\b/g, 'Map'],
		[/\bSet\b/g, 'Set'],
		[/\bRecord\b/g, 'Record'],
		[/\bTuple\b/g, 'Tuple']
	];
	for (const [regex, label] of structureSignals) {
		const count = (code.match(regex) ?? []).length;
		if (count > 0) {
			structures.add(`${label} (x${count})`);
		}
	}

	for (const token of ['async', 'await', 'Promise', 'then', 'catch', 'callback']) {
		const count = countToken(code, token);
		if (count > 0) {
			asyncSet.add(`${token} (x${count})`);
		}
	}

	if (/\breturn\s+\w+\s*\([^)]*\)/.test(code)) {
		other.add('Higher-order calls detected');
	}
	if (/\b[A-Za-z_$][\w$]*\s*\([^)]*\)\s*;/.test(code)) {
		other.add('Function invocation flow detected');
	}
}

function addModuleStructure(document: vscode.TextDocument, sections: Map<SectionKey, Set<string>>): void {
	const modules = sections.get('modules')!;
	const relative = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, '/');
	modules.add(`file: ${relative}`);
	modules.add(`language: ${document.languageId}`);
	const topLevelCount = document.getText().split('\n').length;
	modules.add(`lines: ${topLevelCount}`);
}

function parseParamList(raw: string): string[] {
	return raw
		.split(',')
		.map((part) => part.trim().replace(/^[.\s]*\.{3}/, '').replace(/[:=].*$/, '').replace(/[{}\[\]\s]/g, '').trim())
		.filter((value) => /^[A-Za-z_$][\w$]*$/.test(value));
}

function extractIdentifierTokens(text: string): string[] {
	const matches = text.match(/[A-Za-z_$][\w$]*/g) ?? [];
	return [...new Set(matches)];
}

function countToken(code: string, token: string): number {
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return (code.match(new RegExp(`\\b${escaped}\\b`, 'g')) ?? []).length;
}

function countOperator(code: string, op: string): number {
	const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return (code.match(new RegExp(escaped, 'g')) ?? []).length;
}

function formatWithFrequency(item: string, code: string): string {
	if (/\(x\d+\)\s*$/.test(item)) {
		return item;
	}
	const count = countSymbolOccurrences(code, item);
	if (count <= 0) {
		return item;
	}
	return `${item} (x${count})`;
}
