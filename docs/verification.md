# Verification

`npm test` runs the production parser and saved-library tests, native dry-run validation, and native mapping self-test. Seeded fuzz checks parser bounds. Persistence uses a fake single-document store and real advisory locks, including cross-process exclusion and release on process death. No test reads real saved values.

`python3 scripts/check-modifier-events.py` exercises production planning, allocation, dispatch adapters and cleanup without posting events. It checks complete aggregate/device modifier flags, allocation failures, focus gating, and behavioral mutants.

`python3 scripts/check-saved-mutants.py` and `python3 scripts/check-mutants.py` require intentional persistence/parser regressions to fail assertions rather than compilation.

`npm run check:boundary` extracts production timing and identity code into mocked Swift probes. Accepted near-limit plans must complete under ideal timing; bundle/path/PID/launch mismatches must reject. It also removes each identity equality and requires assertion failure. `npm run check:boundary:mutants` checks the frozen broken timing and bundle-only fixture; expected behavioral failures calibrate the probe.

Static source extraction guards intentionally fail when production shape changes. Remap them to the equivalent production seam rather than removing assertions. Keep the frozen mutant fixture unchanged.

Not covered: real Raycast mounting, input masking across remounts, focus restoration, actual event delivery, permissions, Secure Input, application acceptance, scheduler stalls, Intel execution, or minimum-OS execution. Manual acceptance must use harmless dummy text. Success indicates local events were sent, not destination receipt.
