import * as vscode from 'vscode';

export type RequestModelTextOptions = {
	onChunk?: (chunk: string) => void;
	signal?: AbortSignal;
};

export async function requestModelText(
	model: vscode.LanguageModelChat,
	prompt: string,
	options?: RequestModelTextOptions
): Promise<string | undefined> {
	if (options?.signal?.aborted) {
		throw new Error(String(options.signal.reason ?? 'Request cancelled'));
	}

	const messages = [new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, prompt)];
	const response = await model.sendRequest(messages);
	const res: any = response;
	const streamCandidate = res?.stream ?? res;

	if (streamCandidate && typeof streamCandidate[Symbol.asyncIterator] === 'function') {
		let text = '';
		for await (const chunk of streamCandidate) {
			if (options?.signal?.aborted) {
				throw new Error(String(options.signal.reason ?? 'Request cancelled'));
			}
			const parsedChunk = extractTextFromChunk(chunk);
			if (parsedChunk) {
				text += parsedChunk;
				options?.onChunk?.(parsedChunk);
			}
		}
		return text;
	}

	if (Array.isArray(res?.content)) {
		let text = '';
		for (const item of res.content) {
			if (typeof item?.text === 'string') {
				text += item.text;
			}
		}
		return text;
	}

	if (typeof res?.text === 'string') {
		return res.text;
	}

	if (typeof res === 'string') {
		return res;
	}

	return JSON.stringify(res, null, 2);
}

export function extractTextFromChunk(chunk: unknown): string {
	if (typeof chunk === 'string') {
		return chunk;
	}

	if (!chunk || typeof chunk !== 'object') {
		return '';
	}

	const maybeText = (chunk as any).text;
	if (typeof maybeText === 'string') {
		return maybeText;
	}

	const maybeValue = (chunk as any).value;
	if (typeof maybeValue === 'string') {
		return maybeValue;
	}

	if (Array.isArray((chunk as any).content)) {
		return (chunk as any).content
			.map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
			.join('');
	}

	return '';
}
