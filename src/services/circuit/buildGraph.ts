import * as ts from 'typescript';
import * as vscode from 'vscode';

import { CircuitEdge, CircuitGraph, CircuitLayer, CircuitNode, CircuitPort } from '../../shared/types/circuitTypes';

type FunctionInfo = {
	id: string;
	name: string;
	node:
		| ts.FunctionDeclaration
		| ts.MethodDeclaration
		| ts.ArrowFunction
		| ts.FunctionExpression;
	line: number;
	character: number;
	params: string[];
	signals: string[];
};

type ScopeState = Map<string, string[]>;

export function buildCircuitGraph(document: vscode.TextDocument): CircuitGraph {
	const code = document.getText();
	const uri = document.uri.toString();
	const sourceFile = ts.createSourceFile(
		document.fileName || inferFileName(document.languageId),
		code,
		ts.ScriptTarget.Latest,
		true,
		inferScriptKind(document.languageId)
	);

	const functions = collectFunctions(sourceFile);
	const functionByName = new Map(functions.map((fn) => [fn.name, fn] as const));
	const nodeById = new Map<string, CircuitNode>();
	const edges: CircuitEdge[] = [];
	const edgeKey = new Set<string>();
	let consoleSinkCreated = false;

	const addFunctionNode = (fn: FunctionInfo): CircuitNode => {
		const existing = nodeById.get(fn.id);
		if (existing) {
			return existing;
		}
		const layer = classifyFunctionLayer(fn.name);

		const inputs: CircuitPort[] = fn.params.map((param) => ({
			id: `in:${fn.name}:${param}`,
			name: param,
			direction: 'in',
			kind: 'param',
			detail: 'parameter'
		}));

		const outputs: CircuitPort[] = [
			{
				id: `out:${fn.name}:return`,
				name: 'return',
				direction: 'out',
				kind: 'return',
				detail: 'function return value'
			}
		];

		const detail = ['function', ...fn.signals].join(' | ');
		const node: CircuitNode = {
			id: fn.id,
			type: 'function',
			layer,
			groupId: `group:${layer}`,
			label: fn.name,
			uri,
			detail,
			line: fn.line,
			character: fn.character,
			inputs,
			outputs
		};
		nodeById.set(fn.id, node);
		return node;
	};

	const addSinkNode = (label: string, line?: number): CircuitNode => {
		const id = `sink:${label}`;
		const existing = nodeById.get(id);
		if (existing) {
			return existing;
		}

		const node: CircuitNode = {
			id,
			type: 'sink',
			layer: 'runtime',
			label,
			uri,
			detail: 'output sink',
			line,
			character: 0,
			inputs: [
				{
					id: `in:${label}:value`,
					name: 'value',
					direction: 'in',
					kind: 'sideEffect',
					detail: 'incoming value'
				}
			],
			outputs: []
		};
		nodeById.set(id, node);
		return node;
	};

	const addEdge = (
		from: string,
		to: string,
		fromPort?: string,
		toPort?: string,
		label?: string,
		kind: 'architecture' | 'runtime' = 'runtime'
	): void => {
		if (!nodeById.has(from) || !nodeById.has(to) || from === to) {
			return;
		}

		const key = `${kind}:${from}:${fromPort ?? ''}->${to}:${toPort ?? ''}:${label ?? ''}`;
		if (edgeKey.has(key)) {
			return;
		}

		edgeKey.add(key);
		edges.push({ id: `e:${edges.length}`, kind, from, to, fromPort, toPort, label });
	};

	for (const fn of functions) {
		addFunctionNode(fn);
	}

	const hasTopLevelExecutable = sourceFile.statements.some((statement) => isRuntimeTopLevelStatement(statement));
	let topLevelFn: FunctionInfo | undefined;
	if (hasTopLevelExecutable) {
		topLevelFn = {
			id: 'function:main',
			name: 'main',
			node: ts.factory.createFunctionExpression(undefined, undefined, undefined, undefined, [], undefined, ts.factory.createBlock([], true)),
			line: 0,
			character: 0,
			params: [],
			signals: []
		};
		addFunctionNode(topLevelFn);
	}

	for (const fn of functions) {
		const fnScope = new Map<string, string[]>();
		for (const param of fn.params) {
			fnScope.set(param, []);
		}
		analyzeNode(fn.node.body, fn, fnScope, functionByName, nodeById, addSinkNode, addEdge, () => {
			consoleSinkCreated = true;
		});
	}

	const topLevelScope = new Map<string, string[]>();
	for (const statement of sourceFile.statements) {
		if (isFunctionHostStatement(statement)) {
			continue;
		}
		analyzeNode(statement, topLevelFn, topLevelScope, functionByName, nodeById, addSinkNode, addEdge, () => {
			consoleSinkCreated = true;
		});
	}

	// Declaration-only files (types/interfaces/enums/import-export maps) still need
	// a meaningful runtime visualization for beginners.
	if (!functions.length && !hasTopLevelExecutable) {
		buildDeclarationFlow(document, sourceFile, nodeById, addEdge);
	}

	if (!consoleSinkCreated) {
		nodeById.delete('sink:console.log');
	}

	buildArchitectureHierarchy(nodeById, addEdge);

	return { nodes: [...nodeById.values()], edges };
}

