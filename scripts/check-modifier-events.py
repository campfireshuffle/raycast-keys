"""Check production event handling without posting input; detect known broken variants."""
import pathlib
import subprocess
import tempfile
root = pathlib.Path(__file__).resolve().parent.parent
production = (root / 'native/KeySender.swift').read_text()
source = production.split('if CommandLine.arguments.contains("--self-test")')[0]
assert 'postToPid' not in production
assert production.count('.post(tap:') == 1
assert 'dispatch(events[index])' in production
assert 'try emit(plan, allowed: focused, pause: pause' in production
focus = production.split('func focused() -> Bool {')[1].split('\n')[0]
for gate in ['AXIsProcessTrusted()', 'CGPreflightPostEventAccess()', 'matches($0, request.target)', 'frontmostApplication', 'Date() < deadline']:
    assert gate in focus, gate
assert 'let events = try allocateEvents(plan, source: source)' in production
assert production.index('let prepared =') < production.index('app.activate(')
assert production.index('CGPreflightPostEventAccess()') < production.index('app.activate(')
assert 'guard focused() else' in production.split('func pause(')[1]
assert 'bundleId' not in source.split('func dispatch(')[1].split('// Cleanup')[0]
gate = 'func observedAllowed() -> Bool {' + focus
for expression, fake in [
    ('AXIsProcessTrusted()', 'ax'), ('CGPreflightPostEventAccess()', 'posting'),
    ('NSRunningApplication(processIdentifier: app.processIdentifier).map { matches($0, request.target) } == true', 'identityOK'),
    ('NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier', 'foreground'),
    ('Date() < deadline', 'beforeDeadline')]:
    gate = gate.replace(expression, fake)
