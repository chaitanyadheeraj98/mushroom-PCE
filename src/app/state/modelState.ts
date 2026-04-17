import * as vscode from 'vscode';

export class ModelState {
	private availableModels: vscode.LanguageModelChat[] = [];
	private selectedModelId: string | undefined;

	getModels(): vscode.LanguageModelChat[] {
		return this.availableModels;
	}

	getSelectedModelId(): string | undefined {
		return this.selectedModelId;
	}

	setSelectedModelId(id: string | undefined): void {
		this.selectedModelId = id;
	}

	async reloadModels(): Promise<void> {
		this.availableModels = await vscode.lm.selectChatModels();
		if (!this.selectedModelId || !this.availableModels.some((model) => model.id === this.selectedModelId)) {
			this.selectedModelId = this.availableModels[0]?.id;
		}
	}
}

