import * as vscode from 'vscode';

export type NormalizedDocumentSymbol = {
	name: string;
	fullName: string;
	kind: vscode.SymbolKind;
	range: vscode.Range;
	selectionRange: vscode.Range;
};

export async function getNormalizedDocumentSymbols(uri: vscode.Uri): Promise<NormalizedDocumentSymbol[]> {
	try {
		const provided = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			uri
		);
		if (!provided?.length) {
			return [];
		}

		if (isDocumentSymbolArray(provided)) {
			const out: NormalizedDocumentSymbol[] = [];
			const walk = (symbols: vscode.DocumentSymbol[], parents: string[]): void => {
				for (const symbol of symbols) {
					const fullName = [...parents, symbol.name].join('.');
					out.push({
						name: symbol.name,
						fullName,
						kind: symbol.kind,
						range: symbol.range,
						selectionRange: symbol.selectionRange
					});
					if (symbol.children.length) {
						walk(symbol.children, [...parents, symbol.name]);
					}
				}
			};
			walk(provided, []);
			return sortSymbols(out);
		}

		const infos = provided.filter(isSymbolInformation);
		return sortSymbols(
			infos.map((symbol) => {
				const prefix = symbol.containerName ? `${symbol.containerName}.` : '';
				return {
					name: symbol.name,
					fullName: `${prefix}${symbol.name}`,
					kind: symbol.kind,
					range: symbol.location.range,
					selectionRange: symbol.location.range
				};
			})
		);
	} catch {
		return [];
	}
}

function isDocumentSymbolArray(
	values: (vscode.DocumentSymbol | vscode.SymbolInformation)[]
): values is vscode.DocumentSymbol[] {
	return values.every((item) => 'children' in item && 'selectionRange' in item);
}

function isSymbolInformation(value: vscode.DocumentSymbol | vscode.SymbolInformation): value is vscode.SymbolInformation {
	return 'location' in value;
}

function sortSymbols(symbols: NormalizedDocumentSymbol[]): NormalizedDocumentSymbol[] {
	return [...symbols].sort((a, b) => {
		if (a.selectionRange.start.line !== b.selectionRange.start.line) {
			return a.selectionRange.start.line - b.selectionRange.start.line;
		}
		if (a.selectionRange.start.character !== b.selectionRange.start.character) {
			return a.selectionRange.start.character - b.selectionRange.start.character;
		}
		return a.fullName.localeCompare(b.fullName);
	});
}
