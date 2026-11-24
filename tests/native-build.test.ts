import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const shell of ["/bin/bash", "/opt/homebrew/bin/bash"].filter(
  existsSync,
)) {
  test(`native build handles empty framework args and compiler failures under ${shell}`, () => {
    const root = mkdtempSync(join(tmpdir(), "native-build-test-"));
    try {
      for (const directory of ["scripts", "assets", "bin"])
        mkdirSync(join(root, directory));
      copyFileSync(
        "scripts/build-native.sh",
        join(root, "scripts/build-native.sh"),
      );
      const trace = join(root, "trace.jsonl");
      writeFileSync(
        join(root, "bin/xcrun"),
        `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TRACE, JSON.stringify(args) + "\\n");
if (args[0] === "swiftc") {
  if (process.env.FAIL_COMPILER === "1") process.exit(73);
  fs.writeFileSync(args[args.indexOf("-o") + 1], "dummy executable");
} else if (args.includes("-create")) {
  fs.writeFileSync(args[args.indexOf("-output") + 1], "dummy universal");
} else if (args.includes("-archs")) console.log("arm64 x86_64");
else process.exit(74);
`,
        { mode: 0o755 },
      );
      writeFileSync(join(root, "bin/codesign"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      const run = (fail: boolean) =>
        spawnSync(shell, [join(root, "scripts/build-native.sh")], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${join(root, "bin")}:${process.env.PATH}`,
            TRACE: trace,
            FAIL_COMPILER: fail ? "1" : "0",
          },
        });
      const success = run(false);
      assert.equal(success.status, 0, success.stderr);
      const calls: string[][] = readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const compiles = calls.filter((args) => args[0] === "swiftc");
      assert.equal(compiles.length, 4);
      for (const args of compiles) {
        assert.ok(!args.includes(""));
        assert.deepEqual(
          args.slice(args.indexOf("-o") + 2),
          args.includes("native/KeySender.swift")
            ? ["-framework", "AppKit", "-framework", "Carbon"]
            : [],
        );
      }
      for (const name of ["key-sender", "mutation-lock"])
        writeFileSync(join(root, "assets", name), "previous binary");
      writeFileSync(trace, "");
      const failure = run(true);
      assert.equal(failure.status, 73, failure.stderr);
      const failedCalls = readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(
        failedCalls.length,
        1,
        "must stop before any lipo or later compile",
      );
      for (const name of ["key-sender", "mutation-lock"])
        assert.equal(
          readFileSync(join(root, "assets", name), "utf8"),
          "previous binary",
        );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
