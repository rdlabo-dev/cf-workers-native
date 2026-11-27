import WebKit
import Capacitor

// Internal document view. Consumers retain their ordinary Capacitor controller.
final class DocumentBridgeController: CAPBridgeViewController {
    var embeddedDescriptorFactory: (() -> InstanceDescriptor)?
    weak var runtimeHost: WKWebView?
    var settings: [String: Any] = [:]
    var localURL: URL!
    override func instanceDescriptor() -> InstanceDescriptor {
        if let factory = embeddedDescriptorFactory { return factory() }
        let descriptor = super.instanceDescriptor()
        // Capacitor's resolved value cannot distinguish an explicit "never"
        // from its default. Check presence in the same bundled configuration.
        let config = Bundle.main.url(forResource: "capacitor.config", withExtension: "json")
            .flatMap { try? Data(contentsOf: $0) }
            .flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
        let ios = config?["ios"] as? [String: Any]
        if ios?["contentInset"] == nil {
            descriptor.contentInsetAdjustmentBehavior = .automatic
        }
        return descriptor
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        if let entry = settings["entry"] as? String, entry != "/", let url = URL(string: entry, relativeTo: localURL)?.absoluteURL {
            webView?.stopLoading(); webView?.load(URLRequest(url: url))
        }
    }
    func close() {
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "documentFetch", contentWorld: .page)
        documents?.close()
        documents = nil
        webView?.navigationDelegate = nil
        documentNavigation = nil
    }
    private var documents: DocumentSchemeHandler?
    private var documentNavigation: DocumentNavigationDelegate?
    private var instance: InstanceConfiguration!
    override func capacitorDidLoad() {
        guard let page = webView, let documents = documents else { return }
        let navigation = DocumentNavigationDelegate(original: page.navigationDelegate, documents: documents)
        documentNavigation = navigation
        page.navigationDelegate = navigation
        documents.page = page
    }
    override func webViewConfiguration(for configuration: InstanceConfiguration) -> WKWebViewConfiguration {
        instance = configuration
        return super.webViewConfiguration(for: configuration)
    }
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let assets = configuration.urlSchemeHandler(forURLScheme: localURL.scheme!)!
        let handler = DocumentSchemeHandler(assets: assets, runtime: runtimeHost!, localURL: localURL, assetsList: settings["assets"] as? [String] ?? [])
        documents = handler
        // WKWebViewConfiguration cannot replace a registered handler. Recreate
        // Capacitor's configuration through its public factory, retaining its bridge controller.
        let actual = super.webViewConfiguration(for: instance)
        actual.userContentController = configuration.userContentController
        actual.setURLSchemeHandler(handler, forURLScheme: localURL.scheme!)
        actual.userContentController.addScriptMessageHandler(handler, contentWorld: .page, name: "documentFetch")
        let config = ["baseURL": settings["baseURL"]!, "assets": settings["assets"]!] as [String: Any]
        let json = String(data: try! JSONSerialization.data(withJSONObject: config), encoding: .utf8)!
        let script = "globalThis.__workersCapacitorDocuments = \(json);\n" + (settings["pageScript"] as? String ?? "")
        actual.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        return super.webView(with: frame, configuration: actual)
    }
}

final class DocumentNavigationDelegate: NSObject, WKNavigationDelegate {
    private let original: WKNavigationDelegate?
    private let documents: DocumentSchemeHandler
    init(original: WKNavigationDelegate?, documents: DocumentSchemeHandler) { self.original = original; self.documents = documents }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == true {
            documents.cancelFetchStreams()
            documents.documentURL = action.request.url
            documents.documentOrigin = documents.localInitiator(action.sourceFrame)
        }
        if let original = original, original.responds(to: NSSelectorFromString("webView:decidePolicyForNavigationAction:decisionHandler:")) {
            original.webView?(webView, decidePolicyFor: action, decisionHandler: decisionHandler)
        } else { decisionHandler(.allow) }
    }
    override func responds(to selector: Selector!) -> Bool { super.responds(to: selector) || (original?.responds(to: selector) ?? false) }
    override func forwardingTarget(for selector: Selector!) -> Any? { original?.responds(to: selector) == true ? original : super.forwardingTarget(for: selector) }
}

