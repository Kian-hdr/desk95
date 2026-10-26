import AppKit
import WebKit
import UniformTypeIdentifiers

extension AppDelegate {
    static let startupInstrumentation = """
    window.__DESK95_NATIVE__ = true;
    (() => {
      const post=(message,line=0)=>window.webkit.messageHandlers.desk95.postMessage({command:'runtimeError',message:String(message).slice(0,500),line}).catch(()=>{});
      window.addEventListener('error',event=>{
        if(event.target!==window){const node=event.target;post('Resource load failed: '+String(node.tagName||'unknown')+' '+String(node.src||node.href||'').split('/').pop());}
        else post(event.message||event.error?.name||'Script error',event.lineno||0);
      },true);
      window.addEventListener('unhandledrejection',event=>post('Unhandled promise: '+String(event.reason?.message||event.reason?.name||event.reason)));
    })();
    """
    func captureStartupDiagnostic(timeout: Bool) {
        guard argument("--diagnostics") != nil else { return }
        web.evaluateJavaScript("""
        ({title:document.title,readyState:document.readyState,rootChildren:document.getElementById('root')?.childElementCount??-1,bodyChildren:document.body?.childElementCount??-1,nativeBridge:typeof window.desk95Native,secureContext:window.isSecureContext,indexedDB:typeof indexedDB,fontLoaded:document.fonts.check('16px W95FA'),scripts:Array.from(document.scripts).map(s=>({type:s.type,source:s.src.split('/').pop()})),resources:performance.getEntriesByType('resource').map(r=>({name:r.name.split('/').pop(),duration:r.duration})).slice(0,30)})
        """) { [weak self] value, error in
            guard let self else { return }
            if let dom = value as? [String: Any] { self.startupDOM = dom }
            if self.ready && !timeout { return }
            if let error { self.startupErrors.append(["kind":"evaluation", "message": error.localizedDescription]) }
            var report: [String: Any] = ["ready":self.ready,"stage":timeout ? "startup-timeout":"document-loaded","dom":self.startupDOM,"runtimeErrors":self.startupErrors]
            if timeout { report["error"] = "Native interface startup timed out" }
            self.writeDiagnostic(report, final: timeout)
        }
    }

    func runStartup() {
        guard !startupRan else{return};startupRan=true
        if let path=argument("--import-backup") {importBackup(URL(fileURLWithPath:path)){[weak self] result in
            switch result {case .success:self?.finishStartup();case .failure(let error):self?.writeDiagnostic(["ready":true,"importError":error.localizedDescription]);self?.showError(error.localizedDescription)}
        }} else {finishStartup()}
    }
    func finishStartup() {
        if let path=argument("--export-backup") {
            web.callAsyncJavaScript("return await window.desk95Native.exportBackup()",arguments:[:],in:nil,in:.page){[weak self] result in
                do {let value=try result.get();let base64=(value as? String) ?? ((value as? [String:Any])?["base64"] as? String)
                    guard let base64,let data=Data(base64Encoded:base64) else {throw NSError(domain:"Desk95",code:2,userInfo:[NSLocalizedDescriptionKey:"Export did not return backup data"])}
                    try data.write(to:URL(fileURLWithPath:path),options:.atomic);self?.captureDiagnostics()
                } catch {self?.writeDiagnostic(["ready":true,"exportError":error.localizedDescription])}
            }
        } else {captureDiagnostics()}
    }
    func captureDiagnostics() {
        web.callAsyncJavaScript("const workspace = await window.desk95Native.inspect(); await document.fonts.ready; return { ...workspace, runtime: { origin: location.origin, secureContext: isSecureContext, indexedDB: typeof indexedDB, fontLoaded: document.fonts.check('16px W95FA'), bodyFont: getComputedStyle(document.body).fontFamily, native: window.__DESK95_NATIVE__ === true } }",arguments:[:],in:nil,in:.page){[weak self] result in
            guard let self else{return}
            var report:[String:Any]=["ready":true,"bundle":Bundle.main.bundleIdentifier ?? "", "origin":"file://", "macOS":ProcessInfo.processInfo.operatingSystemVersionString]
            switch result {case .success(let value):report["workspace"]=value;case .failure(let error):report["inspectError"]=error.localizedDescription}
            report["runtimeErrors"] = self.startupErrors
            self.writeDiagnostic(report)
            if let path=self.argument("--snapshot") {let config=WKSnapshotConfiguration();self.web.takeSnapshot(with:config){image,error in
                guard let image,let tiff=image.tiffRepresentation,let rep=NSBitmapImageRep(data:tiff),let png=rep.representation(using:.png,properties:[:]) else{return};try? png.write(to:URL(fileURLWithPath:path),options:.atomic)
            }}
        }
    }
    func writeDiagnostic(_ report:[String:Any], final: Bool = true) {guard let path=argument("--diagnostics") else{return};do {let data=try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]);try data.write(to:URL(fileURLWithPath:path),options:.atomic);if final { diagnosticsTimer?.invalidate() }} catch {NSLog("Desk95 diagnostic write failed: %@",error.localizedDescription)} }
    func showError(_ text:String) {let alert=NSAlert();alert.messageText="Desk95";alert.informativeText=text;alert.alertStyle = .warning;alert.beginSheetModal(for:window)}

}
