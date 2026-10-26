import AppKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    var window: NSWindow!
    var web: WKWebView!
    var webRoot: URL!
    var ready = false
    var quitting = false
    var startupRan = false
    var diagnosticsTimer: Timer?
    var startupErrors: [[String: Any]] = []
    var startupDOM: [String: Any] = [:]
    var activeSavePanel: NSSavePanel?
    let arguments = CommandLine.arguments
    func argument(_ name: String) -> String? { guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }; return arguments[i + 1] }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenus()
        guard let resources = Bundle.main.resourceURL else { fatalError("Missing application resources") }
        webRoot = resources.appendingPathComponent("Web", isDirectory: true)
        let index = webRoot.appendingPathComponent("index.html")
        guard FileManager.default.fileExists(atPath: index.path) else { fatalError("Desk95 bundled interface is missing") }
        let configuration = WKWebViewConfiguration()
        if let id = argument("--test-store"), let uuid = UUID(uuidString: id) {
            configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: uuid)
        } else { configuration.websiteDataStore = .default() }
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "desk95")
        configuration.userContentController.addUserScript(WKUserScript(source: Self.startupInstrumentation, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Desk95"
        window.minSize = NSSize(width: 640, height: 480)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("Desk95MainWindow")
        window.makeKeyAndOrderFront(nil)
        web.loadFileURL(index, allowingReadAccessTo: webRoot)
        NSApp.activate(ignoringOtherApps: true)
        // A failed startup must produce a diagnostic rather than hang indefinitely.
        if argument("--diagnostics") != nil {
            diagnosticsTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
                Task { @MainActor in self?.captureStartupDiagnostic(timeout: true) }
            }
        }
    }

    func prepareClose(_ completion:@escaping(Bool)->Void) {
        guard ready else{completion(true);return}
        web.callAsyncJavaScript("return await window.desk95Native.prepareToClose()",arguments:[:],in:nil,in:.page){[weak self] result in
            if case .success(let value)=result,ShellPolicy.closeAllowed(value) {completion(true);return}
            guard let self else{completion(false);return}
            var reason = "Keep Desk95 open to retry saving or export recovery data. Closing now may lose unsaved changes."
            if case .success(let value) = result, let detail = (value as? [String: Any])?["reason"] as? String { reason = detail + "\n\n" + reason }
            let a=NSAlert();a.messageText="Your latest changes are not saved";a.informativeText=reason;a.addButton(withTitle:"Keep Open");a.addButton(withTitle:"Close Anyway");a.beginSheetModal(for:self.window){completion($0 == .alertSecondButtonReturn)}
        }
    }
    func windowShouldClose(_ sender:NSWindow)->Bool {if quitting{return true};prepareClose{[weak self] close in guard let self,close else{return};self.quitting=true;NSApp.terminate(nil)};return false}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply {if quitting{return .terminateNow};prepareClose{[weak self] close in self?.quitting=close;NSApp.reply(toApplicationShouldTerminate:close)};return .terminateLater}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool {window.makeKeyAndOrderFront(nil);return true}
}
@main
struct Desk95Application {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
