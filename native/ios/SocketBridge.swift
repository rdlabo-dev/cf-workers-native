import Foundation
import Network
import Security

/// TCP byte transport. All state and completions belong to one serial queue.
final class SocketBridge: @unchecked Sendable {
    private final class Connection: @unchecked Sendable {
        let id: String
        let transport: NWConnection
        var encrypted = false
        var host = ""
        var opening: Completion?
        var reading: Completion?
        var writing: Completion?
        var closeWaiters: [() -> Void] = []
        var cancelled = false
        var reset = false
        var releaseRequested = false
        var watching: Completion?
        var buffer = Data()
        var receiving = false
        var readCount = 65536
        var ready = false
        var closed = false
        var eof = false
        var ended = false
        init(_ id: String, _ transport: NWConnection) { self.id = id; self.transport = transport }
    }
    private enum Failure: Error { case closed, invalid, busy }
    private let queue = DispatchQueue(label: "jp.rdlabo.workerscapacitor.sockets")
    private var values: [String: Connection] = [:]
    private var stopped = false
    typealias Completion = (Result<[String: Any], Error>) -> Void
    private func close(_ value: Connection, error: Error = Failure.closed, completion: (() -> Void)? = nil) {
        if let completion {
            value.releaseRequested = true
            value.closeWaiters.append(completion)
        }
        guard !value.closed else { if value.cancelled { finishClose(value) }; return }
        if case .posix(.ECONNRESET)? = error as? NWError { value.reset = !value.releaseRequested }
        value.closed = true
        value.buffer = Data()
        value.opening?(.failure(error)); value.opening = nil
        // The pinned Workers transport reports peer reset as EOF to readers.
        value.reading?(value.reset ? .success(["eof": true, "reset": true]) : .failure(error)); value.reading = nil
        value.writing?(.failure(error)); value.writing = nil
        value.watching?(value.reset ? .success(["reset": true]) : .failure(error)); value.watching = nil
        if value.cancelled { finishClose(value) } else { value.transport.cancel() }
    }
    private func finishClose(_ value: Connection) {
        if value.reset && !value.releaseRequested { return }
        values.removeValue(forKey: value.id)
        let waiters = value.closeWaiters; value.closeWaiters.removeAll()
        for waiter in waiters { waiter() }
    }
    func open(id: String, host: String, port: Int, tls: Bool, servername: String? = nil, completion: @escaping Completion) {
        queue.async {
            guard !self.stopped, !id.isEmpty, !host.isEmpty, port > 0, port <= 65535,
                  self.values[id] == nil, let endpointPort = NWEndpoint.Port(rawValue: UInt16(port)) else { completion(.failure(Failure.invalid)); return }
            let parameters: NWParameters
            if tls {
                let options = NWProtocolTLS.Options()
                sec_protocol_options_set_tls_server_name(options.securityProtocolOptions, servername ?? host)
                parameters = NWParameters(tls: options, tcp: NWProtocolTCP.Options())
            } else { parameters = .tcp }
            let transport = NWConnection(host: NWEndpoint.Host(host), port: endpointPort, using: parameters)
            let value = Connection(id, transport)
            value.host = host; value.encrypted = tls
            value.opening = completion
            self.values[id] = value
            transport.stateUpdateHandler = { [weak self, weak value] state in
                guard let self, let value else { return }
                if case .cancelled = state {
                    value.cancelled = true
                    value.transport.stateUpdateHandler = nil
                    // A naturally completed duplex can cancel before JS asks
                    // for its final EOF. Retain buffered data and that EOF.
                    if !value.closed && value.eof { self.notifyEnd(value); return }
                    self.close(value)
                    self.finishClose(value)
                    return
                }
                guard !value.closed else { return }
                switch state {
                case .ready:
                    value.ready = true
                    let remote = host.contains(":") ? "[\(host)]:\(port)" : "\(host):\(port)"
                    value.opening?(.success(["remoteAddress": remote])); value.opening = nil
                    self.pump(value)
                case .failed(.posix(.ENETDOWN)) where value.ready && value.ended && !value.encrypted && !value.eof:
                    // Network.framework can report ENETDOWN after both peers
                    // send FIN, before the queued receive delivers the final
                    // bytes and EOF. Let receive report the inbound outcome.
                    self.pump(value)
                case .waiting(let error), .failed(let error):
                    // Once EOF and the final send have completed, a late
                    // NW failure must not erase the EOF waiting for JS.
                    if value.eof && value.ended { value.transport.cancel(); return }
                    self.close(value, error: error)
                default: break
                }
            }
            transport.start(queue: self.queue)
        }
    }
    func startTls(id: String, servername: String?, completion: @escaping Completion) {
        queue.async {
            guard let value = self.values[id], value.ready, !value.closed, !value.eof, !value.ended, !value.encrypted, value.writing == nil,
                  let hostname = servername, !hostname.isEmpty, !hostname.utf8.contains(0) else { completion(.failure(Failure.invalid)); return }
            value.encrypted = true; value.host = hostname
            value.reading?(.success(["upgraded": true])); value.reading = nil
            value.watching?(.success(["upgraded": true])); value.watching = nil
            // JS encrypts records with OpenSSL memory BIOs on this same TCP stream.
            // The successful JS open is withheld until verifyTls authenticates it.
            completion(.success(["tlsEngine": "openssl-wasm"]))
        }
    }
    func verifyTls(id: String, certificates: [Data], completion: @escaping Completion) {
        queue.async {
            guard let value = self.values[id], !value.closed, value.encrypted, !certificates.isEmpty else { completion(.failure(Failure.invalid)); return }
            let chain = certificates.compactMap { SecCertificateCreateWithData(nil, $0 as CFData) }
            guard chain.count == certificates.count else { completion(.failure(Failure.invalid)); return }
            var trust: SecTrust?
            let policy = SecPolicyCreateSSL(true, value.host as CFString)
            guard SecTrustCreateWithCertificates(chain as CFArray, policy, &trust) == errSecSuccess, let trust else { completion(.failure(Failure.invalid)); return }
            var error: CFError?
            guard SecTrustEvaluateWithError(trust, &error) else { completion(.failure(error as Error? ?? Failure.invalid)); return }
            completion(.success([:]))
        }
    }
    func watch(id: String, completion: @escaping Completion) {
        queue.async {
            if let value = self.values[id], value.reset { completion(.success(["reset": true])); return }
            guard let value = self.values[id], !value.closed, value.ready else { completion(.failure(Failure.closed)); return }
            guard value.watching == nil else { completion(.failure(Failure.busy)); return }
            if value.eof && value.buffer.isEmpty { completion(.success([:])); return }
            value.watching = completion
        }
    }
    private func notifyEnd(_ value: Connection) {
        if value.eof && value.buffer.isEmpty { value.watching?(.success([:])); value.watching = nil }
    }
    private func drain(_ value: Connection) {
        if let reply = value.reading {
            if !value.buffer.isEmpty {
                let data = value.buffer.prefix(value.readCount)
                value.buffer.removeFirst(data.count)
                value.reading = nil
                reply(.success(["chunk": Data(data).base64EncodedString()]))
            } else if value.eof { value.reading = nil; reply(.success(["eof": true])) }
        }
        notifyEnd(value)
        pump(value)
    }
    // One bounded native receive also observes FIN/reset while JS is paused.
    private func pump(_ value: Connection) {
        guard value.ready, !value.closed, !value.receiving, !value.eof, value.buffer.isEmpty else { return }
        value.receiving = true
        value.transport.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, complete, error in
            value.receiving = false
            guard !value.closed else { return }
            if let error { self.close(value, error: error); return }
            value.eof = complete
            value.buffer = data ?? Data()
            if value.buffer.isEmpty && !complete { self.close(value, error: Failure.invalid); return }
            self.drain(value)
        }
    }
    func read(id: String, count: Int, completion: @escaping Completion) {
        queue.async {
            guard count > 0, count <= 65536 else { completion(.failure(Failure.invalid)); return }
            if let value = self.values[id], value.reset { completion(.success(["eof": true, "reset": true])); return }
            guard let value = self.values[id], !value.closed, value.ready else { completion(.failure(Failure.closed)); return }
            guard value.reading == nil else { completion(.failure(Failure.busy)); return }
            value.reading = completion; value.readCount = count
            self.drain(value)
        }
    }
    func write(id: String, data: Data?, end: Bool, completion: @escaping Completion) {
        queue.async {
            if end, let value = self.values[id], value.reset { completion(.success(["reset": true])); return }
            guard let value = self.values[id], !value.closed, value.ready else { completion(.failure(Failure.closed)); return }
            guard value.writing == nil else { completion(.failure(Failure.busy)); return }
            if value.ended { completion(end ? .success([:]) : .failure(Failure.closed)); return }
            guard end || (data != nil && data!.count <= 65536) else { completion(.failure(Failure.invalid)); return }
            value.ended = end
            value.writing = completion
            value.transport.send(content: data, contentContext: end ? .finalMessage : .defaultMessage, isComplete: end, completion: .contentProcessed { error in
                guard !value.closed else { return }
                let reply = value.writing; value.writing = nil
                if let error, !(end && value.eof) { reply?(.failure(error)); self.close(value, error: error) }
                else { reply?(.success([:])) }
            })
        }
    }
    func close(id: String, completion: @escaping Completion) {
        queue.async {
            if let value = self.values[id] {
                self.close(value, completion: { completion(.success([:])) })
            } else { completion(.success([:])) }
        }
    }
    func closeAll(stopping: Bool = false) async {
        await withCheckedContinuation { continuation in
            queue.async {
                self.stopped = self.stopped || stopping
                let closing = Array(self.values.values)
                if closing.isEmpty { continuation.resume(); return }
                var remaining = closing.count
                for value in closing {
                    self.close(value, completion: {
                        remaining -= 1
                        if remaining == 0 { continuation.resume() }
                    })
                }
            }
        }
    }
}
