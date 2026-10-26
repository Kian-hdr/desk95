import AppKit
import WebKit
import UniformTypeIdentifiers

extension AppDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { captureStartupDiagnostic(timeout: false) }

    func webView(_ webView:WKWebView, decidePolicyFor action:WKNavigationAction, decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        guard let url=action.request.url else{decisionHandler(.cancel);return}
        if action.targetFrame?.isMainFrame == true,ShellPolicy.localAllowed(url,root:webRoot) {decisionHandler(.allow);return}
        if action.navigationType == .linkActivated,ShellPolicy.externalAllowed(url) {NSWorkspace.shared.open(url)}
        decisionHandler(.cancel)
    }
    func webView(_ webView:WKWebView, createWebViewWith configuration:WKWebViewConfiguration, for action:WKNavigationAction, windowFeatures:WKWindowFeatures)->WKWebView? {if action.navigationType == .linkActivated, let url=action.request.url,ShellPolicy.externalAllowed(url){NSWorkspace.shared.open(url)};return nil}
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){showError(error.localizedDescription);writeDiagnostic(["ready":false,"navigationError":error.localizedDescription])}
    func webViewWebContentProcessDidTerminate(_ webView:WKWebView){showError("The interface process stopped. Reopen Desk95 to recover saved work. Pending unsaved edits may not have been saved.")}
    func webView(_ webView:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping()->Void){let a=NSAlert();a.messageText="Desk95";a.informativeText=message;a.beginSheetModal(for:window){_ in completionHandler()}}
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){let a=NSAlert();a.messageText="Desk95";a.informativeText=message;a.addButton(withTitle:"OK");a.addButton(withTitle:"Cancel");a.beginSheetModal(for:window){completionHandler($0 == .alertFirstButtonReturn)}}
    func webView(_ webView:WKWebView,runJavaScriptTextInputPanelWithPrompt prompt:String,defaultText:String?,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(String?)->Void){let a=NSAlert();a.messageText=prompt;a.addButton(withTitle:"OK");a.addButton(withTitle:"Cancel");let field=NSTextField(string:defaultText ?? "");field.frame=NSRect(x:0,y:0,width:320,height:24);a.accessoryView=field;a.beginSheetModal(for:window){completionHandler($0 == .alertFirstButtonReturn ? field.stringValue:nil)}}
    func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){let p=NSOpenPanel();p.canChooseFiles=true;p.allowedContentTypes=[.data];p.allowsOtherFileTypes=true;p.allowsMultipleSelection=parameters.allowsMultipleSelection;p.canChooseDirectories=false;p.beginSheetModal(for:window){completionHandler($0 == .OK ? p.urls:nil)}}

}
