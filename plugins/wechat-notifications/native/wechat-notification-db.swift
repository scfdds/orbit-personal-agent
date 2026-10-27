// Read-only, explicitly started Notification Center reader. Never opens WeChat's databases.
import Foundation
import SQLite3
import CryptoKit
import Darwin

enum ReaderFailure: Error {
    case fullDiskAccess, missing, schema, busy, read
    var reason: String {
        switch self {
        case .fullDiskAccess: return "full_disk_access"
        case .missing: return "database_missing"
        case .schema: return "schema_unsupported"
        case .busy: return "database_busy"
        case .read: return "database_read_failed"
        }
    }
}

struct NotificationRecord {
    let id: String
    let title: String
    let body: String
    let timestamp: String
}
struct Scan {
    var records: [NotificationRecord] = []
    var rows = 0
    var invalid = 0
    var limited = 0
}

func sqliteFailure(_ db: OpaquePointer?, code: Int32) -> ReaderFailure {
    let osError = sqlite3_system_errno(db)
    if osError == EACCES || osError == EPERM { return .fullDiskAccess }
    if code == SQLITE_BUSY || code == SQLITE_LOCKED { return .busy }
    return .read
}

let iso = ISO8601DateFormatter()
func emit(_ event: [String: Any]) {
    guard let bytes = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data([10]))
}

