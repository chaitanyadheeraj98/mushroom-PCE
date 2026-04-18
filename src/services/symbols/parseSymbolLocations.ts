import * as vscode from 'vscode';

import { SymbolKind, SymbolLocation } from '../../shared/types/appTypes';
import { getNormalizedDocumentSymbols } from './documentSymbols';

export async function parseSymbolLocations(document: vscode.TextDocument): Promise<SymbolLocation[]> {
	const locations: SymbolLocation[] = [];
	const seen = new Set<string>();
	const symbols = await getNormalizedDocumentSymbols(document.uri);

	for (const symbol of symbols) {
		const kind = mapSymbolKind(symbol.kind);
		if (!kind) {
			continue;
		}

		const name = symbol.name?.trim();
		if (!name) {
			continue;
		}

		const line = symbol.selectionRange.start.line;
		const character = symbol.selectionRange.start.character;
		const key = `${kind}:${name}:${line}:${character}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		locations.push({
			name,
			uri: document.uri,
			line,
			character,
			kind
		});
	}

	return locations;
}

function mapSymbolKind(kind: vscode.SymbolKind): SymbolKind | undefined {
	switch (kind) {
		case vscode.SymbolKind.Function:
		case vscode.SymbolKind.Method:
		case vscode.SymbolKind.Constructor:
			return 'function';
		case vscode.SymbolKind.Variable:
		case vscode.SymbolKind.Constant:
		case vscode.SymbolKind.Field:
		case vscode.SymbolKind.Property:
		case vscode.SymbolKind.EnumMember:
			return 'variable';
		case vscode.SymbolKind.Namespace:
		case vscode.SymbolKind.Module:
		case vscode.SymbolKind.Package:
			return 'import';
		default:
			return undefined;
	}
}
