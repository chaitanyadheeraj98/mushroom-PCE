export type CircuitNodeType = 'function' | 'variable' | 'import' | 'decision' | 'source' | 'sink';

export type CircuitNode = {
	id: string;
	type: CircuitNodeType;
	label: string;
	uri?: string;
	detail?: string;
	line?: number;
	character?: number;
};

export type CircuitEdge = {
	id: string;
	from: string;
	to: string;
	label?: string;
};

export type CircuitGraph = {
	nodes: CircuitNode[];
	edges: CircuitEdge[];
};
