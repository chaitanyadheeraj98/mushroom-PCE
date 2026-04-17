export type CacheEntry = {
	text: string;
	updatedAt: number;
	docVersion: number;
};

export class AnalysisCache {
	private readonly cache = new Map<string, CacheEntry>();

	get(key: string): CacheEntry | undefined {
		return this.cache.get(key);
	}

	set(key: string, value: CacheEntry): void {
		this.cache.set(key, value);
	}

	clear(): void {
		this.cache.clear();
	}
}

