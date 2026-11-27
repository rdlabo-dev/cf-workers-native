import Foundation

/// Exercise the same Network.framework bridge as the app, with a slow reader.
@main enum HalfCloseProbe {
    typealias Reply = [String: Any]

    static func call(_ perform: (@escaping SocketBridge.Completion) -> Void) async throws -> Reply {
        try await withCheckedThrowingContinuation { continuation in
            perform { result in continuation.resume(with: result) }
        }
    }

    static func check(_ bridge: SocketBridge, id: String) async throws {
        let payload = "half-closed request"
        let request = "POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Length: \(payload.utf8.count)\r\nConnection: close\r\n\r\n\(payload)"
        _ = try await call { bridge.open(id: id, host: "127.0.0.1", port: 4201, tls: false, completion: $0) }
        _ = try await call { bridge.write(id: id, data: Data(request.utf8), end: false, completion: $0) }
        _ = try await call { bridge.write(id: id, data: nil, end: true, completion: $0) }

        // Let the response and peer FIN arrive before the app requests data.
        try await Task.sleep(nanoseconds: 25_000_000)
        var bytes = Data()
        while true {
            let reply = try await call { bridge.read(id: id, count: 65536, completion: $0) }
            if reply["eof"] as? Bool == true {
                precondition(reply["reset"] == nil, "The server closed normally")
                break
            }
            guard let chunk = reply["chunk"] as? String, let data = Data(base64Encoded: chunk), !data.isEmpty
            else { fatalError("Unexpected socket read") }
            bytes.append(data)
        }
        let parts = String(decoding: bytes, as: UTF8.self).components(separatedBy: "\r\n\r\n")
        precondition(parts.count == 2 && parts[0].hasPrefix("HTTP/1.1 200 ") && parts[1] == payload,
                     "The complete response must arrive before EOF")
        _ = try await call { bridge.close(id: id, completion: $0) }
    }

    static func main() async throws {
        let bridge = SocketBridge()
        for index in 0..<20 { try await check(bridge, id: String(index)) }
        print("20 delayed reads after TCP half-close passed")
    }
}
