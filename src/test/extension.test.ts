import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { buildListModeOutput } from '../services/analysis/buildListModeOutput';
import { runListModePipeline } from '../services/analysis/listModePipeline';
import { parseListStructure, validateListPolish } from '../services/analysis/verifyListPolish';
import { buildListFormatPolishPrompt } from '../services/prompts/buildPrompt';
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

	test('List Mode extracts structured TypeScript concepts without symbol tokens', async () => {
		const doc = await vscode.workspace.openTextDocument({
			language: 'typescript',
			content: `
import * as vscode from 'vscode';
import { CircuitDetailsPanel } from './CircuitDetailsPanelController';
import { CircuitGraph, CircuitNode } from '../../shared/types/circuitTypes';

export class CircuitPanel {
  private static currentPanel: CircuitPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private graph: CircuitGraph;
  private readonly onNavigate?: (node: CircuitNode, graph: CircuitGraph) => Promise<void>;

  static createOrShow(graph: CircuitGraph): CircuitPanel {
    if (CircuitPanel.currentPanel) {
      return CircuitPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel('id', 'Title', vscode.ViewColumn.Beside, {
      enableScripts: true
    });
    CircuitPanel.currentPanel = new CircuitPanel(panel, graph);
    return CircuitPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, graph: CircuitGraph) {
    this.panel = panel;
    this.graph = graph;
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      const openNodeById = async (nodeId: string): Promise<void> => {
        const node = this.graph.nodes.find((item) => item.id === nodeId);
        if (!node) {
          vscode.window.showInformationMessage('Missing node');
          return;
        }
        await this.onNavigate?.(node, this.graph);
      };
      if (msg?.type === 'navigate' && typeof msg?.nodeId === 'string') {
        await openNodeById(msg.nodeId);
      }
      this.panel.webview.postMessage({ type: 'graph', graph });
      CircuitDetailsPanel.syncGraph(graph);
    });
  }
}
`
		});

		const output = await buildListModeOutput(doc);
		assert.ok(output.includes('# IMPORTS'));
		assert.ok(output.includes('`vscode (namespace import)`'));
		assert.ok(output.includes('`CircuitGraph (type)`'));
		assert.ok(output.includes('# CLASS PROPERTIES'));
		assert.ok(output.includes('`currentPanel: CircuitPanel | undefined`'));
		assert.ok(output.includes('`createOrShow(graph: CircuitGraph): CircuitPanel`'));
		assert.ok(output.includes('Inside constructor: openNodeById(nodeId: string): Promise<void>'));
		assert.ok(output.includes('**Singleton Pattern**'));
		assert.ok(output.includes('**Factory Pattern**'));
		assert.ok(output.includes('`{ type: \'graph\', graph }`'));
		assert.ok(!output.includes('#sym:'), 'List Mode output should not expose internal symbol-link tokens');
	});

	test('List polish prompt uses canonical extraction and formatter-only contract', () => {
		const canonical = `
# IMPORTS
* \`vscode (namespace import)\`

# EXPORTS
* \`CircuitPanel (class)\`
`;
		const prompt = buildListFormatPolishPrompt('typescript', canonical);
		assert.ok(prompt.includes('CANONICAL LIST OUTPUT'));
		assert.ok(prompt.includes(canonical.trim()));
		assert.ok(prompt.includes('Do NOT infer from source code.'));
		assert.ok(prompt.includes('Keep every main section heading exactly as-is'));
		assert.ok(prompt.includes('same number of bullet items'));
		assert.ok(!prompt.includes('Code (typescript):'));
	});

	test('List polish validator rejects missing section', () => {
		const canonical = `
# IMPORTS
* \`vscode\`

# EXPORTS
* \`CircuitPanel\`
`;
		const polished = `
# IMPORTS
* \`vscode\`
`;
		const result = validateListPolish(canonical, polished);
		assert.strictEqual(result.ok, false);
		assert.ok(String(result.reason || '').includes('section count mismatch'));
	});

	test('List polish validator rejects bullet count mismatch', () => {
		const canonical = `
# IMPORTS
* \`vscode\`
* \`CircuitGraph\`
`;
		const polished = `
# IMPORTS
* \`vscode\`
`;
		const result = validateListPolish(canonical, polished);
		assert.strictEqual(result.ok, false);
		assert.ok(String(result.reason || '').includes('bullet count mismatch'));
	});

	test('List polish validator accepts preserved section shape', () => {
		const canonical = `
# IMPORTS
* \`vscode\`
* \`CircuitGraph\`
`;
		const polished = `
# IMPORTS
* \`vscode\` (namespace import)
* \`CircuitGraph\` (type)
`;
		const result = validateListPolish(canonical, polished);
		assert.strictEqual(result.ok, true);
	});

	test('List mode pipeline returns local-only output when model is unavailable', async () => {
		const canonical = `
# IMPORTS
* \`vscode\`
`;
		const result = await runListModePipeline('typescript', canonical, undefined);
		assert.strictEqual(result.variant, 'list-local');
		assert.strictEqual(result.text.trim(), canonical.trim());
		assert.ok(result.statusMessage.includes('local only'));
	});

	test('List mode pipeline uses AI-polished output when structure is preserved', async () => {
		const canonical = `
# IMPORTS
* \`vscode\`

# EXPORTS
* \`CircuitPanel\`
`;
		const polished = `
# IMPORTS
* \`vscode\` (namespace import)

# EXPORTS
* \`CircuitPanel\` (class)
`;
		const fakeModel = { id: 'fake-model' } as unknown as vscode.LanguageModelChat;
		const result = await runListModePipeline('typescript', canonical, fakeModel, async () => polished);
		assert.strictEqual(result.variant, 'list-ai-polished');
		assert.strictEqual(result.text.trim(), polished.trim());
		assert.ok(result.statusMessage.includes('AI polished'));
	});

	test('List mode pipeline falls back when AI polish breaks section shape', async () => {
		const canonical = `
# IMPORTS
* \`vscode\`

# EXPORTS
* \`CircuitPanel\`
`;
		const broken = `
# IMPORTS
* \`vscode\`
`;
		const fakeModel = { id: 'fake-model' } as unknown as vscode.LanguageModelChat;
		const result = await runListModePipeline('typescript', canonical, fakeModel, async () => broken);
		assert.strictEqual(result.variant, 'list-local');
		assert.strictEqual(result.text.trim(), canonical.trim());
		assert.ok(result.statusMessage.includes('local only'));
		assert.ok(result.reason);
	});

	test('parseListStructure tracks H1 sections and bullet counts', () => {
		const doc = `
Intro

# A
* one
* two
## Sub
* keep counting

# B
1. numbered
`;
		const structure = parseListStructure(doc);
		assert.deepStrictEqual(structure.sections, [
			{ heading: 'A', bulletCount: 3 },
			{ heading: 'B', bulletCount: 1 }
		]);
	});
});
