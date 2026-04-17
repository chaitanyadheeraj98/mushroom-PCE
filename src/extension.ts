import * as vscode from 'vscode';

import { activateApp } from './app/activate';

export function activate(context: vscode.ExtensionContext): void {
	activateApp(context);
}

