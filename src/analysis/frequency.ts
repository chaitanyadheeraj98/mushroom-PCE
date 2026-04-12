import { escapeRegExp } from '../utils/regex';

export function addFrequencyToListOutput(markdown: string, code: string): string {
	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const nextLines: string[] = [];

	for (const rawLine of lines) {
		const match = rawLine.match(/^(\s*[-*]\s+)(.+)$/);
		if (!match) {
			nextLines.push(rawLine);
			continue;
		}

		const prefix = match[1];
		const rawItem = match[2].trim();
		if (!rawItem || rawItem === '-') {
			nextLines.push(rawLine);
			continue;
		}

		const cleaned = rawItem.replace(/\s+\(x\d+\)\s*$/, '').trim();
		const count = countSymbolOccurrences(code, cleaned);
		if (count <= 0) {
			nextLines.push(`${prefix}${cleaned}`);
			continue;
		}

		nextLines.push(`${prefix}${cleaned} (x${count})`);
	}

	return nextLines.join('\n');
}

export function countSymbolOccurrences(code: string, symbol: string): number {
	const text = symbol.replace(/^`|`$/g, '').trim();
	if (!text || text === '-') {
		return 0;
	}

	// If a line contains aliases/descriptions, focus on the first token-like chunk.
	const baseToken = text.split(/\s+[-:|]/)[0].trim();
	const needle = baseToken || text;
	const escaped = escapeRegExp(needle);

	let regex: RegExp;
	if (/^[A-Za-z_$][\w$]*$/.test(needle)) {
		regex = new RegExp(`\\b${escaped}\\b`, 'g');
	} else {
		regex = new RegExp(escaped, 'g');
	}

	const matches = code.match(regex);
	return matches ? matches.length : 0;
}
