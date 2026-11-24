import AppKit
import Carbon
import Darwin

struct Step: Decodable { let key: String?; let modifiers: [String]?; let wait: Int? }
struct Target: Codable { let bundleId: String; let path: String; let pid: Int32; let launch: Double }
struct Request: Decodable { let target: Target; let steps: [Step] }
func identity(_ app: NSRunningApplication) -> Target? {
    guard !app.isTerminated, app.processIdentifier > 0, let bundleId = app.bundleIdentifier,
          bundleId != "com.raycast.macos", let path = app.bundleURL?.path, let launch = app.launchDate else { return nil }
    return Target(bundleId: bundleId, path: path, pid: app.processIdentifier, launch: launch.timeIntervalSince1970)
}
func matches(_ app: NSRunningApplication, _ target: Target) -> Bool {
    guard let current = identity(app) else { return false }
    return current.bundleId == target.bundleId && current.path == target.path && current.pid == target.pid && current.launch == target.launch
}
struct Stroke { let code: CGKeyCode; let flags: CGEventFlags }
enum Failure: Error { case invalid }
let codes: [Character: CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,".":47," ":49,"`":50]
let shifted = Dictionary(uniqueKeysWithValues: zip(Array("~!@#$%^&*()_+{}|:\"<>?"), Array("`1234567890-=[]\\;',./")))
let specials: [String: CGKeyCode] = ["enter":36,"tab":48,"escape":53,"backspace":51]
let modifierFlags: [String: CGEventFlags] = ["cmd":.maskCommand,"ctrl":.maskControl,"alt":.maskAlternate,"shift":.maskShift]
func stroke(_ key: String, _ modifiers: [String]) throws -> Stroke {
    guard modifiers.count == Set(modifiers).count, modifiers.allSatisfy({ modifierFlags[$0] != nil }) else { throw Failure.invalid }
    var flags = modifiers.reduce(CGEventFlags()) { $0.union(modifierFlags[$1]!) }
    if let code = specials[key] { return Stroke(code: code, flags: flags) }
    guard key.count == 1, let character = key.first, character.isASCII else { throw Failure.invalid }
    let lower = Character(key.lowercased())
    let base: Character
    if let unshifted = shifted[character] { base = unshifted; flags.insert(.maskShift) }
    else { base = lower; if character != lower { flags.insert(.maskShift) } }
    guard let code = codes[base] else { throw Failure.invalid }
    return Stroke(code: code, flags: flags)
}
func validate(_ request: Request) throws {
    guard !request.target.bundleId.isEmpty, request.target.bundleId != "com.raycast.macos", request.target.path.hasPrefix("/"), request.target.pid > 0, request.target.launch.isFinite, request.target.launch > 0, !request.steps.isEmpty, request.steps.count <= 2000 else { throw Failure.invalid }
    var duration = 1000
    for step in request.steps {
        if let wait = step.wait {
            guard step.key == nil, step.modifiers == nil, (1...5000).contains(wait) else { throw Failure.invalid }
            duration += wait
        } else {
            guard let key = step.key, let modifiers = step.modifiers else { throw Failure.invalid }
            _ = try stroke(key, modifiers); duration += 40
        }
    }
    guard duration <= 60000 else { throw Failure.invalid }
}
struct KeyEvent { let code: CGKeyCode; let down: Bool; let flags: CGEventFlags }
// IOKit/hidsystem/IOLLEvent.h: NX_DEVICELSHIFT/CTL/ALT/CMDKEYMASK.
// Own both aggregate and left-device state; never inherit physical keyboard flags.
let modifierKeys: [(CGKeyCode, CGEventFlags)] = [
    (56, CGEventFlags(rawValue: CGEventFlags.maskShift.rawValue | 0x2)),
    (59, CGEventFlags(rawValue: CGEventFlags.maskControl.rawValue | 0x1)),
    (58, CGEventFlags(rawValue: CGEventFlags.maskAlternate.rawValue | 0x20)),
    (55, CGEventFlags(rawValue: CGEventFlags.maskCommand.rawValue | 0x8))
]
func eventPlan(_ value: Stroke) -> [KeyEvent] {
    var flags = CGEventFlags()
    var events: [KeyEvent] = []
    let modifiers = modifierKeys.filter { !value.flags.intersection($0.1).isEmpty }
    for (code, flag) in modifiers {
        flags.insert(flag)
        events.append(KeyEvent(code: code, down: true, flags: flags))
    }
    events.append(KeyEvent(code: value.code, down: true, flags: flags))
    events.append(KeyEvent(code: value.code, down: false, flags: flags))
    for (code, flag) in modifiers.reversed() {
        flags.remove(flag)
        events.append(KeyEvent(code: code, down: false, flags: flags))
    }
    return events
}
func allocateEvents(_ plan: [KeyEvent], source: CGEventSource,
                    make: (CGEventSource, CGKeyCode, Bool) -> CGEvent? = { CGEvent(keyboardEventSource: $0, virtualKey: $1, keyDown: $2) }) throws -> [CGEvent] {
    try plan.map { item in
        guard let event = make(source, item.code, item.down) else { throw Failure.invalid }
        event.flags = item.flags
        return event
    }
}
// One global stream for every target. The injectable adapter permits allocation-only tests.
func dispatch(_ event: CGEvent, post: (CGEvent, CGEventTapLocation) -> Void = { event, tap in event.post(tap: tap) }) {
    post(event, .cghidEventTap)
}
// Cleanup bypasses normal guards: only sender-owned releases, even after identity loss.
func emit(_ plan: [KeyEvent], allowed: () -> Bool,
          pause: (Int) throws -> Void, send: (Int) throws -> Void) throws {
    var held: [Int] = []
    defer {
        for index in held.reversed() {
            if let release = plan.indices.first(where: { $0 > index && !plan[$0].down && plan[$0].code == plan[index].code }) {
                try? send(release)
            }
        }
    }
    for index in plan.indices {
        guard allowed() else { throw Failure.invalid }
        let event = plan[index]
        // Register before sending: a throwing sink may have already delivered the press.
        if event.down { held.append(index) }
        try send(index)
        if !event.down { held.removeAll { plan[$0].code == event.code } }
        try pause(2)
    }
    try pause(40 - plan.count * 2)
}
func report(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }

