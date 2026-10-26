import AppKit
import WebKit
import UniformTypeIdentifiers

extension AppDelegate {
    func buildMenus() {
        let bar = NSMenu()
        let app = NSMenuItem(); bar.addItem(app); let appMenu = NSMenu(); app.submenu = appMenu
        appMenu.addItem(withTitle: "About Desk95", action: #selector(about), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        add(appMenu, "Settings…", "settings", ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Desk95", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Desk95", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let file = submenu(bar, "File")
        add(file,"New Page", "new-page", "n")
        add(file,"New Task", "new-task", "t")
        add(file,"New Project", "new-project", "n", [.command, .shift])
        file.addItem(.separator()); add(file,"Save", "save", "s")
        add(file,"Import Backup…", "import", "i", [.command,.shift])
        add(file,"Export Backup…", "export", "e", [.command,.shift])
        file.addItem(.separator()); file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let edit = submenu(bar,"Edit")
        for (title, selector, key, modifiers) in [("Undo", "undo:", "z", NSEvent.ModifierFlags.command), ("Redo", "redo:", "z", [.command,.shift]), ("Cut", "cut:", "x", .command), ("Copy", "copy:", "c", .command), ("Paste", "paste:", "v", .command), ("Select All", "selectAll:", "a", .command)] {
            let item = edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key); item.keyEquivalentModifierMask = modifiers
        }
        edit.addItem(.separator()); add(edit,"Find / Commands…", "search", "k")
        let view = submenu(bar,"View"); add(view,"Search…", "search", "f")
        view.addItem(withTitle:"Enter Full Screen", action:#selector(NSWindow.toggleFullScreen(_:)),keyEquivalent:"f").keyEquivalentModifierMask = [.control,.command]
        let win = submenu(bar,"Window")
        win.addItem(withTitle:"Minimize", action:#selector(NSWindow.performMiniaturize(_:)),keyEquivalent:"m")
        win.addItem(withTitle:"Zoom", action:#selector(NSWindow.performZoom(_:)),keyEquivalent:"")
        NSApp.windowsMenu = win
        NSApp.mainMenu = bar
    }
    func submenu(_ parent:NSMenu,_ title:String)->NSMenu { let item=NSMenuItem(title:title,action:nil,keyEquivalent:"");let menu=NSMenu(title:title);item.submenu=menu;parent.addItem(item);return menu }
    func add(_ menu:NSMenu,_ title:String,_ command:String,_ key:String,_ modifiers:NSEvent.ModifierFlags = .command) { let item=menu.addItem(withTitle:title,action:#selector(command(_:)),keyEquivalent:key);item.target=self;item.representedObject=command;item.keyEquivalentModifierMask=modifiers }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options:[.applicationName:"Desk95",.applicationVersion:"1.1.0",.credits:NSAttributedString(string:"A local Windows 95 workspace. Interface font: W95FA by Alina Sava, SIL OFL 1.1.")]) }
    @objc func command(_ sender:NSMenuItem) {
        guard ready, let name=sender.representedObject as? String else { NSSound.beep();return }
        if name == "import" { openBackup();return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('desk95:command', {detail:{name:'\(name)'}}))")
    }

}
