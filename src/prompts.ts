import { ResponseMode } from './types';

export function buildPrompt(languageId: string, code: string, responseMode: ResponseMode): string {
	const developerPrompt = `
You are a friendly programming teacher for complete beginners.

Return Markdown only. Keep it clean, simple, and easy to read.

Required structure (use exactly these headings):
# Quick Summary
# Logic and Flow
# Functions
# Data Structures
# Program Structure
# Debugging and Quality
# Real-World Reading Path
# Imports and External Packages
# Example Input and Output
# Important Lines Explained
# Step-by-Step Flow
# Beginner Story
# Key Takeaways

Formatting rules:
- Use short bullet points.
- Do not use markdown tables.
- Use backticks for code identifiers.
- When referencing a symbol, wrap only the bare identifier in backticks (for example, \`myFunction\`, not \`myFunction(arg)\`).
- If a section has no items, write: - None
- Keep explanations simple, visual, and beginner-friendly.
- Start with what the code is trying to achieve in 1-2 sentences.
- Explain every new technical term in one short line.
- Explain not only what each part does, but why it exists.
- Use a beginner tone: "assume I have never seen this before."
- Explain what each import/package is used for in plain language.
- Explain what would happen without each important import/package.
- In "Logic and Flow", explicitly cover condition checks, loops, and boolean/comparison usage.
- In "Functions", explain input -> process -> output for each important function.
- In "Data Structures", show simple example values and how data changes over time.
- In "Program Structure", explain where execution starts and how parts connect.
- In "Debugging and Quality", include 2-3 common beginner mistakes and how to fix them.
- In "Real-World Reading Path", explain how data flows through variables, arrays/objects, and function calls.
- In "Example Input and Output", provide concrete sample input and expected output.
- In "Important Lines Explained", explain key lines only (not every single line).
- In "Step-by-Step Flow", simulate execution with a small sample and show state changes.
- In "Beginner Story", use one short real-life analogy (recipe/shopping/etc.) and keep it memorable.
- In "Deeper Concepts", mention async/promises/recursion/complexity only if actually present.
- In "Deeper Concepts", keep each concept to 1-2 lines max.
- Avoid jargon unless you also define it in one sentence.
- Keep each section concise to avoid overload (roughly 3-7 bullets per section when possible).

Code (${languageId}):
\`\`\`${languageId}
${code}
\`\`\`
`;

	const listPrompt = `
You are a static code analyzer.

Your task is to scan the given code and OUTPUT ONLY a structured list of all programming elements found.

DO NOT explain anything.
DO NOT add descriptions.
DO NOT add sentences.
ONLY list and group items like a Linux ls command output.

---

## OUTPUT FORMAT:

### IMPORTS
*

### EXPORTS
*

### VARIABLES
*

### CONSTANTS
*

### FUNCTIONS
*

### METHODS
*

### CLASSES
*

### SUPER CLASSES / INHERITANCE
*

### INTERFACES / TYPES / ENUMS
*

### OBJECTS / INSTANCES
*

### DATA MODELS / SCHEMAS
*

### PARAMETERS
*

### RETURN TYPES
*

### CONTROL STRUCTURES
* if
* else
* switch
* for
* while
* try/catch
* etc

### OPERATORS
*

### DATA STRUCTURES
* Array
* Object
* Map
* Set
* etc

### ASYNC / CONCURRENCY
* async
* await
* promises
* callbacks

### MODULE / FILE STRUCTURE
*

### OTHER CONCEPTS DETECTED
*

---

## RULES:
* No explanations
* No extra text
* No comments
* No examples
* No formatting beyond headings + bullet lists
* If empty, leave section with "-"
* Extract EVERYTHING detectable
* Deduplicate items
* Keep names exactly as in code

Output must look like a clean grouped inventory.

Code (${languageId}):
\`\`\`${languageId}
${code}
\`\`\`
`;

	return responseMode === 'list' ? listPrompt : developerPrompt;
}

type NodePromptRequest = {
	node: {
		label: string;
		type: string;
		layer?: string;
		line?: number;
		detail?: string;
	};
	snippet: string;
	question: string;
	history: Array<{ role: 'user' | 'assistant'; text: string }>;
	connectionContext: {
		incoming: string[];
		outgoing: string[];
	};
};

export function buildNodeDetailsPrompt(request: NodePromptRequest): string {
	const historyText = request.history
		.slice(-8)
		.map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`)
		.join('\n');

	return `
	
You are Mushroom PCE's Node Details assistant.
Answer the user's question using the node context and snippet below.
Be clear, practical, and concise. Use markdown bullet points when helpful.
If connection context is provided, treat it as authoritative graph evidence.
Do not deny an edge if it appears in incoming/outgoing lists.

Node:
- label: ${request.node.label}
- type: ${request.node.type}
- layer: ${request.node.layer ?? 'unknown'}
- line: ${typeof request.node.line === 'number' ? request.node.line + 1 : 'unknown'}
- detail: ${request.node.detail ?? 'n/a'}

Snippet:
\`\`\`
${request.snippet || '(no snippet available)'}
\`\`\`

Graph Connections:
- Incoming:
${request.connectionContext.incoming.length ? request.connectionContext.incoming.map((line) => `  - ${line}`).join('\n') : '  - none'}
- Outgoing:
${request.connectionContext.outgoing.length ? request.connectionContext.outgoing.map((line) => `  - ${line}`).join('\n') : '  - none'}

Recent Chat:
${historyText || '(no previous history)'}

User Question:
${request.question}
`;
}