if CommandLine.arguments.contains("--self-test") {
    do {
        for scalar in 32...126 { _ = try stroke(String(UnicodeScalar(scalar)!), []) }
        let bang = try stroke("!", [])
        let upper = try stroke("A", [])
        let tab = try stroke("tab", ["shift"])
        assert(bang.code == 18)
        assert(upper.flags.contains(.maskShift))
        assert(tab.code == 48)
        do { _ = try stroke("é", []); fatalError("Unicode accepted") } catch {}
        print("Native self-test: 95 ASCII mappings and special/invalid checks passed; no events posted.")
    } catch { report("Self-test failed"); exit(1) }
    exit(0)
}

do {
    // Read at most the protocol limit, never echo untrusted input.
    let data = FileHandle.standardInput.readData(ofLength: 262145)
    guard data.count <= 262144 else { throw Failure.invalid }
    if CommandLine.arguments.contains("--capture") {
        struct Capture: Decodable { let bundleId: String; let path: String }
        let capture = try JSONDecoder().decode(Capture.self, from: data)
        let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: capture.bundleId).filter { $0.bundleURL?.path == capture.path }
        guard candidates.count == 1, let app = candidates.first, let target = identity(app), matches(app, target) else { throw Failure.invalid }
        FileHandle.standardOutput.write(try JSONEncoder().encode(target))
        exit(0)
    }
    let request = try JSONDecoder().decode(Request.self, from: data)
    try validate(request)
    if CommandLine.arguments.contains("--dry-run") {
        print("Validated; no events posted.")
        exit(0)
    }
    let lockFD = open("/tmp/raycast-physical-key-macros-\(getuid()).lock", O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard lockFD >= 0 else { report("Could not acquire playback lock."); exit(1) }
    defer { close(lockFD) }
    guard flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { report("Another playback is already running."); exit(1) }
    guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else { report("Accessibility/event-posting permission is missing. No permission was requested."); exit(1) }
    report(IsSecureEventInputEnabled() ? "Secure Input ON; compatibility not guaranteed." : "Secure Input OFF; target may still reject events.")
    guard let app = NSRunningApplication(processIdentifier: request.target.pid), matches(app, request.target) else { report("Captured target is no longer running."); exit(1) }
    // Preallocate the complete request before activation or any input.
    guard let source = CGEventSource(stateID: .privateState) else { throw Failure.invalid }
    let prepared = try request.steps.map { step -> ([KeyEvent], [CGEvent]) in
        if step.wait != nil { return ([], []) }
        let plan = eventPlan(try stroke(step.key!, step.modifiers!))
        let events = try allocateEvents(plan, source: source)
        return (plan, events)
    }
    guard app.activate(options: []) else { report("Could not restore target."); exit(1) }
    let deadline = Date().addingTimeInterval(61)
    func focused() -> Bool { AXIsProcessTrusted() && CGPreflightPostEventAccess() && NSRunningApplication(processIdentifier: app.processIdentifier).map { matches($0, request.target) } == true && NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier && Date() < deadline }
    func pause(_ ms: Int) throws {
        let end = ProcessInfo.processInfo.systemUptime + Double(ms) / 1000
        while true {
            guard focused() else { throw Failure.invalid }
            let remaining = end - ProcessInfo.processInfo.systemUptime
            if remaining <= 0 { return }
            Thread.sleep(forTimeInterval: min(0.01, remaining))
        }
    }
    // Wait for activation acknowledgement, not a guessed activation delay.
    let activationDeadline = Date().addingTimeInterval(1)
    while !focused() && Date() < activationDeadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
    guard focused() else { throw Failure.invalid }
    try pause(1000)
    for (stepIndex, step) in request.steps.enumerated() {
        guard focused() else { throw Failure.invalid }
        if let wait = step.wait { try pause(wait); continue }
        let (plan, events) = prepared[stepIndex]
        try emit(plan, allowed: focused, pause: pause, send: { index in
            dispatch(events[index])
        })
    }
} catch {
    report("Playback rejected or stopped (invalid input, focus changed, or time limit).")
    exit(1)
}