final class DocumentSchemeHandler: NSObject, WKURLSchemeHandler, WKScriptMessageHandlerWithReply {
    private let assets: WKURLSchemeHandler
    private weak var runtime: WKWebView?
    private let localURL: URL
    private let assetsList: Set<String>
    private var closed = false
    weak var page: WKWebView?
    var documentURL: URL?
    var documentOrigin: String?
    private var documentOrigins: [String: String] = [:]
    // WebKit omits Origin for custom-scheme form navigations. Recover only a
    // verified, non-opaque local main-frame initiator; never infer it from the
    // destination URL or from a JavaScript-supplied header.
    func localInitiator(_ frame: WKFrameInfo) -> String? {
        let origin = frame.securityOrigin
        guard frame.isMainFrame, origin.protocol == localURL.scheme,
              origin.host == localURL.host, origin.port == (localURL.port ?? 0) else { return nil }
        return "\(origin.protocol)://\(origin.host)" + (origin.port == 0 ? "" : ":\(origin.port)")
    }
    private var documentTasks = Set<String>()
    private var redirects = 0
    private var fetchReplies: [String: (Any?, String?) -> Void] = [:]
    private var fetchRequests: [String: [String: Any]] = [:]
    private var fetchStreams = Set<String>()
    func cancelFetchStreams() {
        for id in fetchStreams { cancelStream(id) }
        fetchStreams.removeAll()
        for (id, reply) in fetchReplies {
            cancelStream(id)
            reply(nil, "Document navigated")
        }
        fetchReplies.removeAll(); fetchRequests.removeAll()
    }
    private var ready = true
    private var tasks: [String: WKURLSchemeTask] = [:]
    private var awaitingHeaders = Set<String>()
    init(assets: WKURLSchemeHandler, runtime: WKWebView, localURL: URL, assetsList: [String]) {
        self.assets = assets; self.runtime = runtime; self.localURL = localURL; self.assetsList = Set(assetsList)
        super.init()
    }
    private func isLocal(_ url: URL) -> Bool {
        url.scheme == localURL.scheme && url.host == localURL.host && url.port == localURL.port && url.user == nil && url.password == nil
    }
    private func handles(_ task: WKURLSchemeTask) -> Bool {
        guard let url = task.request.url else { return false }
        return isLocal(url) && !assetsList.contains(url.path) && !url.path.hasPrefix("/_capacitor_")
    }
    private func cancelStream(_ id: String) {
        execute(["action": "cancel", "streamId": id]) { _ in }
    }
    func close() {
        cancelFetchStreams()
        for id in tasks.keys { cancelStream(id) }
        for id in fetchReplies.keys { cancelStream(id) }
        closed = true
        for task in tasks.values { task.didFailWithError(URLError(.cancelled)) }
        tasks.removeAll(); documentTasks.removeAll(); documentOrigins.removeAll(); awaitingHeaders.removeAll()
        for reply in fetchReplies.values { reply(nil, "Document runtime disposed") }
        fetchReplies.removeAll(); fetchRequests.removeAll()
    }
    private func execute(_ request: [String: Any], completion: @escaping (Result<Any, Error>) -> Void) {
        guard !closed, let runtime = runtime else { completion(.failure(URLError(.cancelled))); return }
        runtime.callAsyncJavaScript("return await window.__workersCapacitorDispatch(request)", arguments: ["request": request], in: nil, in: .page, completionHandler: completion)
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard handles(task) else { assets.webView(webView, start: task); return }
        let id = UUID().uuidString
        tasks[id] = task
        awaitingHeaders.insert(id)
        if task.request.url == documentURL {
            documentTasks.insert(id)
            if let origin = documentOrigin { documentOrigins[id] = origin }
            documentURL = nil; documentOrigin = nil
        }
        if ready { dispatch(id, task) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            if self?.awaitingHeaders.remove(id) != nil, let expired = self?.tasks.removeValue(forKey: id) {
                self?.documentTasks.remove(id)
                self?.documentOrigins.removeValue(forKey: id)
                self?.cancelStream(id)
                expired.didFailWithError(URLError(.timedOut))
            }
        }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        guard handles(task) else { assets.webView(webView, stop: task); return }
        for (id, current) in tasks where current === task {
            tasks.removeValue(forKey: id); documentTasks.remove(id); documentOrigins.removeValue(forKey: id); awaitingHeaders.remove(id); cancelStream(id)
        }
    }
    private func dispatch(_ id: String, _ task: WKURLSchemeTask) {
        var request: [String: Any] = ["id": id, "url": task.request.url!.absoluteString,
            "method": task.request.httpMethod ?? "GET", "headers": task.request.allHTTPHeaderFields ?? [:], "document": documentTasks.contains(id), "stream": true]
        if let origin = documentOrigins.removeValue(forKey: id),
           !["GET", "HEAD", "OPTIONS"].contains(task.request.httpMethod ?? "GET"),
           task.request.value(forHTTPHeaderField: "Origin") == nil {
            var headers = task.request.allHTTPHeaderFields ?? [:]
            headers["Origin"] = origin
            request["headers"] = headers
        }
        if let body = task.request.httpBody {
            guard body.count <= 8 * 1024 * 1024 else { fail(id, URLError(.dataLengthExceedsMaximum)); return }
            request["body"] = body.base64EncodedString()
        } else if let stream = task.request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 8192)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count < 0 {
                    tasks.removeValue(forKey: id)
                    task.didFailWithError(stream.streamError ?? URLError(.cannotDecodeRawData))
                    return
                }
                if count == 0 { break }
                guard data.count + count <= 8 * 1024 * 1024 else { fail(id, URLError(.dataLengthExceedsMaximum)); return }
                data.append(buffer, count: count)
            }
            request["body"] = data.base64EncodedString()
        }
        request["redirectCount"] = redirects
        request["follow"] = !documentTasks.contains(id)
        execute(request) { [weak self] result in
            guard let self = self, !self.closed else { return }
            switch result {
            case .success(let value):
                guard var response = value as? [String: Any] else { self.fail(id, URLError(.cannotParseResponse)); return }
                response["id"] = id; self.receive(response)
            case .failure(let error): self.fail(id, error)
            }
        }
    }
    private func fail(_ id: String, _ error: Error) {
        cancelStream(id)
        awaitingHeaders.remove(id)
        documentOrigins.removeValue(forKey: id)
        if documentTasks.remove(id) != nil { redirects = 0 }
        tasks.removeValue(forKey: id)?.didFailWithError(error)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard var request = message.body as? [String: Any], message.frameInfo.isMainFrame else { replyHandler(nil, "Invalid request"); return }
        if let body = request["formNavigate"] as? [String: Any], let address = body["url"] as? String,
           let url = URL(string: address), isLocal(url),
           let encoded = body["body"] as? String, let bytes = Data(base64Encoded: encoded) {
            var navigation = URLRequest(url: url)
            navigation.httpMethod = "POST"
            navigation.httpBody = bytes
            navigation.allHTTPHeaderFields = body["headers"] as? [String: String]
            replyHandler(true, nil)
            page?.load(navigation)
            return
        }
        let id = UUID().uuidString
        request["id"] = id
        // Script-message fetches bypass WebKit's network header generation.
        // Derive Origin from the sending frame for state-changing requests.
        if let method = request["method"] as? String,
           !["GET", "HEAD", "OPTIONS"].contains(method.uppercased()) {
            var headers = request["headers"] as? [String: String] ?? [:]
            if !headers.keys.contains(where: { $0.caseInsensitiveCompare("Origin") == .orderedSame }),
               let origin = localInitiator(message.frameInfo) {
                headers["Origin"] = origin
                request["headers"] = headers
            }
        }
        let streamId = request["streamId"] as? String ?? id
        fetchReplies[id] = replyHandler
        fetchRequests[id] = request
        if ready { dispatchFetch(id) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            self?.fetchRequests.removeValue(forKey: id)
            if let reply = self?.fetchReplies.removeValue(forKey: id) {
                self?.fetchStreams.remove(streamId)
                self?.cancelStream(streamId)
                reply(nil, "Fetch timeout")
            }
        }
    }
    private func dispatchFetch(_ id: String) {
        guard let request = fetchRequests.removeValue(forKey: id) else { return }
        execute(request) { [weak self] result in
            guard let self = self, !self.closed, let reply = self.fetchReplies.removeValue(forKey: id) else { return }
            switch result {
            case .success(let value):
                if let result = value as? [String: Any] {
                    if let streamId = result["streamId"] as? String { self.fetchStreams.insert(streamId) }
                    if result["done"] as? Bool == true, let streamId = request["streamId"] as? String { self.fetchStreams.remove(streamId) }
                }
                reply(value, nil)
            case .failure(let error):
                if let streamId = request["streamId"] as? String { self.fetchStreams.remove(streamId); self.cancelStream(streamId) }
                reply(nil, error.localizedDescription)
            }
        }
    }
    private func receive(_ result: [String: Any]) {
        guard let id = result["id"] as? String, let task = tasks[id],
              let status = result["status"] as? Int, let headers = result["headers"] as? [String: String],
              let encoded = result["body"] as? String, let body = Data(base64Encoded: encoded) else { return }
        awaitingHeaders.remove(id)
        let isDocument = documentTasks.remove(id) != nil
        if isDocument, let navigation = result["navigation"] as? [String: Any] {
            guard let address = navigation["url"] as? String, let url = URL(string: address), isLocal(url),
                  let method = navigation["method"] as? String,
                  let requestHeaders = navigation["headers"] as? [String: String] else {
                redirects = 0
                task.didFailWithError(URLError(.cannotParseResponse))
                return
            }
            tasks.removeValue(forKey: id)
            redirects += 1
            var next = URLRequest(url: url)
            next.httpMethod = method
            next.allHTTPHeaderFields = requestHeaders
            if let encoded = navigation["body"] as? String {
                guard let bytes = Data(base64Encoded: encoded) else { task.didFailWithError(URLError(.cannotDecodeRawData)); return }
                next.httpBody = bytes
            }
            // Finish no intermediate document: replace the provisional load with
            // a new native request, preserving POST for 307/308.
            task.didFailWithError(URLError(.cancelled))
            page?.load(next)
            return
        }
        if isDocument { redirects = 0 }
        guard let response = HTTPURLResponse(url: task.request.url!, statusCode: status, httpVersion: nil, headerFields: headers) else { task.didFailWithError(URLError(.cannotParseResponse)); return }
        task.didReceive(response)
        if let streamId = result["streamId"] as? String {
            pull(id, streamId)
        } else {
            tasks.removeValue(forKey: id)
            task.didReceive(body)
            task.didFinish()
        }
    }
    private func pull(_ id: String, _ streamId: String) {
        guard tasks[id] != nil, !closed else { cancelStream(streamId); return }
        execute(["action": "pull", "streamId": streamId]) { [weak self] result in
            guard let self = self, let task = self.tasks[id], !self.closed else { return }
            switch result {
            case .failure(let error): self.fail(id, error)
            case .success(let value):
                guard let chunk = value as? [String: Any], let done = chunk["done"] as? Bool,
                      let encoded = chunk["body"] as? String, let bytes = Data(base64Encoded: encoded) else {
                    self.fail(id, URLError(.cannotDecodeRawData)); return
                }
                if done { self.tasks.removeValue(forKey: id); task.didFinish() }
                else { task.didReceive(bytes); self.pull(id, streamId) }
            }
        }
    }
}
