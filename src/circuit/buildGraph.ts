import * as vscode from 'vscode';

import { parseSymbolLocations } from '../symbols';
import { SymbolKind } from '../types';
import { CircuitEdge, CircuitGraph, CircuitNode, CircuitNodeType } from './types';

type SymbolIndexEntry = {
	name: string;
	kind: SymbolKind;
	line: number;
	character: number;
};

export function buildCircuitGraph(document: vscode.TextDocument): CircuitGraph {
	const code = document.getText();
	const lines = code.replace(/\r\n/g, '\n').split('\n');
	const uri = document.uri.toString();

	const symbols = parseSymbolLocations(document).map(
		(s): SymbolIndexEntry => ({
			name: s.name,
			kind: s.kind,
			line: s.line,
			character: s.character
		})
	);

	const nodeById = new Map<string, CircuitNode>();
	const nameToPrimaryId = new Map<string, string>();
	const addNode = (
		id: string,
		type: CircuitNodeType,
		label: string,
		detail?: string,
		line?: number,
		character?: number
	): CircuitNode => {
		const existing = nodeById.get(id);
		if (existing) {
			return existing;
		}
		const node: CircuitNode = { id, type, label, uri, detail, line, character };
		nodeById.set(id, node);
		// Track a primary id for simple name lookup (functions/vars/imports).
		if (!nameToPrimaryId.has(label) && (type === 'function' || type === 'variable' || type === 'import')) {
			nameToPrimaryId.set(label, id);
		}
		return node;
	};

	// Nodes
	for (const sym of symbols) {
		if (sym.kind === 'function') {
			addNode(`function:${sym.name}`, 'function', sym.name, 'function', sym.line, sym.character);
		} else if (sym.kind === 'variable') {
			addNode(`variable:${sym.name}`, 'variable', sym.name, 'variable', sym.line, sym.character);
		} else if (sym.kind === 'import') {
			addNode(`import:${sym.name}`, 'import', sym.name, 'import', sym.line, sym.character);
		}
	}

	const edges: CircuitEdge[] = [];
	const edgeKey = new Set<string>();
	const addEdge = (fromId: string, toId: string, label?: string): void => {
		const from = nodeById.get(fromId);
		const to = nodeById.get(toId);
		if (!from || !to || fromId === toId) {
			return;
		}
		const key = `${fromId}->${toId}:${label ?? ''}`;
		if (edgeKey.has(key)) {
			return;
		}
		edgeKey.add(key);
		edges.push({
			id: `e:${fromId}->${toId}:${edges.length}`,
			from: fromId,
			to: toId,
			label
		});
	};

	// Build naive function call edges and data mention edges.
	const functionNames = symbols.filter((s) => s.kind === 'function').map((s) => s.name);
	const importNames = symbols.filter((s) => s.kind === 'import').map((s) => s.name);
	const variableNames = symbols.filter((s) => s.kind === 'variable').map((s) => s.name);

	const functionRanges = computeFunctionRanges(lines, functionNames);

	// Create a shared sink node for console.log if present.
	const consoleLines = lines
		.map((t, idx) => ({ t, idx }))
		.filter((x) => /\bconsole\.log\s*\(/.test(x.t));
	const consoleSinkId = consoleLines.length ? 'sink:console.log' : undefined;
	if (consoleSinkId) {
		const first = consoleLines[0];
		addNode(consoleSinkId, 'sink', 'console.log', 'output sink', first.idx, 0);
	}

	for (const fnName of functionNames) {
		const range = functionRanges.get(fnName);
		const fnId = nameToPrimaryId.get(fnName) ?? `function:${fnName}`;
		const bodyLines = range ? lines.slice(range.startLine, range.endLine + 1) : lines;
		const bodyText = bodyLines.join('\n');

		// Function param sources -> function
		if (range) {
			const signatureLine = lines[range.startLine] ?? '';
			const params = extractParameterNames(signatureLine);
			for (const p of params) {
				const pid = `source:param:${fnName}:${p}`;
				addNode(pid, 'source', p, `param of ${fnName}`, range.startLine, Math.max(0, signatureLine.indexOf(p)));
				addEdge(pid, fnId, p);
			}
		}

		// Imports used by function
		for (const imp of importNames) {
			if (containsIdentifier(bodyText, imp)) {
				const fromId = nameToPrimaryId.get(imp) ?? `import:${imp}`;
				addEdge(fromId, fnId, imp);
			}
		}

		// Variables mentioned by function
		for (const v of variableNames) {
			if (containsIdentifier(bodyText, v)) {
				const fromId = nameToPrimaryId.get(v) ?? `variable:${v}`;
				addEdge(fromId, fnId, v);
			}
		}

		// Function calls inside function
		for (const called of functionNames) {
			if (called === fnName) {
				continue;
			}
			if (new RegExp(`\\b${escapeRegExp(called)}\\s*\\(`).test(bodyText)) {
				const toId = nameToPrimaryId.get(called) ?? `function:${called}`;
				addEdge(fnId, toId, 'calls');
			}
		}

		// Control flow nodes in order: if/while/for/switch/try/catch + return.
		const controlNodeIds: string[] = [];
		if (range) {
			for (let li = range.startLine; li <= range.endLine; li++) {
				const raw = lines[li] ?? '';
				const trimmed = raw.trim();
				if (!trimmed) {
					continue;
				}

				const addControl = (kind: string, label: string, detail: string) => {
					const id = `decision:${fnName}:${kind}@${li}`;
					addNode(id, 'decision', label, detail, li, Math.max(0, raw.indexOf(kind)));
					controlNodeIds.push(id);
				};

				const ifMatch = /\bif\s*\(([^)]*)\)/.exec(raw);
				if (ifMatch?.[1]) {
					addControl('if', `if (${ifMatch[1].trim()})`, 'if/else branch');
				}
				const whileMatch = /\bwhile\s*\(([^)]*)\)/.exec(raw);
				if (whileMatch?.[1]) {
					addControl('while', `while (${whileMatch[1].trim()})`, 'loop');
				}
				const forMatch = /\bfor\s*\(([^)]*)\)/.exec(raw);
				if (forMatch?.[1]) {
					addControl('for', `for (${forMatch[1].trim()})`, 'loop');
				}
				if (/\bswitch\s*\(/.test(raw)) {
					addControl('switch', 'switch (...)', 'branch');
				}
				if (/\btry\b/.test(trimmed)) {
					addControl('try', 'try { ... }', 'error path');
				}
				if (/\bcatch\b/.test(trimmed)) {
					addControl('catch', 'catch (...)', 'error path');
				}
			}

			// Return sink
			const returnLine = findFirstLine(range.startLine, range.endLine, lines, /\breturn\b/);
			let returnId: string | undefined;
			if (typeof returnLine === 'number') {
				returnId = `sink:return:${fnName}`;
				addNode(returnId, 'sink', `return (${fnName})`, 'return value', returnLine, 0);
			}

			// Wire the flow: fn -> control... -> return
			if (controlNodeIds.length) {
				addEdge(fnId, controlNodeIds[0], 'flow');
				for (let i = 0; i < controlNodeIds.length - 1; i++) {
					addEdge(controlNodeIds[i], controlNodeIds[i + 1], 'next');
				}
				if (returnId) {
					addEdge(controlNodeIds[controlNodeIds.length - 1], returnId, 'return');
				}
			} else if (returnId) {
				addEdge(fnId, returnId, 'return');
			}

			// If file has console.log, connect function -> console sink when used.
			if (consoleSinkId && containsIdentifier(code, fnName) && /\bconsole\.log\s*\(/.test(code)) {
				// Only link if console.log(...) calls this function somewhere.
				if (new RegExp(`\\bconsole\\.log\\s*\\([^)]*\\b${escapeRegExp(fnName)}\\s*\\(`).test(code)) {
					addEdge(returnId ?? fnId, consoleSinkId, 'output');
				}
			}
		}
	}

	return {
		nodes: [...nodeById.values()],
		edges
	};
}

