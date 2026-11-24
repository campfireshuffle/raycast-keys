# Playback boundary probes

Run `npm run check:boundary` for production timing and process-identity checks. Exit 0 means bounded checks passed; 1 means a violated invariant; 2 means setup or extraction drift. The test extracts actual production timing and identity implementations and substitutes a virtual clock and AppKit-shaped process objects.

Run `npm run check:boundary:mutants` to calibrate against the frozen `v1-mutant.json` fixture. Both near-limit timing and bundle-only identity must fail behaviorally while controls pass. This is not a passing production result.

See [verification scope](../../../docs/verification.md). No live events, saved-value access, or permission operations occur.