function buildDeclarationFlow(
	document: vscode.TextDocument,
	sourceFile: ts.SourceFile,
	nodeById: Map<string, CircuitNode>,
	addEdge: (from: string, to: string, fromPort?: string, toPort?: string, label?: string, kind?: 'architecture' | 'runtime') => void
): void {
	const uri = document.uri.toString();
	const fileNodeId = `module:file:${uri}`;
	const fileNode: CircuitNode = {
		id: fileNodeId,
		type: 'module',
		layer: 'feature',
		label: 'file',
		uri,
		line: 0,
		character: 0,
		detail: 'declaration-only file (no executable runtime statements)'
	};
	nodeById.set(fileNodeId, fileNode);

	let importCount = 0;
	let typeCount = 0;
	let exportCount = 0;

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
			importCount++;
		}
		if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
			exportCount++;
		}
		if (
			ts.isTypeAliasDeclaration(statement) ||
			ts.isInterfaceDeclaration(statement) ||
			ts.isEnumDeclaration(statement) ||
			ts.isModuleDeclaration(statement)
		) {
			typeCount++;
			if (hasExportModifier(statement.modifiers)) {
				exportCount++;
			}
		}
	}

	const importNodeId = `module:imports:${uri}`;
	const typesNodeId = `module:types:${uri}`;
	const exportsNodeId = `module:exports:${uri}`;

	if (importCount > 0) {
		nodeById.set(importNodeId, {
			id: importNodeId,
			type: 'module',
			layer: 'utility',
			label: `imports (${importCount})`,
			uri,
			detail: 'type/value dependencies imported by this file'
		});
		addEdge(fileNodeId, importNodeId, undefined, undefined, 'imports', 'runtime');
	}

	if (typeCount > 0) {
		nodeById.set(typesNodeId, {
			id: typesNodeId,
			type: 'module',
			layer: 'state',
			label: `types (${typeCount})`,
			uri,
			detail: 'interfaces, type aliases, enums, and declarations'
		});
		addEdge(fileNodeId, typesNodeId, undefined, undefined, 'declares', 'runtime');
	}

	if (exportCount > 0) {
		nodeById.set(exportsNodeId, {
			id: exportsNodeId,
			type: 'module',
			layer: 'ui',
			label: `exports (${exportCount})`,
			uri,
			detail: 'public API surface from this file'
		});
		addEdge(fileNodeId, exportsNodeId, undefined, undefined, 'exposes', 'runtime');
	}

	if (importCount > 0 && typeCount > 0) {
		addEdge(importNodeId, typesNodeId, undefined, undefined, 'feeds', 'runtime');
	}
	if (typeCount > 0 && exportCount > 0) {
		addEdge(typesNodeId, exportsNodeId, undefined, undefined, 'publishes', 'runtime');
	}
}