function computeFunctionRanges(lines: string[], functionNames: string[]): Map<string, { startLine: number; endLine: number }> {
	const ranges = new Map<string, { startLine: number; endLine: number }>();
	const fnRegexes = functionNames.map((name) => ({
		name,
		re: new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\b|\\b${escapeRegExp(name)}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>|\\b${escapeRegExp(name)}\\s*\\([^)]*\\)\\s*\\{`)
	}));

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const { name, re } of fnRegexes) {
			if (ranges.has(name)) {
				continue;
			}
			if (!re.test(line)) {
				continue;
			}
			const end = findBlockEnd(lines, i);
			ranges.set(name, { startLine: i, endLine: end ?? i });
		}
	}

	return ranges;
}

function findBlockEnd(lines: string[], startLine: number): number | undefined {
	let depth = 0;
	let started = false;
	for (let i = startLine; i < lines.length; i++) {
		for (const ch of lines[i]) {
			if (ch === '{') {
				depth++;
				started = true;
			} else if (ch === '}') {
				depth--;
				if (started && depth <= 0) {
					return i;
				}
			}
		}
	}
	return undefined;
}

function containsIdentifier(text: string, identifier: string): boolean {
	return new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(text);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function findFirstLine(startLine: number, endLine: number, lines: string[], re: RegExp): number | undefined {
	for (let li = startLine; li <= endLine; li++) {
		if (re.test(lines[li] ?? '')) {
			return li;
		}
	}
	return undefined;
}
