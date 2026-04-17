import { SymbolKind, SymbolLink } from '../shared/types/appTypes';

export function markdownToHtml(markdown: string, symbolLinks: SymbolLink[]): string {
	if (!markdown.trim()) {
		return '<p>Click Analyze to explain the active file.</p>';
	}

	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let inCode = false;
	let listMode: '' | 'ul' | 'ol' = '';
	let currentSection = '';

	const closeList = () => {
		if (listMode === 'ul') {
			out.push('</ul>');
		}
		if (listMode === 'ol') {
			out.push('</ol>');
		}
		listMode = '';
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line.startsWith('```')) {
			closeList();
			out.push(inCode ? '</code></pre>' : '<pre><code>');
			inCode = !inCode;
			continue;
		}
		if (inCode) {
			out.push(`${escapeHtml(rawLine)}\n`);
			continue;
		}
		if (!line) {
			closeList();
			continue;
		}
		if (line.startsWith('### ')) {
			closeList();
			currentSection = sectionKeyFromHeading(line.slice(4));
			out.push(`<h3>${inlineMd(line.slice(4), symbolLinks)}</h3>`);
			continue;
		}
		if (line.startsWith('## ')) {
			closeList();
			currentSection = sectionKeyFromHeading(line.slice(3));
			out.push(`<h2>${inlineMd(line.slice(3), symbolLinks)}</h2>`);
			continue;
		}
		if (line.startsWith('# ')) {
			closeList();
			currentSection = sectionKeyFromHeading(line.slice(2));
			out.push(`<h1>${inlineMd(line.slice(2), symbolLinks)}</h1>`);
			continue;
		}
		if (/^[-*]\s+/.test(line)) {
			if (listMode !== 'ul') {
				closeList();
				out.push('<ul>');
				listMode = 'ul';
			}
			out.push(`<li class="list-section-${currentSection || 'default'}">${inlineMd(line.replace(/^[-*]\s+/, ''), symbolLinks)}</li>`);
			continue;
		}
		if (/^\d+\.\s+/.test(line)) {
			if (listMode !== 'ol') {
				closeList();
				out.push('<ol>');
				listMode = 'ol';
			}
			out.push(`<li class="list-section-${currentSection || 'default'}">${inlineMd(line.replace(/^\d+\.\s+/, ''), symbolLinks)}</li>`);
			continue;
		}
		closeList();
		out.push(`<p>${inlineMd(line, symbolLinks)}</p>`);
	}
	closeList();
	return out.join('') || '<p>No explanation generated.</p>';
}

function sectionKeyFromHeading(heading: string): string {
	return heading
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/\//g, ' ')
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
}

function inlineMd(text: string, symbolLinks: SymbolLink[]): string {
	let result = escapeHtml(text);
	const symbolMap = new Map<string, SymbolLink[]>();
	for (const symbol of symbolLinks) {
		const existing = symbolMap.get(symbol.name) ?? [];
		existing.push(symbol);
		symbolMap.set(symbol.name, existing);
	}

	result = result.replace(/#sym:([A-Za-z_$][\w$]*)/g, (_whole, token: string) => {
		const symbol = resolveSymbolForToken(token, symbolMap);
		if (!symbol) {
			return `#sym:${escapeHtml(token)}`;
		}
		return `<a class="symbol-link symbol-${symbol.kind}" href="${symbol.commandUri}" title="Go to ${escapeHtml(token)}"><code>${escapeHtml(token)}</code></a>`;
	});

	result = result.replace(/\x60([^\x60]+)\x60/g, (_whole, token: string) => {
		const clean = token.trim();
		const symbol = resolveSymbolForToken(clean, symbolMap);
		const codeTag = `<code>${escapeHtml(clean)}</code>`;
		if (!symbol) {
			return codeTag;
		}
		return `<a class="symbol-link symbol-${symbol.kind}" href="${symbol.commandUri}" title="Go to ${escapeHtml(clean)}">${codeTag}</a>`;
	});
	result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	result = linkPlainSymbolsInHtml(result, symbolLinks);
	return result;
}

function resolveSymbolForToken(token: string, symbolMap: Map<string, SymbolLink[]>): SymbolLink | undefined {
	const candidates = extractTokenCandidates(token);
	for (const candidate of candidates) {
		const direct = pickPreferredSymbol(symbolMap.get(candidate));
		if (direct) {
			return direct;
		}
	}

	const lower = token.toLowerCase();
	for (const [name, symbols] of symbolMap.entries()) {
		if (name.toLowerCase() === lower) {
			return pickPreferredSymbol(symbols);
		}
	}

	return undefined;
}

function extractTokenCandidates(token: string): string[] {
	const out: string[] = [];
	const add = (value: string) => {
		const v = value.trim();
		if (v && !out.includes(v)) {
			out.push(v);
		}
	};

	add(token);
	add(token.replace(/^[^\w$]+|[^\w$]+$/g, ''));

	const identifierMatches = token.match(/[A-Za-z_$][\w$]*/g) ?? [];
	for (const id of identifierMatches) {
		add(id);
	}

	if (token.includes('.')) {
		for (const part of token.split('.')) {
			add(part);
		}
	}

	return out;
}

function pickPreferredSymbol(symbols: SymbolLink[] | undefined): SymbolLink | undefined {
	if (!symbols || symbols.length === 0) {
		return undefined;
	}
	const order: Record<SymbolKind, number> = {
		function: 0,
		variable: 1,
		import: 2
	};
	return [...symbols].sort((a, b) => order[a.kind] - order[b.kind])[0];
}

function linkPlainSymbolsInHtml(html: string, symbolLinks: SymbolLink[]): string {
	if (!html || !symbolLinks.length) {
		return html;
	}

	const symbolMap = new Map<string, SymbolLink>();
	for (const symbol of symbolLinks) {
		if (!symbolMap.has(symbol.name)) {
			symbolMap.set(symbol.name, symbol);
		}
	}

	const names = [...symbolMap.keys()]
		.filter((name) => name.length >= 2)
		.sort((a, b) => b.length - a.length);
	if (!names.length) {
		return html;
	}

	const escapedNames = names.map(escapeRegExp);
	const pattern = new RegExp(`\\b(${escapedNames.join('|')})\\b`, 'g');

	return html
		.split(/(<[^>]+>)/g)
		.map((part) => {
			if (!part || part.startsWith('<')) {
				return part;
			}

			return part.replace(pattern, (match: string) => {
				const symbol = symbolMap.get(match);
				if (!symbol) {
					return match;
				}
				return `<a class="symbol-link symbol-${symbol.kind}" href="${symbol.commandUri}" title="Go to ${escapeHtml(match)}"><code>${escapeHtml(match)}</code></a>`;
			});
		})
		.join('');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}


