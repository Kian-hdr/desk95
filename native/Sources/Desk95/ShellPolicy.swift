import Foundation

struct ShellPolicy {
    static func externalAllowed(_ url: URL) -> Bool { ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") }
    static func localAllowed(_ url: URL, root: URL) -> Bool {
        guard url.isFileURL else { return false }
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path
        return path == base || path.hasPrefix(base + "/")
    }
    static func closeAllowed(_ value: Any) -> Bool {
        (value as? [String: Any])?["ok"] as? Bool == true
    }
    static func safeName(_ name: String) -> String { URL(fileURLWithPath: name).lastPathComponent }
}

