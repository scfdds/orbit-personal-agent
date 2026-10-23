// Read visible WeChat notification cards through Accessibility. No database
// access, injection, screenshot capture, or outbound network requests.
import AppKit
import ApplicationServices
import Foundation
import CryptoKit

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) {
        print(line); fflush(stdout)
    }
}
struct NotificationCard: Equatable {
    let id: String
    let title: String
    let body: String
}
// A changed notification preview is a new observation; retries of the same
// preview keep the same ID so the host can persist it idempotently.
@Sendable func observationID(_ card: NotificationCard) -> String {
    let digest = SHA256.hash(data: Data((card.title + "\u{0}" + card.body).utf8))
    return card.id + ":" + digest.prefix(12).map { String(format: "%02x", $0) }.joined()
}
func shouldRequestPermission(_ arguments: [String]) -> Bool {
    arguments.contains("--request-permission") && !arguments.contains("--check") && !arguments.contains("--self-test")
}
// macOS 26 exposes UUID-identified cards with descriptions such as
// "微信 会话名称, 消息正文". Never flatten a mixed-app notification-center window.
@Sendable func parseCard(identifier: String, description: String) -> NotificationCard? {
    guard let uuid = UUID(uuidString: identifier), description.count <= 12000 else { return nil }
    guard let prefix = ["微信 ", "WeChat "].first(where: { description.hasPrefix($0) }) else { return nil }
    let content = String(description.dropFirst(prefix.count))
    guard let separator = content.range(of: ", ") else { return nil }
    let title = String(content[..<separator.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
    let body = String(content[separator.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, title.count <= 200, !body.isEmpty, body.count <= 10000 else { return nil }
    return NotificationCard(id: "notification-center:" + uuid.uuidString, title: title, body: body)
}
if CommandLine.arguments.contains("--self-test") {
    let id = "00000000-0000-4000-8000-000000000001"
    let other = "00000000-0000-4000-8000-000000000002"
    let expected = NotificationCard(id: "notification-center:" + id, title: "测试群", body: "小明: 明天讨论, 带上草稿")
    precondition(parseCard(identifier: id, description: "微信 测试群, 小明: 明天讨论, 带上草稿") == expected)
    precondition(parseCard(identifier: id, description: "WeChat Test, hello")?.body == "hello")
    precondition(parseCard(identifier: id, description: "飞书 测试群, 微信 hello") == nil)
    precondition(parseCard(identifier: "", description: "微信 测试群, hello") == nil)
    precondition(parseCard(identifier: id, description: "微信 测试群") == nil)
    precondition(parseCard(identifier: id, description: "微信 , hello") == nil)
    precondition(parseCard(identifier: id, description: "微信 测试群, ") == nil)
    let first = parseCard(identifier: id, description: "微信 测试群, hello")!
    let second = parseCard(identifier: other, description: "微信 测试群, hello")!
    precondition(first.id != second.id)
    precondition(Set([first.id, first.id, second.id]).count == 2)
    precondition(!shouldRequestPermission([]))
    precondition(shouldRequestPermission(["--request-permission"]))
    precondition(!shouldRequestPermission(["--request-permission", "--check"]))
    precondition(!shouldRequestPermission(["--request-permission", "--self-test"]))
    precondition(observationID(first) == observationID(first))
    precondition(observationID(first) != observationID(NotificationCard(id: first.id, title: first.title, body: "updated")))
    precondition(observationID(first) != observationID(second))
    emit(["type":"test", "passed":16])
    exit(0)
}
var trusted = AXIsProcessTrusted()
if !trusted && shouldRequestPermission(CommandLine.arguments) {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    trusted = AXIsProcessTrustedWithOptions(options)
}
guard trusted else {
    // TCC normally attributes a desktop child process to the responsible app,
    // not to this command-line executable's file name.
    let detail = ProcessInfo.processInfo.environment["ORBIT_DESKTOP"] == "1"
        ? "请在系统设置 → 隐私与安全性 → 辅助功能中开启 Orbit，然后返回点击「重新检测」。无需寻找单独的 orbit-wechat-reader。"
        : "请在系统设置 → 隐私与安全性 → 辅助功能中允许启动读取器的应用（例如终端），然后重试。以系统显示的应用名称为准。"
    emit(["type":"status", "status":"blocked", "detail":detail])
    exit(0)
}
if CommandLine.arguments.contains("--check") {
    emit(["type":"status", "status":"ready", "detail":"辅助功能已授权；此检查未读取消息。"])
    exit(0)
}
struct ScanCounters {
    var processes = 0, windows = 0, nodes = 0, uuidNodes = 0
    var wechatCandidates = 0, parsedCards = 0, emittedCards = 0, traversalLimited = 0
    var axErrors: [String: Int] = [:]
    mutating func record(_ error: AXError) {
        // Leaves commonly have no children/description; those are not access failures.
        if error != .success && error != .attributeUnsupported && error != .noValue {
            axErrors[String(error.rawValue), default: 0] += 1
        }
    }
    var json: [String: Any] {
        ["processes": processes, "windows": windows, "nodes": nodes, "uuidNodes": uuidNodes,
         "wechatCandidates": wechatCandidates, "parsedCards": parsedCards,
         "emittedCards": emittedCards, "traversalLimited": traversalLimited, "axErrors": axErrors]
    }
}
@Sendable func stringAttribute(_ element: AXUIElement, _ name: String, counters: inout ScanCounters) -> String {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    counters.record(result)
    guard result == .success else { return "" }
    return value as? String ?? ""
}
@Sendable func cards(_ element: AXUIElement, depth: Int = 0, budget: inout Int,
           visited: inout Set<AXUIElement>, counters: inout ScanCounters) -> [NotificationCard] {
    guard depth <= 20, budget > 0 else { counters.traversalLimited += 1; return [] }
    guard visited.insert(element).inserted else { return [] }
    budget -= 1
    counters.nodes += 1
    let identifier = stringAttribute(element, kAXIdentifierAttribute, counters: &counters)
    let description = stringAttribute(element, kAXDescriptionAttribute, counters: &counters)
    if UUID(uuidString: identifier) != nil { counters.uuidNodes += 1 }
    if description.hasPrefix("微信") || description.hasPrefix("WeChat") { counters.wechatCandidates += 1 }
    if let card = parseCard(identifier: identifier, description: description) {
        counters.parsedCards += 1
        return [card]
    }
    var children: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
    counters.record(result)
    guard result == .success,
          let list = children as? [AXUIElement] else { return [] }
    if list.count > 300 { counters.traversalLimited += 1 }
    var found: [NotificationCard] = []
    for child in list.prefix(300) {
        found += cards(child, depth: depth + 1, budget: &budget, visited: &visited, counters: &counters)
    }
    return found
}
var lastEmitted: [String: TimeInterval] = [:]
var seenOrder: [String] = []
var lastDiagnosticsAt: TimeInterval = 0
let ownerProcess = getppid()
func scan() {
    // Do not keep a detached collector alive after Orbit exits or crashes.
    guard getppid() == ownerProcess else { exit(0) }
    guard AXIsProcessTrusted() else {
        emit(["type":"status", "status":"blocked", "detail":"辅助功能授权已关闭，通知采集已停止。请重新授权 Orbit，然后点击「重新检测」。"])
        exit(0)
    }
    var counters = ScanCounters()
    let now = ProcessInfo.processInfo.systemUptime
    for app in NSWorkspace.shared.runningApplications {
        guard ["com.apple.notificationcenterui", "com.apple.UserNotificationCenter"].contains(app.bundleIdentifier ?? "") || ["NotificationCenter", "UserNotificationCenter"].contains(app.localizedName ?? "") else { continue }
        counters.processes += 1
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 0.25)
        var visited: Set<AXUIElement> = []
        var budget = 6000
        // Some system surfaces expose content under application children rather
        // than AXWindows. Traverse both, without flattening mixed-app content.
        var found = cards(root, budget: &budget, visited: &visited, counters: &counters)
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(root, kAXWindowsAttribute as CFString, &value)
        counters.record(result)
        if result == .success, let windows = value as? [AXUIElement] {
            counters.windows += windows.count
            if windows.count > 20 { counters.traversalLimited += 1 }
            for window in windows.prefix(20) {
                found += cards(window, budget: &budget, visited: &visited, counters: &counters)
            }
        }
        for card in found {
            let id = observationID(card)
            // stdout delivery is not an acknowledgement of durable storage.
            // Retry a still-visible preview occasionally; the host deduplicates.
            if let previous = lastEmitted[id], now - previous < 30 { continue }
            if lastEmitted[id] == nil { seenOrder.append(id) }
            lastEmitted[id] = now
            if seenOrder.count > 10000 { lastEmitted.removeValue(forKey: seenOrder.removeFirst()) }
            counters.emittedCards += 1
            emit(["type":"notification", "id":id, "title":card.title, "body":card.body,
                  "timestamp":ISO8601DateFormatter().string(from:Date())])
        }
    }
    if lastDiagnosticsAt == 0 || now - lastDiagnosticsAt >= 5 || counters.emittedCards > 0 {
        lastDiagnosticsAt = now
        // Only aggregate counts and numeric AX errors. Never export raw tree,
        // element descriptions, chat titles, or notification text as diagnostics.
        emit(["type":"diagnostics", "counters":counters.json,
              "scannedAt":ISO8601DateFormatter().string(from:Date())])
    }
}
emit(["type":"status", "status":"listening", "detail":"读取器运行中，等待可读取的微信通知卡片。尚不代表已成功捕获消息。"])
scan()
Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in scan() }
RunLoop.current.run()
