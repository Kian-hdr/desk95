import AppKit
import WebKit
import UniformTypeIdentifiers

extension AppDelegate {
    func isTrusted(_ frame: WKFrameInfo) -> Bool { frame.isMainFrame && frame.request.url.map { ShellPolicy.localAllowed($0, root: webRoot) } == true }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard isTrusted(message.frameInfo), let body=message.body as? [String:Any], let action=(body["command"] ?? body["action"] ?? body["type"]) as? String else { replyHandler(nil,"Untrusted native bridge call");return }
        switch action {
        case "runtimeError", "consoleLog":
            let record: [String: Any] = ["kind": action, "message": String((body["message"] as? String ?? "Unknown runtime error").prefix(500)), "line": body["line"] as? Int ?? 0]
            startupErrors.append(record)
            if startupErrors.count > 20 { startupErrors.removeFirst() }
            NSLog("Desk95 runtime: %@", record["message"] as? String ?? "Unknown error")
            replyHandler(["recorded": true], nil)
        case "ready":
            ready=true;replyHandler(["ready":true],nil);runStartup()
        case "saveFile":
            guard let name=body["name"] as? String, let b64=body["base64"] as? String, let data=Data(base64Encoded:b64) else {replyHandler(nil,"Invalid file data");return}
            presentSavePanel(name: name, data: data, reply: replyHandler)
        case "toggleFullscreen":
            window.toggleFullScreen(nil);replyHandler(["ok":true],nil)
        case "openExternal":
            guard let value=body["url"] as? String, let url=URL(string:value),ShellPolicy.externalAllowed(url) else {replyHandler(nil,"Unsupported external URL");return}
            NSWorkspace.shared.open(url);replyHandler(["opened":true],nil)
        default: replyHandler(nil,"Unknown native action")
        }
    }

    func presentSavePanel(name: String, data: Data, reply: @escaping (Any?, String?) -> Void) {
        guard activeSavePanel == nil else { reply(nil, "Another export is already open"); return }
        let panel = NSSavePanel()
        let filename = ShellPolicy.safeName(name)
        let ext = URL(fileURLWithPath: filename).pathExtension
        panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        panel.allowsOtherFileTypes = true
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.nameFieldStringValue = filename
        activeSavePanel = panel
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] result in
            defer { self?.activeSavePanel = nil }
            guard result == .OK, let url = panel.url else { reply(["saved": false], nil); return }
            do {
                try data.write(to: url, options: .atomic)
                reply(["saved": true], nil)
            } catch { reply(nil, error.localizedDescription) }
        }
        if arguments.contains("--app-modal-save") { panel.begin(completionHandler: finish) }
        else { panel.beginSheetModal(for: window, completionHandler: finish) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self, weak panel] in
            guard let self, let panel, self.activeSavePanel === panel else { return }
            self.recordSavePanelState(panel)
        }
    }
    func recordSavePanelState(_ panel: NSSavePanel) {
        let directory = panel.directoryURL
        let state: [String: Any] = [
            "stage": "save-panel-open", "filename": panel.nameFieldStringValue,
            "url": panel.url?.path ?? NSNull(), "directory": directory?.path ?? NSNull(),
            "directoryWritable": directory.map { FileManager.default.isWritableFile(atPath: $0.path) } ?? false,
            "allowedTypes": panel.allowedContentTypes.map(\.identifier), "allowsOtherFileTypes": panel.allowsOtherFileTypes,
            "canCreateDirectories": panel.canCreateDirectories, "visible": panel.isVisible,
            "keyWindow": panel.isKeyWindow, "sheetAttached": window.attachedSheet === panel
        ]
        guard let base = argument("--diagnostics") else { return }
        let url = URL(fileURLWithPath: base).deletingPathExtension().appendingPathExtension("save-panel.json")
        do { try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic) }
        catch { NSLog("Desk95 save panel diagnostic failed: %@", error.localizedDescription) }
    }

    func openBackup() {
        let panel=NSOpenPanel();panel.canChooseFiles=true;panel.allowedContentTypes=[.zip];panel.allowsMultipleSelection=false;panel.canChooseDirectories=false
        panel.beginSheetModal(for:window){[weak self] result in guard result == .OK,let url=panel.url else{return};self?.importBackup(url){_ in}}
    }
    func importBackup(_ url:URL,completion:@escaping @MainActor @Sendable (Result<Any,Error>)->Void) {
        do {let data=try Data(contentsOf:url);guard data.count <= 210_000_000 else {throw NSError(domain:"Desk95",code:1,userInfo:[NSLocalizedDescriptionKey:"Backup exceeds 200 MB"])}
            web.callAsyncJavaScript("return await window.desk95Native.importBackup(base64)",arguments:["base64":data.base64EncodedString()],in:nil,in:.page,completionHandler:completion)
        } catch {showError(error.localizedDescription);completion(.failure(error))}
    }
}
