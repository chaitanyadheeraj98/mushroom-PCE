import * as vscode from 'vscode';

export type ModelOption = {
	id: string;
	label: string;
	detail: string;
};

export type SymbolKind = 'function' | 'variable' | 'import';
export type ResponseMode = 'list' | 'developer';

export type SymbolLocation = {
	name: string;
	uri: vscode.Uri;
	line: number;
	character: number;
	kind: SymbolKind;
};

export type SymbolLink = {
	name: string;
	kind: SymbolKind;
	commandUri: string;
};

