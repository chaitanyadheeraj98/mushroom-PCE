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

	const nodeByName = new Map<string, CircuitNode>();
	const addNode = (type: CircuitNodeType, name: string, detail?: string, line?: number, character?: number): CircuitNode => {
		const existing = nodeByName.get(name);
		if (existing) {
			return existing;
		}
		const node: CircuitNode = {
			id: `${type}:${name}`,
			type,
			label: name,
			uri,
			detail,
			line,
			character
		};
		nodeByName.set(name, node);
		return node;
	};

	// Nodes
	for (const sym of symbols) {
		if (sym.kind === 'function') {
			addNode('function', sym.name, `function`, sym.line, sym.character);
		} else if (sym.kind === 'variable') {
			addNode('variable', sym.name, `variable`, sym.line, sym.character);
		} else if (sym.kind === 'import') {
			addNode('import', sym.name, `import`, sym.line, sym.character);
		}
	}

	const edges: CircuitEdge[] = [];
	const edgeKey = new Set<string>();
	const addEdge = (fromName: string, toName: string, label?: string): void => {
		const from = nodeByName.get(fromName);
		const to = nodeByName.get(toName);
		if (!from || !to || from.id === to.id) {
			return;
		}
		const key = `${from.id}->${to.id}:${label ?? ''}`;
		if (edgeKey.has(key)) {
			return;
		}
		edgeKey.add(key);
		edges.push({
			id: `e:${from.id}->${to.id}:${edges.length}`,
			from: from.id,
			to: to.id,
			label
		});
	};

	// Build naive function call edges and data mention edges.
	const functionNames = symbols.filter((s) => s.kind === 'function').map((s) => s.name);
	const importNames = symbols.filter((s) => s.kind === 'import').map((s) => s.name);
	const variableNames = symbols.filter((s) => s.kind === 'variable').map((s) => s.name);

	const functionRanges = computeFunctionRanges(lines, functionNames);

	for (const fnName of functionNames) {
		const range = functionRanges.get(fnName);
		const bodyText = range ? lines.slice(range.startLine, range.endLine + 1).join('\n') : code;

		// Imports used by function
		for (const imp of importNames) {
			if (containsIdentifier(bodyText, imp)) {
				addEdge(imp, fnName, imp);
			}
		}

		// Variables mentioned by function
		for (const v of variableNames) {
			if (containsIdentifier(bodyText, v)) {
				addEdge(v, fnName, v);
			}
		}

		// Function calls inside function
		for (const called of functionNames) {
			if (called === fnName) {
				continue;
			}
			if (new RegExp(`\\b${escapeRegExp(called)}\\s*\\(`).test(bodyText)) {
				addEdge(fnName, called, 'calls');
			}
		}

		// Conditionals inside function -> decision nodes (very lightweight)
		if (/\bif\s*\(/.test(bodyText)) {
			const decisionName = `${fnName}:if`;
			addNode('decision', decisionName, 'if/else decision');
			addEdge(fnName, decisionName, 'branches');
		}
	}

	return {
		nodes: [...nodeByName.values()],
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