source += '\nvar ax = true, posting = true, identityOK = true, foreground = true, beforeDeadline = true\n' + gate + '\n'
probe = r'''
var routes: [String] = []
func recordHID(_ event: CGEvent, _ tap: CGEventTapLocation) { routes.append(tap == .cghidEventTap ? "hid" : "other") }
func recordPID(_ event: CGEvent, _ pid: Int32) { routes.append("pid") }
func check(_ condition: Bool) { if !condition { print("EVENT ASSERTION FAILED"); exit(7) } }
let modifierCodes = Set(modifierKeys.map { $0.0 })
var received = ""
var held = Set<CGKeyCode>()
func receive(_ e: KeyEvent) {
    if modifierCodes.contains(e.code) {
        if e.down { held.insert(e.code) } else { held.remove(e.code) }
    } else if e.down {
        let base = codes.first { $0.value == e.code }!.key
        if held.contains(56) {
            let symbols = Dictionary(uniqueKeysWithValues: zip(Array("`1234567890-=[]\\;',./"), Array("~!@#$%^&*()_+{}|:\"<>?")))
            received += symbols[base].map(String.init) ?? String(base).uppercased()
        } else { received += String(base) }
    }
}
let text = String((32...126).map { Character(UnicodeScalar($0)!) }) + "aaAA!!@@zzZZ??"
for c in text {
    let plan = eventPlan(try stroke(String(c), []))
    var elapsed = 0
    try emit(plan, allowed: { true }, pause: { elapsed += $0 }, send: { receive(plan[$0]) })
    check(elapsed == 40 && held.isEmpty)
}
check(received == text)
let chord = eventPlan(try stroke("a", ["shift", "ctrl", "alt", "cmd"]))
check(chord.map { $0.code } == [56,59,58,55,0,0,55,58,59,56])
check(chord.map { $0.down } == [true,true,true,true,true,false,false,false,false,false])
var state = CGEventFlags()
for e in chord {
    if let flag = modifierKeys.first(where: { $0.0 == e.code })?.1 {
        if e.down { state.insert(flag) } else { state.remove(flag) }
    }
    check(e.flags == state)
}
// Every boundary: loss before next event, throw before/after delivery, or during settle.
for plan in [chord, eventPlan(try stroke("!", [])), eventPlan(try stroke("a", []))] {
 for boundary in 0...plan.count {
  for mode in 0...3 {
    var keys = Set<CGKeyCode>()
    var calls = 0
    var injected = false
    var focus = true
    func sink(_ index: Int) throws {
        let fail = calls == boundary && !injected && mode < 2
        calls += 1
        if fail { injected = true; if mode == 0 { throw Failure.invalid } }
        let event = plan[index]
        if event.down { keys.insert(event.code) } else { keys.remove(event.code) }
        if fail { throw Failure.invalid }
    }
    do {
      try emit(plan, allowed: { if mode == 2 && calls == boundary { focus = false }; return focus }, pause: { _ in
        if mode == 3 && calls == boundary && !injected { injected = true; focus = false; throw Failure.invalid }
      }, send: sink)
    } catch {}
    check(keys.isEmpty)
  }
 }
 var live = true
 var calls = 0
 do {
   try emit(plan, allowed: { live }, pause: { _ in live = false; throw Failure.invalid }, send: { _ in calls += 1 })
 } catch {}
 check(calls == 2) // global owned release despite lost identity
}
// Exercise the production default adapter with only OS posting substituted.
let source = CGEventSource(stateID: .privateState)!
for loss in 0..<5 {
 for boundary in 0...chord.count {
    ax = true; posting = true; identityOK = true; foreground = true; beforeDeadline = true
    var normal = 0
    var trace: [KeyEvent] = []
    do {
      try emit(chord, allowed: {
        if normal == boundary {
          switch loss {
          case 0: ax = false
          case 1: posting = false
          case 2: identityOK = false
          case 3: foreground = false
          default: beforeDeadline = false
          }
        }
        return observedAllowed()
      }, pause: { _ in }, send: { index in
        let item = chord[index]
        if !observedAllowed() { check(!item.down) } else { normal += 1 }
        trace.append(item)
        let event = CGEvent(keyboardEventSource: source, virtualKey: item.code, keyDown: item.down)!
        event.flags = item.flags
        dispatch(event)
      })
    } catch {}
    var owned = Set<CGKeyCode>()
    for item in trace {
        if item.down { owned.insert(item.code) } else { check(owned.remove(item.code) != nil) }
    }
    check(owned.isEmpty)
    check(trace.count == routes.count)
    check(routes.allSatisfy { $0 == "hid" })
    routes.removeAll()
 }
}
// SDK IOLLEvent.h NX_DEVICEL{SHIFT,CTL,ALT,CMD}KEYMASK; independent oracle.
let sided: [CGKeyCode: UInt64] = [56: 0x2, 59: 0x1, 58: 0x20, 55: 0x8]
for mask in 0..<16 {
 let names = ["shift", "ctrl", "alt", "cmd"].enumerated().filter { mask & (1 << $0.offset) != 0 }.map { $0.element }
 for key in (32...126).map({ String(UnicodeScalar($0)!) }) {
  let plan = eventPlan(try stroke(key, names))
  let allocated = try allocateEvents(plan, source: source)
  var owned = Set<CGKeyCode>()
  for (item, event) in zip(plan, allocated) {
   if modifierCodes.contains(item.code) { if item.down { owned.insert(item.code) } else { owned.remove(item.code) } }
   let expected = owned.reduce(UInt64(0)) { value, code in value | sided[code]! | modifierKeys.first { $0.0 == code }!.1.rawValue }
   check(event.flags.rawValue == expected)
   check(event.getIntegerValueField(.keyboardEventKeycode) == Int64(item.code))
   check(event.type == (modifierCodes.contains(item.code) ? .flagsChanged : (item.down ? .keyDown : .keyUp)))
  }
  for boundary in 0...plan.count {
   var calls = 0
   var owned = Set<CGKeyCode>()
   do {
    try emit(plan, allowed: { calls < boundary }, pause: { _ in }, send: { index in
     calls += 1
     let item = plan[index]
     if modifierCodes.contains(item.code) { if item.down { owned.insert(item.code) } else { owned.remove(item.code) } }
     let expected = owned.reduce(UInt64(0)) { value, code in value | sided[code]! | modifierKeys.first { $0.0 == code }!.1.rawValue }
     check(allocated[index].flags.rawValue == expected)
    })
   } catch {}
   check(owned.isEmpty)
  }
  for failAt in plan.indices {
   let postsBefore = routes.count
   var allocations = 0
   do {
    _ = try allocateEvents(plan, source: source, make: { source, code, down in
     defer { allocations += 1 }
     return allocations == failAt ? nil : CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
    })
    check(false)
   } catch {}
   check(allocations == failAt + 1 && routes.count == postsBefore)
  }
 }
}
print("PASS production planner/emitter/dispatch adapter: ASCII, repeats, chords, flags, failure/focus/identity/permission/deadline boundaries, global owned cleanup, allocation, 40ms budget")
'''
with tempfile.TemporaryDirectory(prefix='modifier-events-') as directory:
    for mutant in ['none', 'flags-only', 'pid-only', 'aggregate-only']:
        text = source
        if mutant == 'aggregate-only':
            text = text.replace('event.flags = item.flags', 'event.flags = CGEventFlags(rawValue: item.flags.rawValue & 0xffff0000)')
        if mutant == 'pid-only':
            text = text.replace('event.post(tap: tap)', 'event.postToPid(929)')
        # Never post: instrument the two OS side effects, leaving dispatch/default wiring intact.
        text = text.replace('event.post(tap: tap)', 'recordHID(event, tap)').replace('event.postToPid(929)', 'recordPID(event, 929)')
        if mutant == 'flags-only':
            start = text.index('func eventPlan(')
            end = text.index('func allocateEvents(', start)
            text = text[:start] + '''func eventPlan(_ value: Stroke) -> [KeyEvent] {
return [KeyEvent(code: value.code, down: true, flags: value.flags), KeyEvent(code: value.code, down: false, flags: [])]
}
''' + text[end:]
        path = pathlib.Path(directory) / 'probe.swift'
        path.write_text(text + probe)
        binary = str(path.with_suffix(''))
        subprocess.run(['swiftc', str(path), '-o', binary, '-framework', 'AppKit', '-framework', 'Carbon'], check=True)
        result = subprocess.run([binary], capture_output=True, text=True)
        if mutant != 'none':
            assert result.returncode == 7 and 'EVENT ASSERTION FAILED' in result.stdout, result
            print('DETECTED ' + mutant + ': production dispatch policy / modifier regression (not application acceptance)')
        else:
            assert result.returncode == 0, result.stdout + result.stderr
            print(result.stdout.strip())