function hasExportModifier(modifiers: ts.NodeArray<ts.ModifierLike> | undefined): boolean {
	if (!modifiers) {
		return false;
	}
	return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function classifyFunctionLayer(name: string): CircuitLayer {
	const baseName = name.split('.').pop() ?? name;
	const lower = baseName.toLowerCase();
	if (baseName === 'activate') {
		return 'system';
	}
	if (lower.includes('command') || lower.startsWith('set') || lower.startsWith('open') || lower.startsWith('select')) {
		return 'command';
	}
	if (lower.startsWith('run') || lower.startsWith('load') || lower.includes('analysis') || lower.includes('restore')) {
		return 'orchestration';
	}
	if (lower.includes('panel') || lower.includes('view') || lower.includes('render') || lower.includes('mode')) {
		return 'ui';
	}
	if (lower.includes('state') || lower.includes('cache') || lower.includes('model') || lower.includes('editor')) {
		return 'state';
	}
	if (
		lower.startsWith('escape') ||
		lower.startsWith('extract') ||
		lower.startsWith('count') ||
		lower.startsWith('get') ||
		lower.startsWith('infer') ||
		lower.startsWith('uniq')
	) {
		return 'utility';
	}
	return 'feature';
}

function buildArchitectureHierarchy(
	nodeById: Map<string, CircuitNode>,
	addEdge: (from: string, to: string, fromPort?: string, toPort?: string, label?: string, kind?: 'architecture' | 'runtime') => void
): void {
	const layers: CircuitLayer[] = ['system', 'command', 'orchestration', 'state', 'ui', 'feature', 'utility'];
	const rootId = 'layer:system-root';
	if (!nodeById.has(rootId)) {
		nodeById.set(rootId, {
			id: rootId,
			type: 'layer',
			layer: 'system',
			label: 'System',
			detail: 'Top-level architecture root'
		});
	}

	for (const layer of layers) {
		const layerId = `layer:${layer}`;
		if (!nodeById.has(layerId)) {
			nodeById.set(layerId, {
				id: layerId,
				type: 'layer',
				layer,
				label: titleCaseLayer(layer),
				parentId: rootId,
				detail: `Architecture layer: ${layer}`
			});
		}
		addEdge(rootId, layerId, undefined, undefined, 'contains', 'architecture');
	}

	for (const node of nodeById.values()) {
		if (node.type !== 'function') {
			continue;
		}
		const layer = node.layer ?? 'feature';
		const layerId = `layer:${layer}`;
		node.parentId = layerId;
		node.groupId = layerId;
		addEdge(layerId, node.id, undefined, undefined, 'includes', 'architecture');
	}

	for (let i = 0; i < layers.length - 1; i++) {
		addEdge(`layer:${layers[i]}`, `layer:${layers[i + 1]}`, undefined, undefined, 'flows-to', 'architecture');
	}
}

function titleCaseLayer(layer: CircuitLayer): string {
	return layer
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function collectFunctions(sourceFile: ts.SourceFile): FunctionInfo[] {
	const functions: FunctionInfo[] = [];

	const visit = (node: ts.Node, className?: string) => {
		if (ts.isFunctionDeclaration(node) && node.name && node.body) {
			functions.push(createFunctionInfo(node.name.text, node, sourceFile));
		} else if (ts.isVariableStatement(node)) {
			for (const declaration of node.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
					continue;
				}
				if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
					functions.push(createFunctionInfo(declaration.name.text, declaration.initializer, sourceFile, declaration.name));
				}
			}
		} else if (ts.isClassDeclaration(node)) {
			const nextClass = node.name?.text ?? className;
			ts.forEachChild(node, (child) => visit(child, nextClass));
			return;
		} else if (ts.isMethodDeclaration(node) && node.body) {
			const methodName = getPropertyName(node.name);
			if (methodName) {
				const label = className ? `${className}.${methodName}` : methodName;
				functions.push(createFunctionInfo(label, node, sourceFile, node.name));
			}
		}

		ts.forEachChild(node, (child) => visit(child, className));
	};

	visit(sourceFile);
	return dedupeFunctions(functions);
}

function createFunctionInfo(
	name: string,
	node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
	sourceFile: ts.SourceFile,
	nameNode?: ts.Node
): FunctionInfo {
	const start = nameNode ?? node;
	const position = sourceFile.getLineAndCharacterOfPosition(start.getStart(sourceFile));
	return {
		id: `function:${name}`,
		name,
		node,
		line: position.line,
		character: position.character,
		params: node.parameters.map((param) => getBindingNames(param.name)).flat(),
		signals: collectFunctionSignals(node)
	};
}

function dedupeFunctions(functions: FunctionInfo[]): FunctionInfo[] {
	const seen = new Set<string>();
	return functions.filter((fn) => {
		if (seen.has(fn.id)) {
			return false;
		}
		seen.add(fn.id);
		return true;
	});
}

