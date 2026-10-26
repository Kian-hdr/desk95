import XCTest
@testable import Desk95
final class PolicyTests: XCTestCase {
    func testExternalSchemes() {XCTAssertTrue(ShellPolicy.externalAllowed(URL(string:"https://example.com")!));XCTAssertFalse(ShellPolicy.externalAllowed(URL(string:"javascript:alert(1)")!));XCTAssertFalse(ShellPolicy.externalAllowed(URL(string:"file:///etc/passwd")!))}
    func testLocalBoundary() {let root=URL(fileURLWithPath:"/tmp/Web");XCTAssertTrue(ShellPolicy.localAllowed(root.appendingPathComponent("index.html"),root:root));XCTAssertFalse(ShellPolicy.localAllowed(URL(fileURLWithPath:"/tmp/Web-other/index.html"),root:root));XCTAssertFalse(ShellPolicy.localAllowed(URL(fileURLWithPath:"/tmp/Web/../secret"),root:root))}
    func testCloseContract() {XCTAssertTrue(ShellPolicy.closeAllowed(["ok": true]));XCTAssertFalse(ShellPolicy.closeAllowed(["ok": false,"reason": "failed"]));XCTAssertFalse(ShellPolicy.closeAllowed(["unexpected": true]));XCTAssertFalse(ShellPolicy.closeAllowed(true))}
    func testSafeFilename() {XCTAssertEqual(ShellPolicy.safeName("../../backup.zip"),"backup.zip")}
}
