import { ResponseMode } from '../../shared/types/appTypes';

type BuildPromptOptions = {
	graphContext?: string;
};

export function buildPrompt(
	languageId: string,
	code: string,
	responseMode: ResponseMode,
	options?: BuildPromptOptions
): string {
	const graphContextBlock = options?.graphContext?.trim()
		? `
Graphify Project Context (authoritative high-level architecture summary):
\`\`\`markdown
${options.graphContext.trim()}
\`\`\`

Use this Graphify context to improve architecture-level accuracy and navigation decisions.
When it conflicts with uncertain assumptions, prefer the Graphify context.
If "Graphify Smart Query Context (CLI)" or "Graphify Path Evidence (CLI)" is present:
- Treat those node/edge/path outputs as concrete evidence.
- In each high/medium finding, add one explicit graph citation line:
  - Graph Evidence: <query/path summary with node/edge identifiers from context>
  - If no relevant graph evidence exists for a finding, say: Graph Evidence: none found in provided graph context.
`
		: '';
	const developerPrompt = `
You are an expert engineering code reviewer.

Primary goals (in order):
1. Correctness
2. Security
3. Maintainability
4. Performance
5. Testing completeness

Return Markdown only.
Do not use markdown tables.
Use backticks for code identifiers.
When referencing a symbol, wrap only the bare identifier in backticks (for example, \`myFunction\`).
Be specific and evidence-based. Avoid generic advice.
Prioritize concrete, high-impact findings over broad summaries.

Required structure (use exactly these headings):
# Review Summary
# System Role and Linked Impact
# Findings
# Open Questions
# Suggested Next Steps

Review behavior:
- In "Review Summary", provide 2-4 bullets on overall quality and risk.
- In "System Role and Linked Impact", classify the active file as exactly one: \`big_machine\`, \`connector\`, or \`small_cog\`.
- In "System Role and Linked Impact", include:
  - Role decision + short why
  - Top linked files (if provided)
  - Whether linked dependencies appear to be working as intended
  - Fallback note when linked graph context is unavailable
- In "Findings", list issues ordered by severity: blocker, high, medium, low.
- For each finding include:
  - Severity: blocker | high | medium | low
  - Evidence: specific function, condition, or code behavior (and line reference if visible)
  - Why it matters
  - Suggested fix
- Focus on real risks: auth, input validation, unsafe assumptions, data integrity, error handling, race conditions, API contract breaks, and missing critical-path tests.
- If no meaningful issues are found, explicitly say "No major findings." and include residual risks or testing gaps.
- In "Open Questions", ask only clarification questions that materially affect correctness/security decisions.
- In "Suggested Next Steps", provide a short, prioritized action list.
${graphContextBlock}

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

	const definitionPrompt = `
You are a beginner-friendly code explainer.

Goal:
- Explain what this file does in simple language.
- Explain how this file connects to other files and whether those connections seem to behave as intended.
- Help a beginner understand both local logic and system context.

Return Markdown only.
Do not use markdown tables.
Use backticks for code identifiers.
Keep explanations clear and practical.

Required structure (use exactly these headings):
# File Purpose
# Core Flow
# Functions and Responsibilities
# Connected Files and Dependencies
# Is This File a Core Engine or a Supporting Cog?
# Behavior Check in System Context
# Risks or Red Flags
# Quick Glossary
# Key Takeaways

Definition mode behavior:
- Keep language beginner-friendly but technically accurate.
- In "Connected Files and Dependencies", cite linked files and relationships when graph context is available.
- In "Is This File a Core Engine or a Supporting Cog?", classify as one of: \`big_machine\`, \`connector\`, \`small_cog\`, with a short reason.
- In "Behavior Check in System Context", explain whether this file appears to be working as intended relative to connected files.
- If graph context is missing, explicitly say linked-file inference is limited and continue with current-file analysis.
- Include concrete examples from code where possible.
${graphContextBlock}

Code (${languageId}):
\`\`\`${languageId}
${code}
\`\`\`
`;

	if (responseMode === 'list') {
		return listPrompt;
	}

	return responseMode === 'definition' ? definitionPrompt : developerPrompt;
}

export function buildListFormatPolishPrompt(languageId: string, canonicalListOutput: string): string {
	return `
You are a professional technical formatter.

TASK:
Rewrite the provided LIST MODE extraction to be cleaner and more readable, while preserving extracted facts exactly.

INPUT TYPE:
- The input is already a deterministic static extraction.
- Do NOT infer from source code.
- Do NOT add concepts that are not explicitly present.

STRICT RULES:
- Keep every main section heading exactly as-is (same text, same order).
- Keep the same number of bullet items inside each main section.
- Do not delete any bullet item.
- Do not merge or split bullet items.
- Do not reclassify items into different main sections.
- You may only improve wording, punctuation, and visual consistency.
- Preserve code identifiers and types using backticks.
- Output Markdown only.

LANGUAGE CONTEXT: ${languageId}

CANONICAL LIST OUTPUT:
\`\`\`markdown
${canonicalListOutput}
\`\`\`
`;
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
	developerAnalysis?: string;
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

	const isContextBot =
		String(request.node.label || '').toLowerCase().includes('context bot') ||
		String(request.node.detail || '').toLowerCase().includes('context-bot');

	if (isContextBot) {
		return `
You are Mushroom PCE's Context Bot assistant.

CRITICAL BEHAVIOR:
- You are given TWO contexts:
  1) Developer Analysis (whole-file understanding)
  2) Connected Snippets (node-level focused context)
- Use Developer Analysis to understand the full file behavior.
- Use Connected Snippets to answer precise node-specific questions.
- Do NOT explain what "Context Bot" is unless the user explicitly asks that.
- Ignore disconnected project code.
- If Connected Snippets are empty, still answer from Developer Analysis when possible.

Response style:
- Keep it simple, practical, and concise.
- Use markdown bullets.
- Prefer "what the connected code is doing" + "why it matters".

Developer Analysis (whole file):
\`\`\`
${request.developerAnalysis || '(no developer analysis available)'}
\`\`\`

Connected Snippets:
\`\`\`
${request.snippet || '(no connected snippets available)'}
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



