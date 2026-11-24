import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "../../../src/macro";

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "macro-boundary-"));
function run(command: string, args: string[], input?: string) {
  const result = spawnSync(command, args, { input, encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(`SETUP: ${command}: ${result.error ?? result.stderr}`);
  return result.stdout;
}
function match(source: string, pattern: RegExp, label: string) {
  const value = source.match(pattern)?.[1];
  if (!value)
    throw new Error(`SETUP: ${label} mapping drifted; remap from production`);
  return value;
}
try {
  const native = readFileSync("native/KeySender.swift", "utf8");
  const form = readFileSync("src/form.tsx", "utf8");
  const play = readFileSync("src/play.ts", "utf8");
  // These are extraction guards, not successful invariant failures.
  assert.match(play, /JSON\.stringify\(\{ target, steps \}\)/);
  assert.match(native, /struct Request: Decodable \{ let target: Target;/);
  assert.match(form, /\.then\(captureTarget\)\s*\.then\(setTarget\)/);
  assert.match(
    play,
    /JSON\.stringify\(\{ bundleId: app.bundleId, path: app.path \}\)/,
  );
  assert.match(
    play,
    /target.bundleId !== app.bundleId \|\|\s*target.path !== app.path/,
  );
  assert.match(native, /candidates.count == 1/);
  const captureFilter = match(
    native,
    /let candidates = (NSRunningApplication[^\n]+)/,
    "capture candidates",
  );
  const resolver = match(
    native,
    /guard let app = NSRunningApplication\(processIdentifier: request.target.pid\), (matches\(app, request.target\)) else/,
    "identity resolution",
  );
  assert.match(
    native,
    /NSRunningApplication\(processIdentifier: app.processIdentifier\).map \{ matches\(\$0, request.target\) \} == true && NSWorkspace/,
  );
  const current = {
    pause: match(
      native,
      /( {4}func pause\(_ ms: Int\) throws \{[\s\S]*?\n {4}\})/,
      "pause",
    ),
    deadline: Number(
      match(
        native,
        /let deadline = Date\(\)\.addingTimeInterval\((\d+)\)/,
        "deadline",
      ),
    ),
    projection: "app",
    resolver: "unused",
    identity: match(
      native,
      /(func identity\([\s\S]*?)\nstruct Stroke/,
      "identity",
    ),
  };
  assert.match(native, /Date\(\) < deadline/);
  assert.match(
    native,
    /if let wait = step.wait \{ try pause\(wait\); continue \}/,
  );
  assert.match(
    native,
    /for \(stepIndex, step\) in request.steps.enumerated\(\) \{\s*guard focused\(\)/,
  );
  const leadIn = Number(
    match(native, /try pause\((\d+)\)\s*for \(stepIndex/, "lead-in"),
  );
  const strokeDelay = Number(
    match(
      native,
      /try pause\((\d+) - plan.count \* 2\)/,
      "total stroke pause (2ms per event plus remainder)",
    ),
  );
  const mutantMode = process.argv.includes("--mutants");
  const source = mutantMode
    ? JSON.parse(
        readFileSync(
          join(root, "tests/verification/playback-boundary/v1-mutant.json"),
          "utf8",
        ),
      )
    : current;
  const helper = join(scratch, "helper");
  run("swiftc", [
    "native/KeySender.swift",
    "-o",
    helper,
    "-framework",
    "AppKit",
    "-framework",
    "Carbon",
  ]);
  const cases = [
    { name: "short control", text: "[wait:3]z" },
    { name: "round-multiple control", text: "[wait:300]".repeat(194) + "z" },
    { name: "G1 near-limit", text: "[wait:303]".repeat(194) + "z" },
    { name: "G1 raised bound", text: "[wait:297]".repeat(198) + "z" },
  ];
  const plans = cases.map(({ text }) => parse(text));
  for (const steps of plans) {
    assert.match(
      run(
        helper,
        ["--dry-run"],
        JSON.stringify({
          target: {
            bundleId: "example.dummy",
            path: "/A.app",
            pid: 101,
            launch: 1,
          },
          steps,
        }),
      ),
      /no events posted/,
    );
  }
  const swift = `import Foundation
var now = 0.0
enum Failure: Error { case invalid }
enum Thread { static func sleep(forTimeInterval seconds: Double) { now += seconds } }
struct ProcessInfo { static let processInfo = ProcessInfo(); var systemUptime: Double { now } }
func focused() -> Bool { now + 0.0000001 < ${source.deadline}.0 }
${source.pause}
let plans = ${JSON.stringify(plans.map((steps) => [leadIn, ...steps.map((s) => ("wait" in s ? s.wait : strokeDelay))]))}
for plan in plans {
 now = 0
 var completed = 0
 do { for ms in plan { guard focused() else { throw Failure.invalid }; try pause(ms); completed += 1 } } catch {}
 print("timing \\(completed) \\(plan.count) \\(now)")
}
${
  mutantMode
    ? `struct Request { let target: String }`
    : `
struct Target { let bundleId: String; let path: String; let pid: Int32; let launch: Double }
struct NSRunningApplication {
 let bundleIdentifier: String?; let bundleURL: URL?; let processIdentifier: Int32; let launchDate: Date?; let isTerminated: Bool
}
${current.identity}
func app(_ path: String, _ pid: Int32, _ launch: Double = 1) -> NSRunningApplication {
 NSRunningApplication(bundleIdentifier: "same", bundleURL: URL(fileURLWithPath: path), processIdentifier: pid, launchDate: Date(timeIntervalSince1970: launch), isTerminated: false)
}
var running: [NSRunningApplication] = []
extension NSRunningApplication {
 static func runningApplications(withBundleIdentifier bundle: String) -> [NSRunningApplication] { running.filter { $0.bundleIdentifier == bundle } }
}
struct Capture { let bundleId: String; let path: String }
func capture(_ path: String) -> Target? {
 let capture = Capture(bundleId: "same", path: path)
 let candidates = ${captureFilter}
 guard candidates.count == 1, let app = candidates.first, let target = identity(app), matches(app, target) else { return nil }
 return target
}
running = [app("/A.app", 101), app("/B.app", 202)]
let captured = capture("/B.app")!
running = [app("/B.app", 202), app("/B.app", 303)]
assert(capture("/B.app") == nil)
running = []
assert(capture("/B.app") == nil)
struct Request { let target: Target }
func resolved(_ app: NSRunningApplication, _ target: Target) -> Bool {
 let request = Request(target: target)
 return ${resolver}
}
assert(!resolved(app("/B.app", 303), captured))
assert(matches(app("/B.app", 202), captured))
assert(!matches(app("/A.app", 101), captured))
assert(!matches(app("/B.app", 303), captured))
assert(!matches(app("/B.app", 202, 2), captured))
let otherBundle = NSRunningApplication(bundleIdentifier: "other", bundleURL: URL(fileURLWithPath: "/B.app"), processIdentifier: 202, launchDate: Date(timeIntervalSince1970: 1), isTerminated: false)
assert(!matches(otherBundle, captured))
assert(!matches(app("/A.app", 202), captured))
print("identity /B.app")
print("replacement -1")
print("control /A.app")
`
}
${
  mutantMode
    ? `
struct App { let bundle: String; let path: String; let processIdentifier: Int }
var running: [App] = []
enum NSRunningApplication {
 static func runningApplications(withBundleIdentifier bundle: String) -> [App] { running.filter { $0.bundle == bundle } }
}
func resolve(_ request: Request) -> App? { return ${source.resolver} }
let a = App(bundle: "same", path: "/A.app", processIdentifier: 101)
let b = App(bundle: "same", path: "/B.app", processIdentifier: 202)
running = [a,b]
print("identity \\(resolve(Request(target: "same"))?.path ?? "rejected")")
running = [App(bundle: "same", path: "/A.app", processIdentifier: 303)]
print("replacement \\(resolve(Request(target: "same"))?.processIdentifier ?? -1)")
running = [a]
print("control \\(resolve(Request(target: "same"))?.path ?? "rejected")")
`
    : ""
}
`;
  const script = join(scratch, "probe.swift");
  writeFileSync(script, swift);
  const lines = run("swift", [script]).trim().split("\n");
  if (!mutantMode) {
    for (const field of ["bundleId", "path", "pid", "launch"]) {
      const broken = swift.replace(
        `current.${field} == target.${field}`,
        "true",
      );
      assert.notEqual(broken, swift);
      writeFileSync(script, broken);
      const result = spawnSync("swift", [script], { encoding: "utf8" });
      assert.notEqual(
        result.status,
        0,
        `Removed ${field} identity guard must fail`,
      );
      assert.match(
        result.stderr,
        /Assertion failed/,
        "Mutant must fail behavior, not compilation",
      );
    }
    console.log(
      "PASS 4 identity guard mutants detected (bundle/path/PID/launch)",
    );
  }
  if (lines.length !== 7)
    throw new Error(`SETUP: unexpected probe output: ${lines}`);
  const failures: string[] = [];
  for (let i = 0; i < cases.length; i++) {
    const [, completed, count, elapsed] = lines[i].split(" ");
    const ok = completed === count;
    if (i < 2 && !ok) throw new Error(`DOCTOR: ${cases[i].name} failed`);
    console.log(
      `${ok ? "PASS" : "FAIL"} ${cases[i].name}: completed ${completed}/${count}, virtual seconds=${elapsed}`,
    );
    if (!ok) failures.push("G1");
  }
  const project = new Function("app", `return (${source.projection});`);
  const a = project({ path: "/A.app", bundleId: "same", name: "A" });
  const b = project({ path: "/B.app", bundleId: "same", name: "B" });
  const distinct = project({ path: "/C.app", bundleId: "other", name: "C" });
  assert.notDeepEqual(a, distinct, "DOCTOR: distinct bundle capture");
  assert.equal(lines[6], "control /A.app", "DOCTOR: singleton resolver");
  // If both captures yield the same request, resolution cannot honor both identities.
  // Rejecting the ambiguous request is safe; selecting A for capture B is not.
  const ambiguousUnsafe =
    JSON.stringify(a) === JSON.stringify(b) && lines[4] !== "identity rejected";
  console.log(
    `${ambiguousUnsafe ? "FAIL" : "PASS"} G2 capture B -> handoff -> ${lines[4]}`,
  );
  // No lifecycle identity exists in this wire request: an unchanged request must fail closed
  // after replacement if it promises capture-time process binding.
  const replacementUnsafe =
    typeof a === "string" && lines[5] !== "replacement -1";
  console.log(
    `${replacementUnsafe ? "FAIL" : "PASS"} G2 capture -> exit -> ${lines[5]} ${mutantMode ? "(capture has no PID)" : "(PID + launch identity checked)"}`,
  );
  if (ambiguousUnsafe || replacementUnsafe) failures.push("G2");
  if (mutantMode) {
    assert.deepEqual(
      [...new Set(failures)].sort(),
      ["G1", "G2"],
      "Mutants must fail both invariants, not setup",
    );
    console.log(
      "Known v1 mutants DETECTED; this is calibration, not a passing production check.",
    );
  } else if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 2;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
