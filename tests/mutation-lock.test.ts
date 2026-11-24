import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mutationLock } from "../src/mutation-lock";

test(
  "native lock coordinates processes, releases on crash and callback failure, fails closed",
  { timeout: 20000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "macro-lock-probe-"));
    const path = join(dir, "lock");
    const data = join(dir, "dummy-count");
    const helper = join(process.cwd(), "assets/mutation-lock");
    const lock = mutationLock(path, helper);
    const worker = (mode: string) =>
      spawn(
        process.execPath,
        ["--import", "tsx", "tests/lock-worker.ts", path, helper, data, mode],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
    try {
      let writes = 0;
      for (const bad of ["/nonexistent/macro-lock", "/usr/bin/false"])
        await assert.rejects(
          mutationLock(
            path,
            bad,
          )(async () => {
            writes++;
          }),
        );
      assert.equal(writes, 0);
      await assert.rejects(
        lock(async () => {
          throw new Error("dummy failure");
        }),
      );
      await lock(async () => {
        writes++;
      });
      assert.equal(writes, 1);
      await writeFile(data, "0");
      const holder = worker("hold");
      try {
        await once(holder.stdout, "data");
        const competitors = Array.from({ length: 8 }, () =>
          worker("increment"),
        );
        const finished = competitors.map(async (child) => {
          const [code] = await once(child, "close");
          assert.equal(code, 0);
        });
        holder.kill("SIGKILL");
        await once(holder, "close");
        await Promise.all(finished);
        assert.equal(await readFile(data, "utf8"), "8");
      } finally {
        holder.kill("SIGKILL");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