func decode(_ data: Data, rowID: Int64, bundle: String, delivered: Double, now: Date) -> NotificationRecord? {
    guard data.count <= 262144, delivered.isFinite, delivered > 0,
          let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
          let root = plist as? [String: Any], let req = root["req"] as? [String: Any],
          let rawTitle = req["titl"] as? String, let rawBody = req["body"] as? String else { return nil }
    let title = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = rawBody.trimmingCharacters(in: .whitespacesAndNewlines)
    let subtitle = (req["subt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let date = Date(timeIntervalSinceReferenceDate: delivered)
    guard !title.isEmpty, title.count <= 200, !body.isEmpty, body.count <= 10000,
          subtitle.count <= 500, date <= now.addingTimeInterval(300) else { return nil }
    // Subtitle is preserved as evidence, never guessed to be a sender or group identifier.
    let content = subtitle.isEmpty ? body : "[\(subtitle)]\n\(body)"
    guard content.count <= 10000 else { return nil }
    let fingerprint = "\(bundle)\u{0}\(rowID)\u{0}\(delivered)\u{0}\(title)\u{0}\(content)"
    let hash = SHA256.hash(data: Data(fingerprint.utf8)).map { String(format: "%02x", $0) }.joined()
    return NotificationRecord(id: "notification-db:\(hash)", title: title, body: content, timestamp: iso.string(from: date))
}

func scan(path: String, now: Date) throws -> Scan {
    // Distinguish OS denial from an absent database without dumping paths or contents.
    let fd = Darwin.open(path, O_RDONLY)
    guard fd >= 0 else {
        switch errno {
        case EACCES, EPERM: throw ReaderFailure.fullDiskAccess
        case ENOENT: throw ReaderFailure.missing
        default: throw ReaderFailure.read
        }
    }
    Darwin.close(fd)
    var db: OpaquePointer?
    let opened = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil)
    guard opened == SQLITE_OK else {
        let failure = sqliteFailure(db, code:opened)
        if let db = db { sqlite3_close(db) }
        throw failure
    }
    defer { sqlite3_close(db) }
    sqlite3_busy_timeout(db, 500)
    // Only the two known WeChat bundle IDs are queried. Other apps' payloads never enter the process.
    let sql = """
    SELECT r.rec_id, a.identifier, r.data, r.delivered_date
    FROM record r JOIN app a ON r.app_id = a.app_id
    WHERE lower(a.identifier) IN ('com.tencent.xinwechat', 'com.tencent.wechat')
      AND r.delivered_date >= ? AND r.delivered_date <= ?
    ORDER BY r.delivered_date DESC, r.rec_id DESC LIMIT 1001
    """
    var statement: OpaquePointer?
    let prepared = sqlite3_prepare_v2(db, sql, -1, &statement, nil)
    guard prepared == SQLITE_OK else {
        if prepared == SQLITE_ERROR { throw ReaderFailure.schema }
        throw sqliteFailure(db,code:prepared)
    }
    defer { sqlite3_finalize(statement) }
    sqlite3_bind_double(statement, 1, now.addingTimeInterval(-86400).timeIntervalSinceReferenceDate)
    sqlite3_bind_double(statement, 2, now.addingTimeInterval(300).timeIntervalSinceReferenceDate)
    var result = Scan()
    while true {
        let code = sqlite3_step(statement)
        if code == SQLITE_DONE { break }
        guard code == SQLITE_ROW else {
            throw sqliteFailure(db,code:code)
        }
        if result.rows == 1000 { result.limited = 1; break }
        result.rows += 1
        let size = Int(sqlite3_column_bytes(statement, 2))
        guard size > 0, size <= 262144, let blob = sqlite3_column_blob(statement, 2),
              let identifier = sqlite3_column_text(statement, 1),
              sqlite3_column_type(statement, 3) != SQLITE_NULL else { result.invalid += 1; continue }
        let data = Data(bytes: blob, count: size)
        if let record = decode(data, rowID: sqlite3_column_int64(statement, 0),
                               bundle: String(cString: identifier), delivered: sqlite3_column_double(statement, 3), now: now) {
            result.records.append(record)
        } else { result.invalid += 1 }
    }
    result.records.reverse()
    return result
}

// Synthetic fixtures only; no OS database or permission request is touched by this mode.
func selfTest() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("orbit-db-test-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let path = folder.appendingPathComponent("fixture.sqlite").path
    var db: OpaquePointer?
    precondition(sqlite3_open(path, &db) == SQLITE_OK)
    defer { sqlite3_close(db) }
    precondition(sqlite3_exec(db,"PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;",nil,nil,nil) == SQLITE_OK)
    precondition(sqlite3_exec(db, "CREATE TABLE app(app_id INTEGER, identifier TEXT); CREATE TABLE record(rec_id INTEGER, app_id INTEGER, data BLOB, delivered_date REAL); INSERT INTO app VALUES(1,'com.tencent.xinWeChat'),(2,'com.example.other');", nil, nil, nil) == SQLITE_OK)
    let now = Date()
    func insert(_ id: Int, app: Int = 1, age: Double = 0, payload: Data) {
        let hex = payload.map { String(format: "%02x", $0) }.joined()
        let sql = "INSERT INTO record VALUES(\(id),\(app),X'\(hex)',\(now.timeIntervalSinceReferenceDate-age))"
        precondition(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK)
    }
    let payload = try PropertyListSerialization.data(fromPropertyList: ["req": ["titl":"测试会话", "body":"测试正文", "subt":"测试副标题"]], format:.binary, options:0)
    insert(1, payload:payload)
    insert(2, app:2, payload:payload)
    insert(3, age:90000, payload:payload)
    insert(4, payload:Data("not a plist".utf8))
    let empty = try PropertyListSerialization.data(fromPropertyList:["req":["titl":"测试", "body":""]], format:.binary, options:0)
    insert(5, payload:empty)
    let first = try scan(path:path, now:now)
    precondition(first.rows == 3 && first.invalid == 2 && first.records.count == 1)
    precondition(first.records[0].body == "[测试副标题]\n测试正文")
    precondition(first.records[0].id.hasPrefix("notification-db:"))
    let second = try scan(path:path, now:now)
    precondition(first.records[0].id == second.records[0].id)
    let before = try Data(contentsOf:URL(fileURLWithPath:path))
    _ = try scan(path:path, now:now)
    let after = try Data(contentsOf:URL(fileURLWithPath:path))
    precondition(before == after)
    insert(6,payload:payload)
    precondition(tryScanCount(path:path,now:now) == 2)
    for id in 10...1010 { insert(id, payload:payload) }
    let limited = try scan(path:path, now:now)
    precondition(limited.rows == 1000 && limited.limited == 1)
    precondition(decode(payload,rowID:1,bundle:"test",delivered:now.addingTimeInterval(600).timeIntervalSinceReferenceDate,now:now) == nil)
    do { _ = try scan(path:folder.appendingPathComponent("absent").path, now:now); preconditionFailure() }
    catch ReaderFailure.missing { }
    precondition(sqlite3_exec(db,"ALTER TABLE record RENAME TO changed",nil,nil,nil) == SQLITE_OK)
    do { _ = try scan(path:path,now:now); preconditionFailure() }
    catch ReaderFailure.schema { }
    print("Notification DB self-test passed: WeChat filtering, 24h boundary, plist validation, timestamps, stable IDs, read-only, bounded scan, missing/schema errors.")
}

func tryScanCount(path:String, now:Date) -> Int { (try? scan(path:path,now:now).records.count) ?? -1 }

if CommandLine.arguments.contains("--self-test") {
    do { try selfTest(); exit(0) } catch { fputs("Synthetic self-test failed\n",stderr); exit(1) }
}
guard CommandLine.arguments.count == 1 else { exit(2) }
signal(SIGPIPE, SIG_IGN)
let database = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Group Containers/group.com.apple.usernoted/db2/db").path
let parent = getppid()
var emitted: [String: Date] = [:]
var ready = false
var lastDiagnostics = Date.distantPast
var lastFailure: String?
var retryDelay: Double = 2
while getppid() == parent && parent > 1 {
    let now = Date()
    do {
        let result = try scan(path:database, now:now)
        lastFailure = nil
        retryDelay = 2
        if !ready { emit(["type":"status", "status":"listening"]); ready = true }
        var count = 0
        for record in result.records {
            // Re-delivery makes host import failures retryable; host persists and deduplicates IDs.
            if let previous = emitted[record.id], now.timeIntervalSince(previous) < 30 { continue }
            emit(["type":"notification", "id":record.id, "title":record.title, "body":record.body, "timestamp":record.timestamp])
            emitted[record.id] = now
            count += 1
        }
        let retained = Set(result.records.map { $0.id })
        emitted = emitted.filter { retained.contains($0.key) }
        if now.timeIntervalSince(lastDiagnostics) >= 5 || count > 0 {
            emit(["type":"db_diagnostics", "scannedAt":iso.string(from:now), "rowsRead":result.rows,
                  "parsedRecords":result.records.count, "emittedRecords":count,
                  "invalidRecords":result.invalid, "limited":result.limited])
            lastDiagnostics = now
        }
    } catch let error as ReaderFailure {
        if lastFailure != error.reason {
            emit(["type":"status", "status":error.reason == "full_disk_access" ? "blocked" : "error", "reason":error.reason])
            lastFailure = error.reason
        }
        if error.reason == "full_disk_access" || error.reason == "schema_unsupported" { exit(1) }
        ready = false
        retryDelay = min(10,retryDelay * 2)
    } catch {
        emit(["type":"status", "status":"error", "reason":"database_read_failed"])
        exit(1)
    }
    Thread.sleep(forTimeInterval:retryDelay)
}
