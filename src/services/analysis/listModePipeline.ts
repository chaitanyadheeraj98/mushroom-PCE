import * as vscode from 'vscode';

import { requestModelText } from '../ai/requestModelText';
import { buildListFormatPolishPrompt } from '../prompts/buildPrompt';
import { validateListPolish } from './verifyListPolish';

export type ListModeVariant = 'list-local' | 'list-ai-polished';

export type ListModePipelineResult = {
	text: string;
	variant: ListModeVariant;
	statusMessage: string;
	reason?: string;
};

export async function runListModePipeline(
	languageId: string,
	canonicalListOutput: string,
	model: vscode.LanguageModelChat | undefined,
	requestPolish?: (model: vscode.LanguageModelChat, prompt: string) => Promise<string | undefined>
): Promise<ListModePipelineResult> {
	if (!model) {
		return {
			text: canonicalListOutput,
			variant: 'list-local',
			statusMessage: 'List Mode (local only): AI polish unavailable',
			reason: 'no model available'
		};
	}

	const send = requestPolish ?? requestModelText;
	const prompt = buildListFormatPolishPrompt(languageId, canonicalListOutput);

	let polishedText: string | undefined;
	try {
		polishedText = await send(model, prompt);
	} catch (error: any) {
		return {
			text: canonicalListOutput,
			variant: 'list-local',
			statusMessage: 'List Mode (local only): AI polish failed, using strict output',
			reason: error?.message ?? String(error)
		};
	}

	const cleaned = String(polishedText || '').trim();
	if (!cleaned) {
		return {
			text: canonicalListOutput,
			variant: 'list-local',
			statusMessage: 'List Mode (local only): AI polish returned empty output',
			reason: 'empty AI polish output'
		};
	}

	const validation = validateListPolish(canonicalListOutput, cleaned);
	if (!validation.ok) {
		return {
			text: canonicalListOutput,
			variant: 'list-local',
			statusMessage: 'List Mode (local only): AI polish rejected, using strict output',
			reason: validation.reason
		};
	}

	return {
		text: cleaned,
		variant: 'list-ai-polished',
		statusMessage: 'List Mode (AI polished)'
	};
}
