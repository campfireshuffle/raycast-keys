import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, Library, Storage } from "../src/saved";
import { parse } from "../src/macro";
import { mutationLock } from "../src/mutation-lock";
import { join } from "node:path";
import { tmpdir } from "node:os";
const lock = mutationLock(
  join(tmpdir(), `raycast-saved-test-${process.pid}.lock`),
  join(process.cwd(), "assets/mutation-lock"),
);

function fixture() {
  let raw: string | undefined;
  const fail = { write: false };
  const storage: Storage = {
    read: async () => raw,
    write: async (value) => {
      if (fail.write) throw new Error("Storage failed.");
      raw = value;
    },
  };
  return {
    library: new Library(storage, lock),
    other: new Library(storage, lock),
    fail,
    raw: () => raw,
    corrupt: (value: string) => {
      raw = value;
    },
  };
}

const input = { name: "Dummy macro", mask: false, interpret: false };
test("concurrent independent callers retain both successful saves", async () => {
  const f = fixture();
  await Promise.all([f.library.save(input, "A"), f.other.save(input, "B")]);
  const items = await f.library.list();
  assert.equal(items.length, 2);
  assert.deepEqual(
    (await Promise.all(items.map((m) => f.library.text(m)))).sort(),
    ["A", "B"],
  );
});
test("concurrent delete and save cannot resurrect deleted metadata", async () => {
  const f = fixture();
  await f.library.save(input, "A");
  const [a] = await f.library.list();
  await Promise.all([f.library.delete(a), f.other.save(input, "C")]);
  const items = await f.library.list();
  assert.equal(items.length, 1);
  assert.equal(await f.library.text(items[0]), "C");
});
test("single-document create, names-only list, replacement and deletion", async () => {
  const f = fixture();
  await f.library.save(input, "  dummy[enter]\\  ");
  const [m] = await f.library.list();
  assert.equal(await f.library.text(m), "  dummy[enter]\\  ");
  assert.equal("text" in m, false);
  assert.equal(decode(f.raw())[0].text, "  dummy[enter]\\  ");
  await f.library.save({ ...input, mask: true }, " dummy2 ", m);
  const [updated] = await f.library.list();
  assert.notEqual(updated.id, m.id);
  assert.equal(
    decode(f.raw()).some((item) => item.id === m.id),
    false,
  );
  await f.library.delete(updated);
  assert.deepEqual(await f.library.list(), []);
  assert.equal(decode(f.raw()).length, 0);
});
test("concurrent stale edits reject without removing the successful replacement", async () => {
  const f = fixture();
  await f.library.save(input, "old");
  const [old] = await f.library.list();
  const results = await Promise.allSettled([
    f.library.save(input, "first", old),
    f.other.save(input, "second", old),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const [current] = await f.library.list();
  assert.notEqual(current.id, old.id);
  assert.ok(["first", "second"].includes(await f.library.text(current)));
  assert.equal(decode(f.raw()).length, 1);
});
// One atomic document replaces put/metadata/cleanup rollback: no orphan store exists.
for (const operation of ["create", "replace", "delete"] as const) {
  test(`failed ${operation} write preserves the complete previous document`, async () => {
    const f = fixture();
    await f.library.save(input, "old");
    const [m] = await f.library.list();
    const before = f.raw();
    f.fail.write = true;
    await assert.rejects(
      operation === "delete"
        ? f.library.delete(m)
        : f.library.save(input, "new", operation === "replace" ? m : undefined),
    );
    assert.equal(f.raw(), before);
    assert.equal(await f.library.text(m), "old");
  });
}
test("corrupt document blocks every read and mutation without overwrite", async () => {
  const f = fixture();
  await f.library.save(input, "old");
  const [m] = await f.library.list();
  f.corrupt('{"version":99,"items":[]}');
  const before = f.raw();
  for (const action of [
    () => f.library.list(),
    () => f.library.text(m),
    () => f.library.save(input, "new"),
    () => f.library.delete(m),
  ])
    await assert.rejects(action());
  assert.equal(f.raw(), before);
});
test("reject corruption, extra payload keys, duplicate IDs and invalid settings", () => {
  for (const raw of [
    "null",
    "{}",
    "[null]",
    "no json",
    JSON.stringify([{ id: "bad", ...input }]),
  ])
    assert.throws(() => decode(raw));
  const m = {
    ...input,
    text: "dummy",
    id: "dfe1f4b8-5713-4dac-a3ec-07b304f5556f",
  };
  for (const items of [
    [m, m],
    [{ ...m, extra: "dummy" }],
    [{ ...m, mask: "yes" }],
    [{ ...m, name: " " }],
  ])
    assert.throws(() => decode(JSON.stringify({ version: 1, items })));
});
test("literal token passwords remain literal; mask changes do not change parsing", async () => {
  const f = fixture();
  const text = "dummy[enter]\\";
  for (const mask of [false, true]) {
    await f.library.save({ ...input, mask }, text);
  }
  for (const m of await f.library.list()) {
    const steps = parse(await f.library.text(m), !m.interpret);
    assert.equal(steps.length, text.length);
    assert(steps.every((step) => "key" in step && step.key !== "enter"));
  }
});
test("name and count bounds reject before writing values", async () => {
  const f = fixture();
  for (const name of ["", " ", "x".repeat(81), "bad\nname"]) {
    await assert.rejects(f.library.save({ ...input, name }, "dummy"));
  }
  assert.equal(decode(f.raw()).length, 0);
  for (let i = 0; i < 100; i++) await f.library.save(input, "dummy");
  await assert.rejects(f.library.save(input, "dummy"));
  assert.equal(decode(f.raw()).length, 100);
});
test("invalid interpreted macro is rejected before any storage", async () => {
  const f = fixture();
  await assert.rejects(
    f.library.save({ ...input, interpret: true }, "[unknown]"),
  );
  assert.equal(decode(f.raw()).length, 0);
  assert.equal(f.raw(), undefined);
});
