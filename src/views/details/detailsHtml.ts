export function buildDetailsHtml(body: string, styles: string): string {
	return `<!doctype html><html><head><meta charset="UTF-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

