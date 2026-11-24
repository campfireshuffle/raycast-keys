import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parse } from "../src/macro";

test("preserves leading, trailing and repeated spaces", () => {
  assert.deepEqual(
    parse(" a  "),
    [" ", "a", " ", " "].map((key) => ({ key, modifiers: [] })),
  );
});
test("specials, chords and waits", () => {
  assert.deepEqual(parse("[enter][shift+tab][ctrl+alt+a][wait:12]"), [
    { key: "enter", modifiers: [] },
    { key: "tab", modifiers: ["shift"] },
    { key: "a", modifiers: ["ctrl", "alt"] },
    { wait: 12 },
  ]);
});
test("escapes and literal mode do not expand syntax", () => {
  assert.equal(
    parse("\\[a\\]\\\\")
      .map((s) => ("key" in s ? s.key : ""))
      .join(""),
    "[a]\\",
  );
  assert.equal(parse("[enter]", true).length, 7);
});
test("rejects whole invalid macros, limits, controls and Unicode", () => {
  for (const input of [
    "",
    "x[bad]",
    "[enter",
    "]",
    "\\q",
    "\\",
    "\n",
    "\t",
    "é",
    "🙂",
    "[wait:0]",
    "[wait:5001]",
    "[wait:1foo]",
    "[ctrl+ctrl+a]",
    "[foo+a]",
    "a".repeat(2001),
    "[wait:5000]".repeat(12),
  ]) {
    assert.throws(() => parse(input), undefined, JSON.stringify(input));
  }
});
test("all printable ASCII accepted literally", () => {
  assert.equal(
    parse(
      Array.from({ length: 95 }, (_, n) => String.fromCharCode(n + 32)).join(
        "",
      ),
      true,
    ).length,
    95,
  );
});
test("bounded seeded fuzz never emits unsupported controls or overlong plans", () => {
  let seed = 42;
  for (let n = 0; n < 1000; n++) {
    let input = "";
    for (let j = 0; j < 30; j++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      input += String.fromCharCode(seed % 140);
    }
    let plan;
    try {
      plan = parse(input);
    } catch (error) {
      assert.ok(error instanceof Error);
      continue;
    }
    assert.ok(plan.length <= 2000);
    assert.ok(
      plan.every((step) => "wait" in step || /^[\x20-\x7e]$/.test(step.key)),
    );
  }
});
test("native runner boundary validates complete plan without permissions or event output", () => {
  const run = (value: unknown) =>
    spawnSync("assets/key-sender", ["--dry-run"], {
      input: JSON.stringify(value),
      encoding: "utf8",
    });
  const target = {
    bundleId: "example.dummy",
    path: "/A.app",
    pid: 101,
    launch: 1,
  };
  const valid = run({
    target,
    steps: parse("aA![shift+tab][wait:5]"),
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /no events posted/);
  for (const invalid of [
    "example.dummy",
    { ...target, pid: 0 },
    { ...target, launch: 0 },
    { ...target, path: "relative" },
  ]) {
    assert.notEqual(run({ target: invalid, steps: parse("a") }).status, 0);
  }
  for (const steps of [
    [
      { key: "a", modifiers: [] },
      { key: "é", modifiers: [] },
    ],
    [{ wait: 5001 }],
    [{ key: "a", modifiers: ["shell"] }],
    [{ key: "a", modifiers: [], wait: 10 }],
    [],
    Array(2001).fill({ wait: 1 }),
  ]) {
    assert.notEqual(run({ target, steps }).status, 0);
  }
  assert.notEqual(
    run({
      target: { ...target, bundleId: "com.raycast.macos" },
      steps: parse("a"),
    }).status,
    0,
  );
});
