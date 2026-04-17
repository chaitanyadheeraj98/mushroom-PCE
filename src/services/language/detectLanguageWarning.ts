export function detectLanguageMismatchWarning(languageId: string, code: string): string | undefined {
	const text = code.trim();
	if (!text) {
		return undefined;
	}

	const normalizedLanguage = languageId.toLowerCase();
	const isTsLike = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(normalizedLanguage);
	const isPythonMode = normalizedLanguage === 'python';

	const pythonSignals = [/\bdef\s+[A-Za-z_]\w*\s*\(/, /\bprint\s*\(/, /\b(input|elif|None|True|False)\b/, /:\s*(#.*)?$/m];
	const tsSignals = [/\b(const|let|var|function|interface|type|class)\b/, /=>/, /[{}]/, /;\s*$/m];

	const pythonScore = pythonSignals.reduce((acc, regex) => (regex.test(text) ? acc + 1 : acc), 0);
	const tsScore = tsSignals.reduce((acc, regex) => (regex.test(text) ? acc + 1 : acc), 0);

	if (isTsLike && pythonScore >= 2 && pythonScore > tsScore) {
		return 'Language mode is set to TypeScript/JavaScript, but the code looks like Python. List Mode may miss symbols. Switch the file language mode for better results.';
	}
	if (isPythonMode && tsScore >= 2 && tsScore > pythonScore) {
		return 'Language mode is set to Python, but the code looks like TypeScript/JavaScript. List Mode may miss symbols. Switch the file language mode for better results.';
	}
	return undefined;
}
