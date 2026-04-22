import { CircuitAiEnrichmentResult, CircuitGraph } from '../types/circuitTypes';

export type CircuitWebviewMessage =
	| { type: 'navigate'; nodeId: string }
	| { type: 'openSkeleton'; nodeId: string; label?: string }
	| { type: 'viewNode'; nodeId: string }
	| { type: 'requestGraph'; scope: 'current-file' | 'full-architecture' | 'codeflow'; dependencyMode?: 'imports' | 'imports-calls' }
	| { type: 'updateGraph'; graph: CircuitGraph }
	| { type: 'requestAiEnrichment'; scope?: 'current-file' | 'full-architecture' | 'codeflow' }
	| { type: 'aiEnrichment'; result?: CircuitAiEnrichmentResult; error?: string }
	| { type: 'graphifyContextState'; enabled: boolean }
	| { type: 'requestAiRelationExplain'; fromNodeId: string; toNodeId: string }
	| { type: 'aiRelationExplain'; fromNodeId: string; toNodeId: string; text?: string; error?: string };
