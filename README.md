# Physical Key Macros

Save named text and type it into the app you opened Raycast from, without using the clipboard. Requires macOS 12+, Raycast, and a US/ABC keyboard layout.

## Install

Download and extract the ZIP from [Releases](https://github.com/campfireshuffle/raycast-keys/releases/latest), then run `npm ci` and `npx ray develop` in its folder. Prebuilt native helpers are included.

Building from source? Install Node.js, npm, and Xcode command-line tools, then run `npm ci` and `npm run dev`. See [development](docs/development.md) for build and release requirements.

## Use

1. Focus the destination app and field, then open **Type Saved Macro**.
2. Press **⌘N**, give the macro a non-secret name, enter its text, and save.
3. Select it and press **Enter** to type. **⌘E** edits it; deletion asks for confirmation.

Playback restores the captured app and waits one second before typing. Keep the intended field focused and leave the keyboard alone during playback. Check the result before continuing: success does not mean the destination accepted the text. Grant Accessibility and event-posting permissions before use; playback does not request them.

## Key commands

Text is literal by default; Enter is never added automatically. Enable **Use key commands** to make `hello[tab]world` type hello, press Tab, then type world. Other examples: `[enter]`, `[ctrl+a]`, `[shift+tab]`, `[wait:500]`.

Use 1–2000 printable ASCII characters. See [key-command syntax and limits](docs/development.md#key-command-syntax) for the full reference.

## Privacy and safety

- Names, text, and settings stay in Raycast’s encrypted local database. Keep secrets out of names. Masking only hides the editor text; it does not protect memory or OS diagnostics.
- Extension code uses no clipboard, network requests, analytics, or payload-bearing command arguments.
- Keystrokes use a global event stream. Focus can change between checks; switching fields within the same app is not detected. Applications may reject or transform events. Delivery is not guaranteed.
- Test with harmless text first. This is not a password manager.

[Development and release requirements](docs/development.md) · [Verification scope](docs/verification.md)
