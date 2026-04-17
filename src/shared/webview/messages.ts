import { CircuitGraph } from '../types/circuitTypes';

export type CircuitWebviewMessage =
	| { type: 'navigate'; nodeId: string }
	| { type: 'openSkeleton'; nodeId: string; label?: string }
	| { type: 'viewNode'; nodeId: string }
	| { type: 'requestGraph'; scope: 'current-file' | 'full-architecture' | 'codeflow'; dependencyMode?: 'imports' | 'imports-calls' }
	| { type: 'updateGraph'; graph: CircuitGraph };

