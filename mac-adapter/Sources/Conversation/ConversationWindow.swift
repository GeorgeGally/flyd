import AppKit
import WebKit

/// Where a navigation inside the Conversation window may go: the view's own
/// pages stay inside, web links open in the default browser, anything else
/// (a dropped file, an unknown scheme) goes nowhere.
enum ConversationLinkPolicy: Equatable {
    case allow
    case openExternally
    case block

    static func decide(_ url: URL?, serverOrigin: URL?) -> ConversationLinkPolicy {
        guard let url, let scheme = url.scheme?.lowercased() else { return .block }
        if scheme == "about" { return .allow }
        if let origin = serverOrigin, scheme == "http", url.host == origin.host, url.port == origin.port { return .allow }
        if ["http", "https", "mailto"].contains(scheme) { return .openExternally }
        return .block
    }
}

/// Breaks the WKUserContentController → handler retain cycle.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// The Conversation window: the captain's conversation with firstmate (later
/// Flyd), rendered by the view server in a native window. While it is open
/// Flyd is a regular Dock app with menus; closed, it is back to the menu bar.
final class ConversationWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let shared = ConversationWindow()

    private var window: NSWindow?
    private var webView: WKWebView?
    private var serverURL: URL?
    private var failure: String?

    private static let darkBackground = NSColor(srgbRed: 0x10 / 255, green: 0x11 / 255, blue: 0x13 / 255, alpha: 1)
    private static let lightBackground = NSColor(srgbRed: 0xf6 / 255, green: 0xf5 / 255, blue: 0xf1 / 255, alpha: 1)

    var isVisible: Bool { window?.isVisible ?? false }

    func show() {
        let window = self.window ?? makeWindow()
        NSApp.setActivationPolicy(.regular)
        ConversationMenu.install()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func toggle() {
        if let window, window.isVisible, window.isKeyWindow { window.performClose(nil) } else { show() }
    }

    /// The server is up (again) at `url`; load it if that is new.
    func serverReady(_ url: URL) {
        failure = nil
        let changed = serverURL != url
        serverURL = url
        if changed || webView?.url?.scheme == "about" { load() }
    }

    func serverFailed(_ message: String) {
        failure = message
        if serverURL == nil { load() }
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 1040),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Conversation"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = Self.darkBackground
        window.appearance = NSAppearance(named: .darkAqua)
        window.minSize = NSSize(width: 420, height: 480)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.delegate = self
        window.center()
        // Remembers size and position across launches.
        window.setFrameAutosaveName("FlydConversationWindow")

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(WeakScriptHandler(self), name: "flyd")
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let webView = WKWebView(frame: window.contentLayoutRect, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = true
        webView.autoresizingMask = [.width, .height]
        window.contentView = webView

        self.window = window
        self.webView = webView
        load()
        return window
    }

    private func load() {
        guard let webView else { return }
        if let serverURL {
            webView.load(URLRequest(url: serverURL))
            return
        }
        let message = failure.map { "Conversation unavailable: \($0)" } ?? "Starting…"
        let escaped = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
        webView.loadHTMLString(
            """
            <!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;\
            background:#101113;color:#7c7f86;font:14px ui-monospace,Menlo,monospace">\(escaped)</body>
            """,
            baseURL: nil
        )
    }

    // MARK: NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        // Back to a menu-bar presence once nothing is open.
        DispatchQueue.main.async { NSApp.setActivationPolicy(.accessory) }
    }

    // MARK: WKNavigationDelegate / WKUIDelegate

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        switch ConversationLinkPolicy.decide(action.request.url, serverOrigin: serverURL) {
        case .allow:
            decisionHandler(.allow)
        case .openExternally:
            if let url = action.request.url { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        case .block:
            decisionHandler(.cancel)
        }
    }

    /// target="_blank" links: never a new web view; the default browser instead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if ConversationLinkPolicy.decide(action.request.url, serverOrigin: serverURL) != .block, let url = action.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard CommandLine.arguments.contains("--conversation-selftest"), webView.url?.scheme == "http" else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.runSelfTest(webView) }
    }

    /// `--conversation-selftest`: exercises the page inside this WKWebView and
    /// logs what worked. Delivers nothing: the send check uses a bad session id.
    private func runSelfTest(_ webView: WKWebView) {
        let script = """
        const out = {};
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        out.messages = document.querySelectorAll('article').length;
        out.captain = document.querySelectorAll('.msg.user .hl').length;
        out.summaries = document.querySelectorAll('.has-summary').length;
        out.thumbnails = document.querySelectorAll('.shot img').length;
        out.composer = !document.getElementById('composer').hidden;
        const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        const file = new File([blob], 'selftest.png', { type: 'image/png' });
        const pasted = new DataTransfer(); pasted.items.add(file);
        document.getElementById('input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: pasted, bubbles: true, cancelable: true }));
        await wait(500);
        out.pastePreview = document.querySelectorAll('.attachment img').length;
        document.querySelectorAll('.attachment button').forEach((b) => b.click());
        const dropped = new DataTransfer(); dropped.items.add(file);
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dropped, bubbles: true, cancelable: true }));
        await wait(500);
        out.dropPreview = document.querySelectorAll('.attachment img').length;
        document.querySelectorAll('.attachment button').forEach((b) => b.click());
        const shot = document.querySelector('.shot');
        if (shot) { shot.click(); out.lightbox = !document.getElementById('lightbox').hidden; document.getElementById('lightbox').click(); }
        try { const audio = new (window.AudioContext || window.webkitAudioContext)(); out.audio = audio.state; await audio.close(); } catch (e) { out.audio = 'error: ' + e; }
        const token = (await (await fetch('/api/token')).json()).token;
        const send = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-flyd-view-token': token }, body: JSON.stringify({ session: '../selftest', text: 'selftest' }) });
        out.sendPlumbing = send.status + ' ' + (await send.json()).error;
        out.externalLinks = document.querySelectorAll('.body a[target=_blank]').length;
        return JSON.stringify(out);
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): ConversationServer.appendLog("conversation selftest: \(value ?? "nil")")
            case .failure(let error): ConversationServer.appendLog("conversation selftest failed: \(error)")
            }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }

    // MARK: WKScriptMessageHandler

    /// The page reports its theme so the title bar matches it.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "flyd", let body = message.body as? [String: Any], let theme = body["theme"] as? String else { return }
        let light = theme == "light"
        window?.appearance = NSAppearance(named: light ? .aqua : .darkAqua)
        window?.backgroundColor = light ? Self.lightBackground : Self.darkBackground
    }
}

/// Menus for while Flyd is a regular app: Edit gives the web view copy,
/// paste and select-all; Window gives ⌘W.
enum ConversationMenu {
    static func install() {
        guard NSApp.mainMenu?.item(withTitle: "Edit") == nil else { return }
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Flyd")
        appMenu.addItem(withTitle: "Hide Flyd", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Flyd", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }
}
