import * as vscode from 'vscode';

import { parseSymbolLocations } from '../symbols';
import { CircuitEdge, CircuitGraph, CircuitNode, CircuitPort } from './types';

type FnRange = { startLine: number; endLine: number };
type FnSymbol = { name: string; line: number; character: number };

// Function-only graph:
// - One node per function/method
// - Purple input ports = params
// - Green output ports = return / side effects
// - Edges only between linked functions/sinks (calls and basic composition)
export function buildCircuitGraph(document: vscode.TextDocument): CircuitGraph {
	const code = document.getText();
	const lines = code.replace(/\r\n/g, '\n').split('\n');
	const uri = document.uri.toString();

	const symbols = parseSymbolLocations(document)
		.filter((s) => s.kind === 'function')
		.map((s): FnSymbol => ({ name: s.name, line: s.line, character: s.character }));

	const functionNames = [...new Set(symbols.map((s) => s.name))];
	const ranges = computeFunctionRanges(lines, functionNames);

	const nodeById = new Map<string, CircuitNode>();

	const addFunctionNode = (fnName: string): CircuitNode => {
		const id = `function:${fnName}`;
		const existing = nodeById.get(id);
		if (existing) {
			return existing;
		}

		const sym = symbols.find((s) => s.name === fnName);
		const range = ranges.get(fnName);
		const signature = range ? (lines[range.startLine] ?? '') : '';
		const params = range ? extractParameterNames(signature) : [];

		const inputs: CircuitPort[] = params.map((p) => ({
			id: `in:${fnName}:${p}`,
			name: p,
			direction: 'in',
			kind: 'param',
			detail: 'parameter'
		}));

		const outputs: CircuitPort[] = [
			{
				id: `out:${fnName}:return`,
				name: 'return',
				direction: 'out',
				kind: 'return',
				detail: 'function return value'
			}
		];

		const node: CircuitNode = {
			id,
			type: 'function',
			label: fnName,
			uri,
			detail: 'function',
			line: sym?.line,
			character: sym?.character,
			inputs,
			outputs
		};
		nodeById.set(id, node);
		return node;
	};

	const addSinkNode = (label: string, detail: string, line?: number): CircuitNode => {
		const id = `sink:${label}`;
		const existing = nodeById.get(id);
		if (existing) {
			return existing;
		}
		const node: CircuitNode = {
			id,
			type: 'sink',
			label,
			uri,
			detail,
			line,
			character: 0,
			inputs: [{ id: `in:${label}:value`, name: 'value', direction: 'in', kind: 'sideEffect', detail: 'incoming value' }],
			outputs: []
		};
		nodeById.set(id, node);
		return node;
	};

	for (const name of functionNames) {
		addFunctionNode(name);
	}

	const edges: CircuitEdge[] = [];
	const edgeKey = new Set<string>();
	const addEdge = (from: string, to: string, fromPort?: string, toPort?: string, label?: string): void => {
		if (!nodeById.has(from) || !nodeById.has(to) || from === to) {
			return;
		}
		const key = `${from}:${fromPort ?? ''}->${to}:${toPort ?? ''}:${label ?? ''}`;
		if (edgeKey.has(key)) {
			return;
		}
		edgeKey.add(key);
		edges.push({ id: `e:${edges.length}`, from, to, fromPort, toPort, label });
	};

	// 1) Calls between functions.
	for (const fnName of functionNames) {
		const range = ranges.get(fnName);
		const body = range ? lines.slice(range.startLine, range.endLine + 1).join('\n') : code;
		const fromId = `function:${fnName}`;

		for (const called of functionNames) {
			if (called === fnName) {
				continue;
			}
			if (new RegExp(`\\b${escapeRegExp(called)}\\s*\\(`).test(body)) {
				addEdge(fromId, `function:${called}`, `out:${fnName}:return`, undefined, 'calls');
			}
		}
	}

	// 2) console.log(fn(...)) -> sink
	const consoleLines = lines
		.map((t, idx) => ({ t, idx }))
		.filter((x) => /\bconsole\.log\s*\(/.test(x.t));
	if (consoleLines.length) {
		const sink = addSinkNode('console.log', 'console output', consoleLines[0].idx);
		const sinkIn = sink.inputs?.[0]?.id;
		for (const fnName of functionNames) {
			const re = new RegExp(`\\bconsole\\.log\\s*\\([^\\)]*\\b${escapeRegExp(fnName)}\\s*\\(`);
			if (re.test(code)) {
				addEdge(`function:${fnName}`, sink.id, `out:${fnName}:return`, sinkIn, 'output');
			}
		}
	}

	// 3) bar(foo(x)) => foo return feeds bar param[0]
	for (const raw of lines) {
		for (const outer of functionNames) {
			const outerCall = new RegExp(`\\b${escapeRegExp(outer)}\\s*\\((.*)\\)`);
			const m = outerCall.exec(raw);
			if (!m?.[1]) {
				continue;
			}
			for (const inner of functionNames) {
				if (inner === outer) {
					continue;
				}
				if (new RegExp(`\\b${escapeRegExp(inner)}\\s*\\(`).test(m[1])) {
					const outerNode = nodeById.get(`function:${outer}`);
					const toPort = outerNode?.inputs?.[0]?.id;
					addEdge(`function:${inner}`, `function:${outer}`, `out:${inner}:return`, toPort, 'feeds');
				}
			}
		}
	}

	// 4) const t = foo(...); bar(t);
	const tempValueMap = new Map<string, string>(); // tempVar -> producerFn
	for (const raw of lines) {
		const assign = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/.exec(raw);
		if (assign?.[1] && assign?.[2] && functionNames.includes(assign[2])) {
			tempValueMap.set(assign[1], assign[2]);
		}

		for (const consumer of functionNames) {
			const call = new RegExp(`\\b${escapeRegExp(consumer)}\\s*\\(([^\\)]*)\\)`);
			const m = call.exec(raw);
			if (!m?.[1]) {
				continue;
			}
			for (const [tempVar, producerFn] of tempValueMap.entries()) {
				if (new RegExp(`\\b${escapeRegExp(tempVar)}\\b`).test(m[1])) {
					const consumerNode = nodeById.get(`function:${consumer}`);
					const toPort = consumerNode?.inputs?.[0]?.id;
					addEdge(`function:${producerFn}`, `function:${consumer}`, `out:${producerFn}:return`, toPort, tempVar);
				}
			}
		}
	}

	return { nodes: [...nodeById.values()], edges };
}

function computeFunctionRanges(lines: string[], functionNames: string[]): Map<string, FnRange> {
	const ranges = new Map<string, FnRange>();
	const fnRegexes = functionNames.map((name) => ({
		name,
		re: new RegExp(
			`\\bfunction\\s+${escapeRegExp(name)}\\b|\\b${escapeRegExp(name)}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>|\\b${escapeRegExp(
				name
			)}\\s*\\([^)]*\\)\\s*\\{`
		)
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
