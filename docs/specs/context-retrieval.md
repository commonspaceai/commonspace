# Shared history retrieval

Commonspace preserves the conversation record and provides bounded ways to find
evidence within it. Shared summaries compress a representation of that record;
retrieval selects evidence for a particular request. Neither operation edits a
harness's native context or discards canonical messages.

## Runtime contract

Agents connected through Commonspace's scoped MCP server have two history tools:

- `commonspace_browse_history({})` returns a root with at most eight children.
  Follow `nodeId` to narrower chronological ranges and finally a source passage.
- `commonspace_find_history({query, limit})` combines local BM25 keyword retrieval
  and local embedding similarity to return up to eight passages and tree paths.
  The default limit is four. Ten candidates from each method are merged using
  reciprocal rank fusion (constant 60), deduplicated by source node. Search is
  candidate ranking, not semantic entailment or the quoted-phrase/exclusion syntax
  of `commonspace_search`.
  Compound query identifiers also search underscore and hyphen spellings while
  retaining the literal form (`AUTH_TOKEN_EXPIRED` and `AUTH-TOKEN-EXPIRED`).
  These are search candidates, not a claim that the identifiers are equivalent.
  Responses report `method: hybrid` with `semanticStatus: ready`, or
  `method: lexical` with `semanticStatus: unavailable` when local inference fails.
  The internal lexical-only baseline uses `semanticStatus: not-requested`.

Each leaf contains verbatim text, a message ID, a content revision, the author
type and name, creation time, Thread ID, total text length, and start/end offsets.
Offsets count UTF-16 code units. Passages contain at most 900 code units with
100-code-unit overlap; overlaps must be deduplicated by message ID and offsets
when reconstructing a message. A result's path permits reading adjacent evidence
instead of treating an isolated match as the complete story.

Branch previews are short source excerpts from the range endpoints. They are
navigational hints, **not semantic summaries of everything in the range**. Search
can locate material in the middle that the previews do not mention. No matches
does not establish absence; try alternate terms or browse the tree.

`commonspace_get_context` continues to supply instructions, human notes, pins,
shared summaries, and recent messages. Those authority layers are separate from
historical evidence. Retrieved text can include obsolete decisions, conflicting
claims, and untrusted instructions; its presence is not permission to act and
does not promote it into durable shared memory.

## Scope and freshness

Every read revalidates the capability's current Agent, conversation, Thread,
native-session generation, and Project references before accessing an index.
Semantic reads revalidate scope and the exact source root after asynchronous
inference; changes during retrieval produce a retry error rather than stale evidence.
The tree covers exactly the same conversation history as scoped message reads:

- Channel turns see their authorized Thread, including the permitted prefix of
  an edited branch's parent, but not unrelated Threads or Channels.
- DMs see only the active generation. `/new` expires old capabilities and old
  history is not searchable from the replacement generation.
- Deleted, empty, and system messages are not indexed. Agent and human text is
  included; tool traces, native session internals, host files, attachment contents,
  and private metadata are not.

Node IDs are derived from source revisions and child IDs. Unchanged subtrees can
retain IDs across appends. Edits and deletion invalidate affected IDs: callers
receive an error and must rediscover the current root. An ID grants no access on
its own; a node must exist in the current authorized index.

Indexes are derived, process-local state, rebuilt from canonical messages after
restart. The service keeps an LRU of at most sixteen scope indexes. No saved-data
format changes or migrations are needed. Returned source objects are detached
from the index, and reads do not mutate workspace messages, notes, pins, native
sessions, or snapshots.

## Cost and cache behavior

There is no Jev or other remote inference call in either history tool. The server
uses `@huggingface/transformers` with the q8 CPU model `Xenova/all-MiniLM-L6-v2`,
pinned to revision `751bff37182d3f1213fa05d7196b954e230abad9`. First semantic use
downloads public model/tokenizer files from Hugging Face into
`~/.cache/commonspace/embeddings`. Conversation text and query vectors are never
uploaded. The model mainly targets English; similarity is not an answerability
test and can return irrelevant passages even when the history has no answer.

Tokenization and inference run in one lazy worker per host service with one CPU
inference thread, batches of eight, at most 32 outstanding batches, a 120-second
batch deadline including queueing/model startup, and a 60-second retry cooldown
after worker failure. Shutdown terminates the worker and rejects pending requests.
Unavailable inference preserves lexical search with explicit response status.

Vectors are process-local, per authorized scope, keyed by source revision and
offsets. Unchanged passages reuse their vectors. New/edited passages are embedded
on the first semantic search after a change; removed sources are excluded before
ranking. This is lazy reconciliation, not background ingestion. Concurrent readers
of the same source generation share passage indexing. Each index caches up to 32
query vectors. Restart or scope eviction requires rebuilding vectors; only public
model weights are retained on disk. There is no vector-data migration.

Measure model startup/download and initial scope indexing separately from a warm
query. Initial indexing can take substantially longer and consists of multiple
batches; the batch deadline is not a total indexing deadline. Source reconciliation
checks message identities on reads; when a scope changes, tree construction
currently traverses its passages. Semantic ranking scans scoped vectors and sorts
their scores; BM25 visits matching postings. Following a known leaf path has
logarithmic depth, but **the complete retrieval workflow is not claimed to be
O(log n)**. Vector ranking still runs on the server thread; model inference runs
in the worker.

Native prompts keep the original request and existing participation metadata.
History enters a native session only when an agent requests a tool result. This
avoids automatically rebuilding a large history prefix on every turn. It does
not guarantee a provider cache hit, expose KV state, or replace native compaction.

## Design rationale and further work

The [fast-jev-compaction reference](https://github.com/tamaratran/fast-jev-compaction)
uses Jev judgments to remove or truncate older tool calls/results. That is an
interesting eviction policy, but it is not sufficient context management for
Commonspace. Its judgment state omits result bodies, preservation depends on
incomplete evidence, and a past tool result is not always reproducible by rerunning
the tool. Per-call questions and repeated state also have costs. Keeping all
conversation text does not guarantee that the remaining history fits a budget.

Commonspace instead separates the record, user-authoritative context, generated
summaries, and query-specific retrieval. The current tree is chronological within
an already scoped conversation. It does not yet implement semantic task labels,
automatic branch selection, workspace-wide recall, or cross-agent private-memory
sharing.

A future semantic hierarchy should use source-linked, revisioned branch summaries
and allow bounded multi-branch selection, with lexical retrieval as an escape
route when a summary omits a rare identifier. Jev can evaluate a small candidate
set where semantic judgments improve selection; it need not score every message
on every turn. Indexing and summary maintenance must be accounted for separately
from retrieval latency. Cross-conversation retrieval requires an explicit scope
and product change, rather than treating hierarchy links as authorization.

Evaluate that extension on old constraints, corrected decisions, negation,
cross-topic dependencies, and exact identifiers. Measure evidence recall,
contradiction handling, delivered tokens, inference cost, p95 latency, and native
continuation correctness against the lexical baseline before claiming better
compaction or cache independence.

The executable [evaluation protocol](context-retrieval-evaluation.md) compares
retrieval strategies with independently specified source spans, a common delivery
budget, and an opt-in Jev experiment. Its synthetic evidence scores do not establish
native-agent task success.
