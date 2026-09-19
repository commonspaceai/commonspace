# Evaluating context retrieval

The outcome we want is that an agent continues work correctly using less delivered
context and acceptable latency. Returning fewer tokens or building a shallow tree
is not evidence of that outcome by itself.

## Repeatable retrieval experiment

Run the local comparison without credentials:

```bash
pnpm --silent evaluate:context > /tmp/context-local.json
```

Exercise the real local embedding model (first use downloads public model files):

```bash
pnpm --silent evaluate:context --semantic > /tmp/context-hybrid.json
COMMONSPACE_LOCAL_EMBEDDINGS=1 pnpm test tests/local-history-embeddings.spec.ts
COMMONSPACE_CONTEXT_SIZES=100,1000,10000 pnpm --silent benchmark:context > /tmp/context-scale.json
```

`COMMONSPACE_EMBEDDING_CACHE` overrides the model cache for these evaluation
commands. It is not a remote inference endpoint. Semantic evaluation fails if it
receives lexical fallback, so a failed model cannot silently count as a hybrid run.
Initial scope indexing/model loading, new query inference with warm passages, and
cached-query latency are reported separately. The scale benchmark also measures
append/edit/delete reconciliation and counts newly embedded texts.

The [corpus](../../scripts/context-evaluation-cases.ts) has sixteen deliberately
adversarial cases: fourteen answerable and two without an answer. Each answerable
case has manually specified message IDs and exact source quotes. Together they
require eighteen evidence spans. Fixtures cover old constraints, corrections,
negation, dependencies across messages, facts deep inside one message, long-message
crowding, paraphrases, identifier spelling, and untrusted instructions. Most facts
are followed by unrelated recent messages, so the corpus deliberately disadvantages
a recency-only strategy. It is a diagnostic regression set, not a representative
or held-out accuracy estimate.

Every strategy gets at most four passages and 4,200 UTF-8 bytes in the same evidence
envelope. Whole passages are packed in rank order; oversized candidates are skipped,
not truncated. The strategies are:

| Strategy | Behavior |
| --- | --- |
| Recent | Most recent eligible passages first |
| Lexical baseline | Original BM25 ranking without identifier expansion |
| Expanded lexical | `ContextHistoryIndex.find`, including identifier expansion |
| Local hybrid (`--semantic`) | Actual runtime `findHybrid`: ten lexical plus ten local semantic candidates, reciprocal rank fusion, same delivery budget |
| Diversity experiment | Expanded BM25 top twenty, first passage from each message before additional passages |

The [scorer](../../scripts/context-evaluation.ts) verifies that every supplied
passage matches its canonical source and offset. It requires coverage of the entire
gold span, merging contiguous or overlapping intervals but never bridging gaps.
Finding another passage in the same message earns no recall credit.

The JSON report includes:

- Complete evidence at four passages and at one passage; all required spans must be
  present. Individual span recall identifies partially answered cases.
- Candidate recall at twenty for the expanded lexical shortlist, before the
  delivery budget. This is not a ceiling for hybrid retrieval, whose candidates
  also come from semantic search.
- Per-case useful-passage fraction, obsolete evidence without its required current
  answer, and empty results on unanswerable queries. Returning an undecided discussion
  can be useful; nonempty results are not evidence of hallucination.
- Exact common-envelope bytes, single-query latency, cold history-index construction,
  local model calls, model identity, and inference time where applicable.
  Common-envelope bytes exclude the larger MCP metadata and native framing.
- Corpus hash, protocol version, embedding model/revision when enabled, per-case selected source text and offsets, and
  timestamps. Small-history single-query p95 is descriptive, not a load-test estimate.

## How to improve from failures

Separate three failure locations before choosing an algorithm:

1. **Candidate generation:** if the needed span is absent from the top twenty, no
   reranker can rescue it. Identifier variants have a cheap lexical fix. Paraphrases
   such as "duplicate charges" versus "idempotency key" need semantic candidate
   generation, alternate queries, or a source-linked semantic index.
2. **Selection:** if candidates contain every needed fact but the delivered packet
   does not, test reranking and diversity at the same delivery budget. One passage
   per message can help with a repetitive log but lose two distant facts in the same
   message; retain that counterexample.
3. **Use:** if the agent receives all necessary evidence but still follows an obsolete
   instruction, that is an evidence-use failure. Fixing candidate recall alone does
   not prove that the continuation improves.

A semantic hierarchy experiment should add revisioned task labels and summaries
linked to source spans, with explicit correction relationships. Rebuild affected
ancestors after edits or deletions. Compare semantic candidates alone, lexical
candidates alone, and their union before testing reranking. Preserve multiple
branches for cross-topic questions, and record relevant branches wrongly pruned.
Use a declared traversal/inference budget; benchmark index construction, updates,
query work, storage, and model calls separately. A balanced tree does not guarantee
logarithmic retrieval when several branches need searching. Branch links do not
expand the existing authorization scope.

## Gate before promoting a semantic strategy

These fixtures are necessary regression evidence, not proof of general effectiveness.
The local hybrid path is enabled in the scoped history tool with explicit lexical
fallback. Neither the fixture scores nor timing runs establish native-agent task
success.
Collect an independently labeled, sanitized held-out set of real task failures
before tuning prompts, thresholds, or hierarchy labels against it. Keep development
and held-out conversations separate. Report per-category regressions, uncertainty,
and repeated model runs instead of selecting the best run. Require no scope or
source-fidelity regressions and an improvement in complete evidence under the same
budget; predeclare a latency and cost budget for the intended usage.

Then run paired continuation tasks through Commonspace with the actual Codex and
Hermes adapters. Give each arm an isolated native session with the same starting
task and workspace fixture; resume that exact session within its arm. Compare the
existing context flow with retrieval enabled, keeping total context and tool budgets
equal. Do not let the baseline arm read a treatment arm's messages or output. Check
answers against independently authored facts/citations and code changes against
behavioral acceptance tests, including deliberately unanswerable tasks. Record
constraint violations, obsolete-decision use, correct abstention, task completion,
delivered tokens, elapsed time, and inference usage. Repeat across tasks and runs.

Finally vary history size and edit rate (for example 100, 1,000, and 10,000 messages)
to measure construction, append/edit/delete maintenance, memory, warm queries, and
tail latency. Use provider cache telemetry when available; otherwise report cache
behavior as unmeasured. This protocol cannot establish KV-cache independence.
