# Physical Key Macros

Save named macros and type them into the app you opened Raycast from. Playback uses physical US keyboard events, not the clipboard. Requires macOS 12 or later and a US/ABC keyboard layout.

## Use

1. Focus the destination app and input field. Open **Type Saved Macro**.
2. Press **⌘N** to create a macro. Choose a non-secret name and enter its text.
3. Save, select the macro, and press **Enter** to send it. **⌘E** edits it. Deletion asks for confirmation.
4. Check the destination before continuing. A successful send does not confirm that the destination accepted the text.

Playback restores the captured app, waits one second, then types. Keep the same input field focused and do not use the keyboard during playback. Changing fields within the same app is not detected. Accessibility and event-posting permissions must already be granted; playback does not request them.

## Text and tokens

Literal mode is the default. Brackets and backslashes remain unchanged. Only printable ASCII is supported, with 1–2000 input characters and a 60-second planned-duration limit. Enter is never appended automatically.

Enable **Interpret macro tokens** for `[enter]`, `[tab]`, `[escape]`, `[backspace]`, chords such as `[ctrl+a]` or `[shift+tab]`, and waits such as `[wait:500]` (1–5000 milliseconds). Modifiers are `cmd`, `ctrl`, `alt`, and `shift`. Chord keys are letters, digits, or the listed special keys. Escape literal brackets and backslashes with a backslash. Raw newlines and tabs are rejected.

## Privacy and safety

- Text, names, and settings are stored together in Raycast’s encrypted, extension-isolated LocalStorage database. Never put secrets in names.
- Masking hides the editor field only. Text still exists in JavaScript and native process memory, pipes, and potentially OS diagnostics or swap. Memory is not securely erased.
- No clipboard, network requests, analytics, or payload-bearing command arguments are used by extension code.
- Focus and process identity are checked during playback. Input delivery remains a global-stream race: focus can change between a check and an event. Cleanup releases sender-owned keys on a best-effort basis; force termination can prevent cleanup.
- Remote desktops and Secure Input may reject or transform events. There is no universal compatibility or delivery guarantee. Test with harmless dummy text before using sensitive values. This is not a password manager.
- Each mutation replaces one validated, versioned library document under a cross-process lock. Corrupt libraries fail closed. Storage errors stop the operation; reopen the library to check its state.

## Development

Use Node.js, npm, and Xcode command-line tools on macOS:

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run verify:source
npm run validate:store
```

`npm run native` compiles both helpers for arm64 and x86_64 with a macOS 12 deployment target, combines each with `lipo`, and applies and verifies an ad-hoc signature. Helpers are generated into `assets` before Raycast builds. Sources and build steps are included; generated helpers must be present in the distributed extension, not committed as unexplained binaries. Builds are reproducible from the declared source/toolchain, not claimed byte-identical across Xcode versions. Do not replace helpers in an installed extension that is actively in use.

CI runs `npm run verify:source`: all deterministic tests, seeded fuzz, native allocation-only probes, persistence concurrency tests, mutation calibration, TypeScript, ESLint and Prettier across `src` and `tests`, the native/extension build, and playback boundary checks. These checks never type input, read real saved macros, or request permissions. See [verification](docs/verification.md) for their scope.

`npm run validate:store` (also available as `npm run lint`) runs full Raycast validation, including the external manifest-author lookup. `npm run checks` runs both source verification and Store validation. Source CI passing does not mean Store validation passed or that the extension is production ready. The manifest author currently returns HTTP 404 and remains a release blocker.

## Distribution gates

Store publication remains blocked until the manifest author passes Raycast account validation and native helper packaging is resolved. Raycast’s upstream CI may call `ray build` directly and bypass the npm native-build step. The distributed extension must include universal, executable helpers built from the included source. A local npm build does not establish Store readiness. Store submission needs official Swift integration or reviewer-approved native packaging.

Verify Intel execution, the minimum OS, installed helper permissions/signatures, and real Raycast flows before release. Publishing is a maintainer action after these gates are resolved.
