import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { buildCircuitGraph } from '../services/circuit/buildGraph';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Circuit graph includes architecture layers and root', async () => {
		const doc = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: `
export function activate() {}
const runAnalysis = () => {};
const selectModelCommand = () => {};
`
		});
		const graph = buildCircuitGraph(doc);
		const nodeIds = new Set(graph.nodes.map((n) => n.id));
		assert.ok(nodeIds.has('layer:system-root'));
		assert.ok(nodeIds.has('layer:system'));
		assert.ok(nodeIds.has('layer:command'));
		assert.ok(nodeIds.has('layer:orchestration'));
		assert.ok(graph.edges.some((e) => e.kind === 'architecture'));
	});

	test('Circuit graph creates runtime sink for console.log flow', async () => {
		const doc = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: `
function foo() { return 1; }
console.log(foo());
`
		});
		const graph = buildCircuitGraph(doc);
		const sink = graph.nodes.find((n) => n.id === 'sink:console.log');
		assert.ok(sink, 'console sink should be created');
		assert.ok(graph.edges.some((e) => e.to === 'sink:console.log' && e.kind === 'runtime'));
	});

	test('Top-level executable script creates main runtime node', async () => {
		const doc = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: `
const a = 1;
const b = 2;
console.log(a + b);
`
		});
		const graph = buildCircuitGraph(doc);
		const hasMain = graph.nodes.some((n) => n.id === 'function:main');
		assert.ok(hasMain, 'main node should exist for top-level executable statements');
	});

	test('activate is classified under system layer', async () => {
		const doc = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: `
export function activate(context: unknown) {
  return context;
}
`
		});
		const graph = buildCircuitGraph(doc);
		const activateNode = graph.nodes.find((n) => n.id === 'function:activate');
		assert.ok(activateNode, 'activate node should exist');
		assert.strictEqual(activateNode?.layer, 'system');
	});
});
