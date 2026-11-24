# Saved persistence probes

Production Library tests use an in-memory single-document store and a real native mutation lock. They cover concurrent independent saves, delete/save exclusion, stale editors, exact whitespace, names-only list results, full-document corruption rejection, and bounds.

The previous two-store put/metadata/cleanup rollback cases no longer exist. Their replacement proofs inject failures into create, replacement, and deletion writes and require the entire old document to remain intact. One encrypted document contains both metadata and text; no orphan value store requires cleanup.

Cross-process lock tests verify eight dummy-file increments, holder process death, missing or unsuccessful helpers, and release after callback failure. Mutation calibration disables each coordination layer and requires an assertion failure.

Locks are advisory. External writers and manual lockfile replacement are outside the contract. Real Raycast database durability, runtime mounting, and storage failure semantics require manual acceptance checks. A rejected storage promise may have committed; reopen the library before retrying.
