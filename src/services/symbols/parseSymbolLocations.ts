import * as vscode from 'vscode';

import { SymbolKind, SymbolLocation } from '../../shared/types/appTypes';

export function parseSymbolLocations(document: vscode.TextDocument): SymbolLocation[] {
	const locations: SymbolLocation[] = [];
	const seen = new Set<string>();

	for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
		const rawLine = document.lineAt(lineIndex).text;
		const trimmed = rawLine.trim();
		if (!trimmed) {
			continue;
		}

		const matches: Array<{ name: string; index: number; kind: SymbolKind }> = [];

		const importNamed = /^\s*import\s+(?:type\s+)?\{([^}]+)\}\s+from\b/.exec(rawLine);
		if (importNamed?.[1]) {
			for (const part of importNamed[1].split(',')) {
				const cleaned = part.trim().split(/\s+as\s+/i)[0]?.trim();
				if (cleaned) {
					matches.push({ name: cleaned, index: rawLine.indexOf(cleaned), kind: 'import' });
				}
			}
		}

		const importDefault = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\b/.exec(rawLine);
		if (importDefault?.[1]) {
			matches.push({ name: importDefault[1], index: rawLine.indexOf(importDefault[1]), kind: 'import' });
		}

		const importAlias = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\b/.exec(rawLine);
		if (importAlias?.[1]) {
			matches.push({ name: importAlias[1], index: rawLine.indexOf(importAlias[1]), kind: 'import' });
		}

		const varDecl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(rawLine);
		if (varDecl?.[1]) {
			matches.push({ name: varDecl[1], index: rawLine.indexOf(varDecl[1]), kind: 'variable' });
		}

		const reassignment = /^\s*([A-Za-z_$][\w$]*)\s*=/.exec(rawLine);
		if (reassignment?.[1] && !['const', 'let', 'var'].includes(reassignment[1])) {
			matches.push({ name: reassignment[1], index: rawLine.indexOf(reassignment[1]), kind: 'variable' });
		}

		const fnDecl = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/.exec(rawLine);
		if (fnDecl?.[1]) {
			matches.push({ name: fnDecl[1], index: fnDecl.index, kind: 'function' });
		}

		const arrowFn = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.exec(rawLine);
		if (arrowFn?.[1]) {
			matches.push({ name: arrowFn[1], index: arrowFn.index, kind: 'function' });
		}

		const classMethod = /^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(rawLine);
		if (classMethod?.[1]) {
			const disallowed = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor']);
			if (!disallowed.has(classMethod[1])) {
				matches.push({ name: classMethod[1], index: rawLine.indexOf(classMethod[1]), kind: 'function' });
			}
		}

		const pyFn = /^\s*def\s+([A-Za-z_]\w*)\s*\(/.exec(rawLine);
		if (pyFn?.[1]) {
			matches.push({ name: pyFn[1], index: rawLine.indexOf(pyFn[1]), kind: 'function' });
		}

		const goFn = /^\s*func\s+([A-Za-z_]\w*)\s*\(/.exec(rawLine);
		if (goFn?.[1]) {
			matches.push({ name: goFn[1], index: rawLine.indexOf(goFn[1]), kind: 'function' });
		}

		for (const param of extractParameterNames(rawLine)) {
			matches.push({ name: param, index: rawLine.indexOf(param), kind: 'variable' });
		}

		for (const match of matches) {
			const key = `${match.kind}:${match.name}:${lineIndex}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			locations.push({
				name: match.name,
				uri: document.uri,
				line: lineIndex,
				character: Math.max(0, match.index),
				kind: match.kind
			});
		}
	}

	return locations;
}

function extractParameterNames(line: string): string[] {
	const matches: string[] = [];
	const parenMatch = /\(([^)]*)\)/.exec(line);
	if (!parenMatch?.[1]) {
		return matches;
	}

	for (const rawPart of parenMatch[1].split(',')) {
		const trimmed = rawPart.trim();
		if (!trimmed) {
			continue;
		}
		const base = trimmed
			.replace(/^[.\s]*\.{3}/, '')
			.replace(/[:=].*$/, '')
			.replace(/[{}\[\]\s]/g, '')
			.trim();
		if (/^[A-Za-z_$][\w$]*$/.test(base) && !matches.includes(base)) {
			matches.push(base);
		}
	}

	return matches;
}



