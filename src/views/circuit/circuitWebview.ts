import * as vscode from 'vscode';

import { CircuitGraph } from '../../shared/types/circuitTypes';
import { buildCircuitHtml, circuitBody } from './circuitHtml';
import { buildCircuitWebviewScript } from './circuitScript';
import { circuitStyles } from './circuitStyles';

export function buildCircuitPanelHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	graph: CircuitGraph,
	options?: {
		initialSkeletonRootNodeId?: string;
		initialViewMode?: 'architecture' | 'runtime';
		initialGraphifyContextEnabled?: boolean;
	}
): string {
	const nonce = getNonce();
	const cspSource = webview.cspSource;
	const graphJson = JSON.stringify(graph).replace(/</g, '\\u003c');
	const initialSkeletonRootNodeIdJson = JSON.stringify(options?.initialSkeletonRootNodeId ?? null);
	const initialViewModeJson = JSON.stringify(options?.initialViewMode ?? null);
	const initialGraphifyContextEnabledJson = JSON.stringify(Boolean(options?.initialGraphifyContextEnabled));

	const threeUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'three', 'build', 'three.module.js'));
	let jsmBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'three', 'examples', 'jsm')).toString();
	if (!jsmBaseUri.endsWith('/')) {
		jsmBaseUri += '/';
	}

	const script = buildCircuitWebviewScript(
		graphJson,
		initialSkeletonRootNodeIdJson,
		initialViewModeJson,
		initialGraphifyContextEnabledJson
	);
	return buildCircuitHtml({
		cspSource,
		nonce,
		threeUri: threeUri.toString(),
		jsmBaseUri,
		styles: circuitStyles,
		body: circuitBody,
		script
	});
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
