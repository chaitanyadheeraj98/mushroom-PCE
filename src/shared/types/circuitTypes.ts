export type CircuitNodeType = 'function' | 'sink' | 'layer' | 'module' | 'state' | 'utility';
export type CircuitLayer =
	| 'system'
	| 'command'
	| 'orchestration'
	| 'state'
	| 'ui'
	| 'feature'
	| 'utility'
	| 'runtime';

export type CircuitPortDirection = 'in' | 'out';
export type CircuitPortKind = 'param' | 'return' | 'sideEffect' | 'call';

export type CircuitPort = {
	id: string;
	name: string;
	direction: CircuitPortDirection;
	kind: CircuitPortKind;
	// Optional extra info for tooltips.
	detail?: string;
};

export type CircuitNode = {
	id: string;
	type: CircuitNodeType;
	layer?: CircuitLayer;
	groupId?: string;
	parentId?: string;
	label: string;
	uri?: string;
	detail?: string;
	line?: number;
	character?: number;
	inputs?: CircuitPort[];
	outputs?: CircuitPort[];
};

export type CircuitEdge = {
	id: string;
	kind?: 'architecture' | 'runtime';
	from: string;
	to: string;
	fromPort?: string;
	toPort?: string;
	label?: string;
};

export type CircuitGraph = {
	nodes: CircuitNode[];
	edges: CircuitEdge[];
};

export type CircuitAiNodeSummary = {
	nodeId: string;
	summary: string;
	confidence: number;
};

export type CircuitAiInsight = {
	title: string;
	detail: string;
	confidence: number;
};

export type CircuitAiSuggestedEdge = {
	from: string;
	to: string;
	kind: 'runtime' | 'architecture';
	label: string;
	confidence: number;
	reason: string;
};

export type NodeGraphifyNeighborEvidence = {
	node: string;
	relation: string;
	source: string;
};

export type NodeGraphifyPathEvidence = {
	from: string;
	to: string;
	summary: string;
	source: string;
};

export type NodeGraphifyLinkedFileEvidence = {
	path: string;
	score: number;
	source: string;
};

export type NodeGraphifyEvidenceResult = {
	incoming: NodeGraphifyNeighborEvidence[];
	outgoing: NodeGraphifyNeighborEvidence[];
	paths: NodeGraphifyPathEvidence[];
	topLinkedFiles: NodeGraphifyLinkedFileEvidence[];
	summary: string;
	status: 'ok' | 'fallback';
	fallbackReason?: string;
	compactText: string;
};

export type CircuitAiEnrichmentResult = {
	nodeSummaries: CircuitAiNodeSummary[];
	insights: CircuitAiInsight[];
	suggestedEdges: CircuitAiSuggestedEdge[];
	modelLabel?: string;
	generatedAt: number;
	graphifyEvidenceStatus?: 'ok' | 'fallback' | 'off';
	graphifyEvidenceMessage?: string;
};
