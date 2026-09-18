export interface HistoryEmbedder {
	embed(texts: readonly string[]): Promise<number[][]>;
}

interface SemanticSource {
	id: string;
	text: string;
}

function unitVector(
	values: readonly number[],
	dimensions?: number,
): Float32Array {
	if (
		values.length === 0 ||
		(dimensions !== undefined && values.length !== dimensions) ||
		values.some((v) => !Number.isFinite(v))
	)
		throw new Error("Invalid history embedding vector");
	const norm = Math.hypot(...values);
	if (norm === 0) throw new Error("Empty history embedding vector");
	return Float32Array.from(values, (value) => value / norm);
}

/** Only already-authorized source IDs enter this disposable, per-scope index. */
export class SemanticHistoryIndex {
	private readonly vectors = new Map<string, Float32Array>();
	private readonly queries = new Map<string, Float32Array>();
	private generation = 0;
	private warming: { generation: number; promise: Promise<void> } | undefined;
	constructor(private readonly encoder: HistoryEmbedder) {}

	invalidate(): void {
		this.generation += 1;
	}

	async search(
		sources: readonly SemanticSource[],
		query: string,
		limit: number,
	): Promise<string[]> {
		const generation = this.generation;
		let warming = this.warming;
		if (warming?.generation !== generation) {
			warming = { generation, promise: this.reconcile(sources, generation) };
			this.warming = warming;
		}
		try {
			await warming.promise;
		} finally {
			if (this.warming === warming) this.warming = undefined;
		}
		this.assertCurrent(generation);
		if (!sources.length) return [];
		const queryVector = await this.queryVector(query, generation);
		this.assertCurrent(generation);
		const ranked = sources.map((source) => {
			const vector = this.vectors.get(source.id);
			if (!vector || vector.length !== queryVector.length)
				throw new Error("Incompatible history embedding vector");
			let score = 0;
			for (let i = 0; i < vector.length; i++)
				score += (vector[i] ?? 0) * (queryVector[i] ?? 0);
			return { id: source.id, score };
		});
		return ranked
			.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
			.slice(0, limit)
			.map((r) => r.id);
	}

	private async reconcile(
		sources: readonly SemanticSource[],
		generation: number,
	): Promise<void> {
		const current = new Set(sources.map((s) => s.id));
		for (const id of this.vectors.keys())
			if (!current.has(id)) this.vectors.delete(id);
		const missing = sources.filter((s) => !this.vectors.has(s.id));
		for (let start = 0; start < missing.length; start += 8) {
			const batch = missing.slice(start, start + 8);
			const encoded = await this.encoder.embed(batch.map((s) => s.text));
			this.assertCurrent(generation);
			if (encoded.length !== batch.length)
				throw new Error("History embedding vector count mismatch");
			const dimensions = this.vectors.values().next().value?.length;
			const vectors = encoded.map((v) =>
				unitVector(v, dimensions ?? encoded[0]?.length),
			);
			for (const [i, source] of batch.entries()) {
				const vector = vectors[i];
				if (!vector) throw new Error("Missing history embedding vector");
				this.vectors.set(source.id, vector);
			}
		}
	}

	private async queryVector(
		query: string,
		generation: number,
	): Promise<Float32Array> {
		let queryVector = this.queries.get(query);
		if (queryVector === undefined) {
			const encoded = await this.encoder.embed([query]);
			this.assertCurrent(generation);
			if (encoded.length !== 1 || !encoded[0])
				throw new Error("Missing query embedding vector");
			queryVector = unitVector(
				encoded[0],
				this.vectors.values().next().value?.length,
			);
			this.queries.set(query, queryVector);
			if (this.queries.size > 32) {
				const oldest = this.queries.keys().next();
				if (!oldest.done) this.queries.delete(oldest.value);
			}
		}
		return queryVector;
	}

	private assertCurrent(generation: number): void {
		if (this.generation !== generation)
			throw new Error("History changed during semantic retrieval; retry.");
	}
}

/** Reciprocal rank fusion; cosine similarity and BM25 scores have different units. */
export function fuseHistoryRanks(
	lexical: readonly string[],
	semantic: readonly string[],
	limit: number,
): string[] {
	const scores = new Map<string, number>();
	for (const ranking of [lexical, semantic])
		for (const [rank, id] of [...new Set(ranking)].entries())
			scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1));
	return [...scores]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([id]) => id);
}
