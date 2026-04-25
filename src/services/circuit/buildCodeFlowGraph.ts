import * as ts from 'typescript';
import * as vscode from 'vscode';

import { CircuitEdge, CircuitGraph, CircuitLayer, CircuitNode } from '../../shared/types/circuitTypes';

type FlowBlock = {
	id: string;
	label: string;
	layer: CircuitLayer;
	line: number;
	character: number;
	detail: string;
	snippetHint?: string;
};

export function buildCodeFlowGraph(document: vscode.TextDocument): CircuitGraph {
	if (isDeclarationFileUri(document.uri)) {
		return buildDeclarationCodeFlowHint(document);
	}

	const code = document.getText();
	const sourceFile = ts.createSourceFile(
		document.fileName || 'file.ts',
		code,
		ts.ScriptTarget.Latest,
		true,
		inferScriptKind(document.languageId)
	);
	const uri = document.uri.toString();
	const blocks: FlowBlock[] = [];

	let importBlockStart: ts.ImportDeclaration | ts.ImportEqualsDeclaration | undefined;
	let importBlockEnd: ts.ImportDeclaration | ts.ImportEqualsDeclaration | undefined;
	let importCount = 0;

	const flushImports = (): void => {
		if (!importBlockStart || !importBlockEnd || importCount <= 0) {
			return;
		}
		const startPos = sourceFile.getLineAndCharacterOfPosition(importBlockStart.getStart(sourceFile));
		blocks.push({
			id: `codeflow:imports:${startPos.line}`,
			label: 'Imports',
			layer: 'utility',
			line: startPos.line,
			character: startPos.character,
			detail: `codeflow | imports (${importCount})`,
			snippetHint: 'import block'
		});
		importBlockStart = undefined;
		importBlockEnd = undefined;
		importCount = 0;
	};

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
			if (!importBlockStart) {
				importBlockStart = statement;
			}
			importBlockEnd = statement;
			importCount++;
			continue;
		}

		flushImports();
		const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));

		if (ts.isFunctionDeclaration(statement) && statement.name) {
			const asyncFlag = hasModifier(statement.modifiers, ts.SyntaxKind.AsyncKeyword) ? ' | async' : '';
			const exportFlag = hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword) ? ' | export' : '';
			blocks.push({
				id: `codeflow:function:${statement.name.text}:${start.line}`,
				label: statement.name.text,
				layer: 'feature',
				line: start.line,
				character: start.character,
				detail: `codeflow | function${asyncFlag}${exportFlag}`
			});
			continue;
		}

		if (ts.isClassDeclaration(statement) && statement.name) {
			const exportFlag = hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword) ? ' | export' : '';
			blocks.push({
				id: `codeflow:class:${statement.name.text}:${start.line}`,
				label: statement.name.text,
				layer: 'ui',
				line: start.line,
				character: start.character,
				detail: `codeflow | class${exportFlag}`
			});
			continue;
		}

		if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement)) {
			const name = statement.name?.getText(sourceFile) || 'type';
			blocks.push({
				id: `codeflow:type:${name}:${start.line}`,
				label: name,
				layer: 'state',
				line: start.line,
				character: start.character,
				detail: `codeflow | declaration`
			});
			continue;
		}

		if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
			blocks.push({
				id: `codeflow:exports:${start.line}`,
				label: 'Exports',
				layer: 'command',
				line: start.line,
				character: start.character,
				detail: 'codeflow | export block'
			});
			continue;
		}

		if (ts.isVariableStatement(statement)) {
			const exportFlag = hasModifier(statement.modifiers, ts.SyntaxKind.ExportKeyword) ? ' | export' : '';
			const asyncFlag = /async/i.test(statement.getText(sourceFile)) ? ' | async' : '';
			const first = statement.declarationList.declarations[0];
			const name = first && ts.isIdentifier(first.name) ? first.name.text : 'variable';
			blocks.push({
				id: `codeflow:var:${name}:${start.line}`,
				label: name,
				layer: 'orchestration',
				line: start.line,
				character: start.character,
				detail: `codeflow | variable${asyncFlag}${exportFlag}`
			});
			continue;
		}

		blocks.push({
			id: `codeflow:block:${start.line}`,
			label: `Block @${start.line + 1}`,
			layer: 'feature',
			line: start.line,
			character: start.character,
			detail: 'codeflow | statement block'
		});
	}

	flushImports();

	const nodes: CircuitNode[] = blocks.map((block) => ({
		id: block.id,
		type: 'function',
		layer: block.layer,
		groupId: 'group:codeflow',
		label: block.label,
		uri,
		line: block.line,
		character: block.character,
		detail: block.detail,
		inputs: [{ id: `in:${block.id}`, name: 'in', direction: 'in', kind: 'call', detail: 'previous step' }],
		outputs: [{ id: `out:${block.id}`, name: 'out', direction: 'out', kind: 'call', detail: 'next step' }]
	}));

	const edges: CircuitEdge[] = [];
	for (let i = 0; i < nodes.length - 1; i++) {
		edges.push({
			id: `e:${i}`,
			kind: 'runtime',
			from: nodes[i].id,
			to: nodes[i + 1].id,
			fromPort: nodes[i].outputs?.[0]?.id,
			toPort: nodes[i + 1].inputs?.[0]?.id,
			label: 'next [codeflow]'
		});
	}

	return { nodes, edges };
}

function hasModifier(modifiers: ts.NodeArray<ts.ModifierLike> | undefined, kind: ts.SyntaxKind): boolean {
	if (!modifiers) {
		return false;
	}
	return modifiers.some((modifier) => modifier.kind === kind);
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

function isDeclarationFileUri(uri: vscode.Uri): boolean {
	return /\.d\.ts$/i.test(uri.fsPath.replace(/\\/g, '/').toLowerCase());
}

function buildDeclarationCodeFlowHint(document: vscode.TextDocument): CircuitGraph {
	const uri = document.uri.toString();
	const rootId = `codeflow:decl:${uri}`;
	const hintId = `codeflow:decl:hint:${uri}`;
	return {
		nodes: [
			{
				id: rootId,
				type: 'module',
				layer: 'utility',
				groupId: 'group:codeflow',
				label: document.fileName.split(/[\\/]/).pop() || '.d.ts file',
				uri,
				detail: 'TypeScript declaration file (.d.ts)'
			},
			{
				id: hintId,
				type: 'utility',
				layer: 'utility',
				groupId: 'group:codeflow',
				label: 'CodeFlow ignored for declaration file',
				uri,
				detail: 'CodeFlow focuses on executable logic, not TypeScript declarations.'
			}
		],
		edges: [
			{
				id: 'e:0',
				kind: 'runtime',
				from: rootId,
				to: hintId,
				label: 'hint'
			}
		]
	};
}

