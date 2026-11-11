import Cocoa

/// Menu bar wrapper. Every action is the `wavesmith` command. This file does not
/// start the server, read .env, or keep a copy of the phone-door rules.
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let loginItem = NSMenuItem(title: "Launch at Login", action: #selector(toggleLogin), keyEquivalent: "")
    let statusLine = NSMenuItem(title: "Checking…", action: nil, keyEquivalent: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusLine.isEnabled = false
        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(statusLine)
        menu.addItem(.separator())
        menu.addItem(item("Start", action: #selector(startServer)))
        menu.addItem(item("Stop", action: #selector(stopServer)))
        menu.addItem(item("Open Wavesmith", action: #selector(openApp)))
        menu.addItem(item("Status", action: #selector(showStatus)))
        menu.addItem(.separator())
        loginItem.target = self
        menu.addItem(loginItem)
        menu.addItem(.separator())
        menu.addItem(item("Quit", action: #selector(quit)))
        statusItem.menu = menu
        if let button = statusItem.button {
            if let image = NSImage(systemSymbolName: "music.note", accessibilityDescription: "Wavesmith") {
                image.isTemplate = true
                button.image = image
            } else {
                button.title = "W"
            }
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        let text = run(["status"]).trimmingCharacters(in: .whitespacesAndNewlines)
        statusLine.title = text.split(separator: "\n").first.map(String.init) ?? "Wavesmith"
        let login = run(["login", "status"]).trimmingCharacters(in: .whitespacesAndNewlines)
        loginItem.state = login == "on" ? .on : .off
    }

    @objc func startServer() { _ = run(["start"]) }
    @objc func stopServer() { _ = run(["stop"]) }
    @objc func openApp() { _ = run(["open"]) }
    @objc func showStatus() {
        let text = run(["status"]).trimmingCharacters(in: .whitespacesAndNewlines)
        let alert = NSAlert()
        alert.messageText = "Wavesmith"
        alert.informativeText = text.isEmpty ? "No status." : text
        alert.runModal()
    }
    @objc func toggleLogin() {
        let login = run(["login", "status"]).trimmingCharacters(in: .whitespacesAndNewlines)
        _ = run(["login", login == "on" ? "off" : "on"])
    }
    @objc func quit() {
        NSApp.terminate(nil)
    }

    func item(_ title: String, action: Selector) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = self
        return entry
    }

    func wavesmithPath() -> String {
        let home = NSHomeDirectory()
        return "\(home)/.local/bin/wavesmith"
    }

    func run(_ args: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: wavesmithPath())
        process.arguments = args
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
        } catch {
            return "Couldn't run wavesmith.\nFix: run the installer again."
        }
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