function collectFunctionSignals(node: FunctionInfo['node']): string[] {
	const signals = new Set<string>();
	ts.forEachChild(node.body ?? node, function visit(child) {
		if (ts.isIfStatement(child)) {
			signals.add('if');
		}
		if (ts.isForStatement(child) || ts.isForInStatement(child) || ts.isForOfStatement(child) || ts.isWhileStatement(child) || ts.isDoStatement(child)) {
			signals.add('loop');
		}
		if (ts.isAwaitExpression(child)) {
			signals.add('async');
		}
		if (ts.isTryStatement(child) || ts.isThrowStatement(child)) {
			signals.add('error-path');
		}
		ts.forEachChild(child, visit);
	});
	return [...signals];
}

function analyzeNode(
	node: ts.Node | undefined,
	currentFn: FunctionInfo | undefined,
	scope: ScopeState,
	functionByName: Map<string, FunctionInfo>,
	nodeById: Map<string, CircuitNode>,
	addSinkNode: (label: string, line?: number) => CircuitNode,
	addEdge: (from: string, to: string, fromPort?: string, toPort?: string, label?: string) => void,
	markConsoleUsed: () => void
): void {
	if (!node) {
		return;
	}

	const visit = (child: ts.Node, localScope: ScopeState) => {
		if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer) {
			const producers = resolveProducers(child.initializer, localScope, functionByName);
			if (producers.length) {
				localScope.set(child.name.text, producers);
			}
			visitExpressions(child.initializer, localScope);
			return;
		}

		if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(child.left)) {
			const producers = resolveProducers(child.right, localScope, functionByName);
			if (producers.length) {
				localScope.set(child.left.text, producers);
			}
			visitExpressions(child.right, localScope);
			return;
		}

		if (ts.isCallExpression(child)) {
			handleCallExpression(child, currentFn, localScope, functionByName, nodeById, addSinkNode, addEdge, markConsoleUsed);
			for (const arg of child.arguments) {
				visitExpressions(arg, localScope);
			}
			return;
		}

		if (ts.isReturnStatement(child) && child.expression) {
			visitExpressions(child.expression, localScope);
			return;
		}

		if (ts.isBlock(child)) {
			const nestedScope = new Map(localScope);
			for (const stmt of child.statements) {
				visit(stmt, nestedScope);
			}
			return;
		}

		ts.forEachChild(child, (next) => visit(next, localScope));
	};

	const visitExpressions = (expr: ts.Expression, localScope: ScopeState) => {
		ts.forEachChild(expr, (child) => visit(child, localScope));
	};

	visit(node, scope);
}

function handleCallExpression(
	call: ts.CallExpression,
	currentFn: FunctionInfo | undefined,
	scope: ScopeState,
	functionByName: Map<string, FunctionInfo>,
	nodeById: Map<string, CircuitNode>,
	addSinkNode: (label: string, line?: number) => CircuitNode,
	addEdge: (from: string, to: string, fromPort?: string, toPort?: string, label?: string) => void,
	markConsoleUsed: () => void
): void {
	const calleeName = getCallTargetName(call.expression);
	if (!calleeName) {
		return;
	}

	if (calleeName === 'console.log') {
		markConsoleUsed();
		const sink = addSinkNode('console.log', getNodeLine(call));
		const sinkInput = sink.inputs?.[0]?.id;
		for (const arg of call.arguments) {
			for (const producer of resolveProducers(arg, scope, functionByName)) {
				addEdge(`function:${producer}`, sink.id, `out:${producer}:return`, sinkInput, 'output');
			}
		}
		return;
	}

	const called = functionByName.get(calleeName);
	if (!called) {
		return;
	}

	const consumerNode = nodeById.get(called.id);
	let linked = false;

	call.arguments.forEach((arg, index) => {
		const toPort = consumerNode?.inputs?.[index]?.id ?? consumerNode?.inputs?.[0]?.id;
		for (const producer of resolveProducers(arg, scope, functionByName)) {
			addEdge(`function:${producer}`, called.id, `out:${producer}:return`, toPort, toPort ? consumerNode?.inputs?.[index]?.name ?? 'feeds' : 'feeds');
			linked = true;
		}
	});

	if (!linked && currentFn && currentFn.id !== called.id) {
		addEdge(currentFn.id, called.id, undefined, consumerNode?.inputs?.[0]?.id, 'calls');
	}
}

