# Development and release

## Build

Use Node.js, npm, and Xcode command-line tools on macOS. Run `npm ci`, then `npm run dev` to compile the native helpers and start Raycast development. A developer ZIP with prebuilt helpers can use `npx ray develop` after `npm ci` instead.

`npm run native` compiles both helpers for arm64 and x86_64 with a macOS 12 deployment target, combines each with `lipo`, and applies and verifies an ad-hoc signature. Helpers are generated into `assets` before Raycast builds. Distributions must include these executable helpers and their source/build steps. Builds are reproducible from the declared source/toolchain, not claimed byte-identical across Xcode versions. Do not replace helpers in an installed extension that is actively in use.

## Checks and release gates

`npm run verify:source` runs deterministic tests, seeded fuzz, allocation-only native probes, persistence concurrency tests, mutation calibration, TypeScript, ESLint, Prettier, native/extension builds, and playback boundary checks. These checks never type input, read real saved macros, or request permissions. See [verification](verification.md) for details and manual coverage gaps.

`npm run validate:store` (also `npm run lint`) runs full Raycast validation, including the external manifest-author lookup. `npm run checks` runs both source verification and Store validation. The manifest author currently returns HTTP 404; this remains a release blocker. Source CI passing does not establish Store readiness.

Store publication also requires resolving native helper packaging. Raycast’s upstream CI may call `ray build` directly and bypass the npm native-build step. Submission needs official Swift integration or reviewer-approved native packaging. A local npm build is not proof of Store readiness.

Before release, verify Intel execution, minimum-OS execution, installed helper permissions/signatures, and real Raycast flows with harmless dummy text. Publishing remains a maintainer action after these gates are resolved.

## Key-command syntax

Literal mode preserves brackets and backslashes. Only printable US/ABC ASCII is supported, with 1–2000 input characters and a 60-second planned-duration limit. Enter is never appended automatically.

**Use key commands** enables `[enter]`, `[tab]`, `[escape]`, `[backspace]`, chords such as `[ctrl+a]` or `[shift+tab]`, and waits such as `[wait:500]` (1–5000 milliseconds). Modifiers are `cmd`, `ctrl`, `alt`, and `shift`. Chord keys are letters, digits, or the listed special keys. Escape literal brackets and backslashes with a backslash. Raw newlines and tabs are rejected.

## Storage and playback safety

Text, names, and settings share Raycast’s encrypted, extension-isolated LocalStorage database. Each mutation replaces one validated, versioned library document under a cross-process lock. Corrupt libraries fail closed. Storage errors stop the operation; reopen the library to check its state.

Masking hides only the editor field. Text still exists in JavaScript and native process memory, pipes, and potentially OS diagnostics or swap. Memory is not securely erased.

Focus and process identity are checked during playback, but input delivery remains a global-stream race. Focus may change between a check and an event. Cleanup releases sender-owned keys on a best-effort basis; force termination can prevent cleanup. Success indicates locally sent events, not destination acceptance.
