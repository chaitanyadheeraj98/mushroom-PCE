export type CircuitNodeType = 'function' | 'sink';

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