function resolveProducers(expression: ts.Expression, scope: ScopeState, functionByName: Map<string, FunctionInfo>): string[] {
	if (
		ts.isParenthesizedExpression(expression) ||
		ts.isAsExpression(expression) ||
		ts.isTypeAssertionExpression(expression) ||
		ts.isNonNullExpression(expression)
	) {
		return resolveProducers(expression.expression, scope, functionByName);
	}

	if (ts.isAwaitExpression(expression)) {
		return resolveProducers(expression.expression, scope, functionByName);
	}

	if (ts.isConditionalExpression(expression)) {
		return uniq([
			...resolveProducers(expression.whenTrue, scope, functionByName),
			...resolveProducers(expression.whenFalse, scope, functionByName)
		]);
	}

	if (ts.isCallExpression(expression)) {
		const callee = getCallTargetName(expression.expression);
		return callee && functionByName.has(callee) ? [callee] : [];
	}

	if (ts.isIdentifier(expression)) {
		return scope.get(expression.text) ?? [];
	}

	return [];
}

function getCallTargetName(expression: ts.Expression): string | undefined {
	if (ts.isIdentifier(expression)) {
		return expression.text;
	}
	if (ts.isPropertyAccessExpression(expression)) {
		const base = ts.isIdentifier(expression.expression) ? expression.expression.text : expression.expression.getText();
		return `${base}.${expression.name.text}`;
	}
	return undefined;
}

function getPropertyName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return undefined;
}

function getBindingNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) {
		return [name.text];
	}
	const names: string[] = [];
	for (const element of name.elements) {
		if (ts.isBindingElement(element)) {
			names.push(...getBindingNames(element.name));
		}
	}
	return names;
}

function getNodeLine(node: ts.Node): number {
	const sourceFile = node.getSourceFile();
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
}

function isFunctionHostStatement(statement: ts.Statement): boolean {
	if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
		return true;
	}
	if (!ts.isVariableStatement(statement)) {
		return false;
	}

	return statement.declarationList.declarations.some(
		(declaration) =>
			ts.isIdentifier(declaration.name) &&
			!!declaration.initializer &&
			(ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
	);
}

function isRuntimeTopLevelStatement(statement: ts.Statement): boolean {
	// Declarations and imports/exports are structure, not executable runtime flow.
	if (
		ts.isImportDeclaration(statement) ||
		ts.isImportEqualsDeclaration(statement) ||
		ts.isExportDeclaration(statement) ||
		ts.isExportAssignment(statement) ||
		ts.isInterfaceDeclaration(statement) ||
		ts.isTypeAliasDeclaration(statement) ||
		ts.isModuleDeclaration(statement) ||
		ts.isFunctionDeclaration(statement) ||
		ts.isClassDeclaration(statement) ||
		ts.isEnumDeclaration(statement)
	) {
		return false;
	}

	// Variable statements are runtime only when they have actual initializers.
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.some((declaration) => !!declaration.initializer);
	}

	// Expression/flow statements are executable.
	return (
		ts.isExpressionStatement(statement) ||
		ts.isIfStatement(statement) ||
		ts.isForStatement(statement) ||
		ts.isForInStatement(statement) ||
		ts.isForOfStatement(statement) ||
		ts.isWhileStatement(statement) ||
		ts.isDoStatement(statement) ||
		ts.isSwitchStatement(statement) ||
		ts.isTryStatement(statement) ||
		ts.isThrowStatement(statement) ||
		ts.isWithStatement(statement) ||
		ts.isLabeledStatement(statement) ||
		ts.isDebuggerStatement(statement)
	);
}

function inferScriptKind(languageId: string): ts.ScriptKind {
	switch (languageId) {
		case 'javascript':
			return ts.ScriptKind.JS;
		case 'javascriptreact':
			return ts.ScriptKind.JSX;
		case 'typescriptreact':
			return ts.ScriptKind.TSX;
		default:
			return ts.ScriptKind.TS;
	}
}

function inferFileName(languageId: string): string {
	switch (languageId) {
		case 'javascript':
			return 'file.js';
		case 'javascriptreact':
			return 'file.jsx';
		case 'typescriptreact':
			return 'file.tsx';
		default:
			return 'file.ts';
	}
}

function uniq(values: string[]): string[] {
	return [...new Set(values)];
}

