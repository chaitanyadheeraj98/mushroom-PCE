import { escapeHtml } from './escapeHtml';

export function markdownToChatHtml(markdown: string): string {
	const inline = (text: string): string => {
		let result = escapeHtml(text);
		result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
		return result;
	};

	const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let inCode = false;
	let listMode: '' | 'ul' | 'ol' = '';

	const closeList = () => {
		if (listMode === 'ul') {
			out.push('</ul>');
		} else if (listMode === 'ol') {
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
			out.push(`<h3>${inline(line.slice(4))}</h3>`);
			continue;
		}
		if (line.startsWith('## ')) {
			closeList();
			out.push(`<h2>${inline(line.slice(3))}</h2>`);
			continue;
		}
		if (line.startsWith('# ')) {
			closeList();
			out.push(`<h1>${inline(line.slice(2))}</h1>`);
			continue;
		}
		if (/^[-*]\s+/.test(line)) {
			if (listMode !== 'ul') {
				closeList();
				out.push('<ul>');
				listMode = 'ul';
			}
			out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
			continue;
		}
		if (/^\d+\.\s+/.test(line)) {
			if (listMode !== 'ol') {
				closeList();
				out.push('<ol>');
				listMode = 'ol';
			}
			out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
			continue;
		}

		closeList();
		out.push(`<p>${inline(line)}</p>`);
	}

	closeList();
	return `<div class="msg msg-markdown">${out.join('') || '<p>No response generated.</p>'}</div>`;
}

