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
	| {
			type: 'requestAiRelationExplain';
			fromNodeId?: string;
			toNodeId?: string;
			userPrompt?: string;
			extraContextText?: string;
	  }
	| {
			type: 'exportRelationChatTranscript';
			fileName: string;
			exportMode?: 'edit' | 'update';
			turns?: Array<{ role?: string; text?: string }>;
	  }
	| {
			type: 'readRelationChatContext';
			fileName: string;
	  }
	| {
			type: 'relationChatExported';
			fileName?: string;
			path?: string;
			created?: boolean;
			exportMode?: 'edit' | 'update';
			exportedTurns?: number;
			skipped?: boolean;
			message?: string;
			error?: string;
	  }
	| {
			type: 'relationChatContextRead';
			fileName?: string;
			path?: string;
			contextText?: string;
			error?: string;
	  }
	| {
			type: 'aiRelationExplain';
			fromNodeId?: string;
			toNodeId?: string;
			userPrompt?: string;
			extraContextText?: string;
			text?: string;
			error?: string;
	  };
