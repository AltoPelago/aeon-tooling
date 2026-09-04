import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let alert = NSAlert()
        alert.messageText = "AEON QuickLook"
        alert.informativeText = "AEON QuickLook is active.\n\nIt provides macOS Quick Look previews with syntax highlighting for .aeon and .and files in Finder.\n\nSelect any .aeon or .and file in Finder and press Spacebar to preview."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
        NSApp.terminate(nil)
    }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        for file in filenames {
            let url = URL(fileURLWithPath: file)
            NSWorkspace.shared.open(url)
        }
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
