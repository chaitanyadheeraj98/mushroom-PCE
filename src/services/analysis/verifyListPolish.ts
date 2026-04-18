export type ListSectionShape = {
	heading: string;
	bulletCount: number;
};

export type ListStructure = {
	sections: ListSectionShape[];
};

export type ListPolishValidation = {
	ok: boolean;
	reason?: string;
};

export function parseListStructure(markdown: string): ListStructure {
	const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
	const sections: ListSectionShape[] = [];
	let current: ListSectionShape | undefined;

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) {
			continue;
		}

		const mainHeader = line.match(/^#\s+(.+)$/);
		if (mainHeader) {
			current = {
				heading: mainHeader[1].trim(),
				bulletCount: 0
			};
			sections.push(current);
			continue;
		}

		if (!current) {
			continue;
		}

		if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
			current.bulletCount += 1;
		}
	}

	return { sections };
}

export function validateListPolish(canonical: string, polished: string): ListPolishValidation {
	const canonicalStructure = parseListStructure(canonical);
	const polishedStructure = parseListStructure(polished);

	if (canonicalStructure.sections.length === 0) {
		return { ok: false, reason: 'canonical output has no main sections' };
	}
	if (polishedStructure.sections.length === 0) {
		return { ok: false, reason: 'polished output has no main sections' };
	}
	if (canonicalStructure.sections.length !== polishedStructure.sections.length) {
		return {
			ok: false,
			reason: `section count mismatch (${canonicalStructure.sections.length} vs ${polishedStructure.sections.length})`
		};
	}

	for (let index = 0; index < canonicalStructure.sections.length; index++) {
		const expected = canonicalStructure.sections[index];
		const actual = polishedStructure.sections[index];
		if (expected.heading !== actual.heading) {
			return {
				ok: false,
				reason: `section heading mismatch at index ${index}: "${expected.heading}" vs "${actual.heading}"`
			};
		}
		if (expected.bulletCount !== actual.bulletCount) {
			return {
				ok: false,
				reason: `bullet count mismatch in section "${expected.heading}" (${expected.bulletCount} vs ${actual.bulletCount})`
			};
		}
	}

	return { ok: true };
}
