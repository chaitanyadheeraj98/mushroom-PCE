type AiJobLane = 'analysis' | 'node-chat' | 'circuit-ai' | string;

type QueuedJob<T> = {
	id: number;
	lane: AiJobLane;
	priority: number;
	createdAt: number;
	key?: string;
	group?: string;
	controller: AbortController;
	run: (signal: AbortSignal) => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
	promise: Promise<T>;
};

export type ScheduleAiJobRequest<T> = {
	lane: AiJobLane;
	run: (signal: AbortSignal) => Promise<T>;
	key?: string;
	group?: string;
	priority?: number;
	supersedeGroup?: boolean;
};

export type AiJobOrchestratorOptions = {
	maxConcurrent?: number;
	laneLimits?: Partial<Record<AiJobLane, number>>;
};

const CANCELLED_CODE = 'AI_JOB_CANCELLED';

export class AiJobCancelledError extends Error {
	readonly code = CANCELLED_CODE;

	constructor(message = 'AI job cancelled') {
		super(message);
		this.name = 'AiJobCancelledError';
	}
}

export function isAiJobCancelledError(error: unknown): error is AiJobCancelledError {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const code = (error as { code?: string }).code;
	return code === CANCELLED_CODE || error instanceof AiJobCancelledError;
}

export class AiJobOrchestrator {
	private readonly maxConcurrent: number;
	private readonly laneLimits: Partial<Record<AiJobLane, number>>;
	private readonly queue: Array<QueuedJob<unknown>> = [];
	private readonly active = new Set<QueuedJob<unknown>>();
	private readonly activeByLane = new Map<AiJobLane, number>();
	private readonly queuedByKey = new Map<string, Promise<unknown>>();
	private readonly inflightByKey = new Map<string, Promise<unknown>>();
	private nextJobId = 1;

	constructor(options?: AiJobOrchestratorOptions) {
		this.maxConcurrent = Math.max(1, options?.maxConcurrent ?? 2);
		this.laneLimits = options?.laneLimits ?? {};
	}

	schedule<T>(request: ScheduleAiJobRequest<T>): Promise<T> {
		if (request.key) {
			const queued = this.queuedByKey.get(request.key);
			if (queued) {
				return queued as Promise<T>;
			}
			const inflight = this.inflightByKey.get(request.key);
			if (inflight) {
				return inflight as Promise<T>;
			}
		}

		if (request.supersedeGroup && request.group) {
			this.cancelGroup(request.group, 'Superseded by newer request');
		}

		let resolve!: (value: T) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});

		const job: QueuedJob<T> = {
			id: this.nextJobId++,
			lane: request.lane,
			priority: request.priority ?? 0,
			createdAt: Date.now(),
			key: request.key,
			group: request.group,
			controller: new AbortController(),
			run: request.run,
			resolve,
			reject,
			promise
		};

		this.queue.push(job as QueuedJob<unknown>);
		this.queue.sort((a, b) => {
			if (a.priority !== b.priority) {
				return b.priority - a.priority;
			}
			return a.createdAt - b.createdAt;
		});
		if (job.key) {
			this.queuedByKey.set(job.key, promise as Promise<unknown>);
		}

		this.pump();
		return promise;
	}

	cancelGroup(group: string, reason?: string): void {
		for (let i = this.queue.length - 1; i >= 0; i--) {
			const job = this.queue[i];
			if (job.group !== group) {
				continue;
			}
			this.queue.splice(i, 1);
			this.cancelQueued(job, reason);
		}

		for (const job of this.active) {
			if (job.group !== group || job.controller.signal.aborted) {
				continue;
			}
			job.controller.abort(reason ?? 'Cancelled');
		}
	}

	private cancelQueued(job: QueuedJob<unknown>, reason?: string): void {
		if (job.key) {
			this.queuedByKey.delete(job.key);
		}
		job.reject(new AiJobCancelledError(reason ?? 'Cancelled'));
	}

	private getLaneLimit(lane: AiJobLane): number {
		const configured = this.laneLimits[lane];
		if (typeof configured !== 'number') {
			return Number.POSITIVE_INFINITY;
		}
		return Math.max(1, configured);
	}

	private getActiveLaneCount(lane: AiJobLane): number {
		return this.activeByLane.get(lane) ?? 0;
	}

	private incActiveLane(lane: AiJobLane): void {
		this.activeByLane.set(lane, this.getActiveLaneCount(lane) + 1);
	}

	private decActiveLane(lane: AiJobLane): void {
		const next = Math.max(0, this.getActiveLaneCount(lane) - 1);
		if (next <= 0) {
			this.activeByLane.delete(lane);
			return;
		}
		this.activeByLane.set(lane, next);
	}

	private pump(): void {
		while (this.active.size < this.maxConcurrent) {
			const nextIndex = this.queue.findIndex((job) => this.getActiveLaneCount(job.lane) < this.getLaneLimit(job.lane));
			if (nextIndex < 0) {
				break;
			}

			const [job] = this.queue.splice(nextIndex, 1);
			if (!job) {
				break;
			}

			if (job.key) {
				this.queuedByKey.delete(job.key);
				this.inflightByKey.set(job.key, job.promise);
			}
			this.active.add(job);
			this.incActiveLane(job.lane);

			void this.start(job);
		}
	}

	private async start(job: QueuedJob<unknown>): Promise<void> {
		try {
			const result = await job.run(job.controller.signal);
			job.resolve(result);
		} catch (error) {
			if (job.controller.signal.aborted && !isAiJobCancelledError(error)) {
				job.reject(new AiJobCancelledError(String(job.controller.signal.reason ?? 'Cancelled')));
			} else {
				job.reject(error);
			}
		} finally {
			this.active.delete(job);
			this.decActiveLane(job.lane);
			if (job.key) {
				this.inflightByKey.delete(job.key);
			}
			this.pump();
		}
	}
}
