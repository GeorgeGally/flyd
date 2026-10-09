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
    /// The page has loaded the view; scripts queued before then run on load.
    private var pageReady = false
    private var pendingScripts: [String] = []
    private var voiceActive = false

    /// Push-to-talk (Fn+Control) as the page sees it.
    enum VoiceEvent {
        case start
        case draft(String)
        case transcribing
        case send(String)
        case cancel
        case fail(String)
    }

    private static let darkBackground = NSColor(srgbRed: 0x10 / 255, green: 0x11 / 255, blue: 0x13 / 255, alpha: 1)
    private static let lightBackground = NSColor(srgbRed: 0xf6 / 255, green: 0xf5 / 255, blue: 0xf1 / 255, alpha: 1)

    var isVisible: Bool { window?.isVisible ?? false }
    /// The captain is reading the conversation right now.
    var isKeyAndVisible: Bool { (window?.isVisible ?? false) && (window?.isKeyWindow ?? false) && NSApp.isActive }

    func show() {
        let window = self.window ?? makeWindow()
        keepOnScreen(window)
        NSApp.setActivationPolicy(.regular)
        ConversationMenu.install()
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        // An accessory app that has just become a regular one is not always
        // allowed to take focus in the same pass; ask again a moment later.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        }
    }

    /// A remembered frame from a screen that is gone (or bigger than this one) comes back into view.
    private func keepOnScreen(_ window: NSWindow) {
        guard let visible = (window.screen ?? NSScreen.main)?.visibleFrame else { return }
        var frame = window.frame
        frame.size.width = min(frame.width, visible.width)
        frame.size.height = min(frame.height, visible.height)
        if !NSScreen.screens.contains(where: { $0.visibleFrame.intersects(frame) }) {
            frame.origin = NSPoint(x: visible.midX - frame.width / 2, y: visible.midY - frame.height / 2)
        }
        frame.origin.y = max(frame.origin.y, visible.minY)
        frame.origin.y = min(frame.origin.y, visible.maxY - frame.height)
        if frame != window.frame { window.setFrame(frame, display: false) }
    }

    func close() {
        window?.performClose(nil)
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

    /// Drives the message box from push-to-talk, in the background: the
    /// window is never raised or focused (the captain is looking at what he
    /// is talking about). The words go into the box as they are heard and
    /// are sent on release; an open window shows them, a closed one has the
    /// message waiting in the conversation.
    func voice(_ event: VoiceEvent) {
        switch event {
        case .start:
            voiceActive = true
            _ = window ?? makeWindow()
            run("window.flydVoice && window.flydVoice.start()")
        case .draft(let text):
            guard voiceActive else { return }
            run("window.flydVoice && window.flydVoice.draft(\(Self.jsString(text)))")
        case .transcribing:
            guard voiceActive else { return }
            run("window.flydVoice && window.flydVoice.transcribing()")
        case .send(let text):
            guard voiceActive else { return }
            voiceActive = false
            run("window.flydVoice && window.flydVoice.send(\(Self.jsString(text)))")
        case .cancel:
            guard voiceActive else { return }
            voiceActive = false
            run("window.flydVoice && window.flydVoice.cancel()")
        case .fail(let message):
            voiceActive = false
            run("window.flydVoice && window.flydVoice.cancel(\(Self.jsString(message)))")
        }
    }

    /// A Swift string as a JavaScript string literal.
    static func jsString(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
        let array = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }

    private func run(_ script: String) {
        guard let webView, pageReady else {
            pendingScripts.append(script)
            return
        }
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func load() {
        guard let webView else { return }
        pageReady = false
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

    func windowDidBecomeKey(_ notification: Notification) {
        // He is looking at the conversation; the island has nothing to add.
        if case .status = DictationPill.shared.currentPhase { DictationPill.shared.hide() }
    }

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

    /// Diagnostics: once the view has loaded and streamed, run the selftest.
    func runSelfTestWhenLoaded(attempt: Int = 0) {
        guard let webView, webView.url?.scheme == "http", !webView.isLoading else {
            if attempt < 120 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.runSelfTestWhenLoaded(attempt: attempt + 1) } }
            return
        }
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
        // A wide screenshot pasted: the preview shows the whole picture, uncropped.
        const wide = document.createElement('canvas'); wide.width = 1916; wide.height = 336;
        const wideBlob = await new Promise((r) => wide.toBlob(r, 'image/png'));
        document.querySelectorAll('.attachment button').forEach((b) => b.click());
        const widePaste = new DataTransfer(); widePaste.items.add(new File([wideBlob], 'wide.png', { type: 'image/png' }));
        document.getElementById('input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: widePaste, bubbles: true, cancelable: true }));
        await wait(600);
        const thumb = document.querySelector('.attachment img');
        if (thumb) {
          const tr = thumb.getBoundingClientRect();
          out.wideThumb = [Math.round(tr.width), Math.round(tr.height)];
          out.wideThumbAspectError = Math.round(Math.abs(tr.width / tr.height - thumb.naturalWidth / thumb.naturalHeight) * 100) / 100;
        }
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
        // "/" in the box lists skills (typed, never sent).
        const box = document.getElementById('input');
        box.value = '/'; box.dispatchEvent(new Event('input'));
        await wait(800);
        out.slashMenuOpen = !document.getElementById('commands').hidden;
        out.slashSkills = document.querySelectorAll('#commands .name').length;
        box.value = '/design-r'; box.dispatchEvent(new Event('input'));
        await wait(300);
        out.slashFiltered = Array.from(document.querySelectorAll('#commands .name')).map((n) => n.textContent).slice(0, 3);
        box.value = ''; box.dispatchEvent(new Event('input'));
        // Every wrapped line of a captain highlight should start at the same left edge.
        let wrapped = 0, spread = 0;
        document.querySelectorAll('.msg.user .hl').forEach((hl) => {
          const lefts = Array.from(hl.getClientRects()).map((r) => r.left);
          if (lefts.length > 1) { wrapped++; spread = Math.max(spread, Math.max(...lefts) - Math.min(...lefts)); }
        });
        out.wrappedHighlights = wrapped;
        out.wrapLeftSpread = spread;
        // Wrapped lines' highlights should touch: the largest gap between them, in px.
        let gap = -Infinity;
        document.querySelectorAll('.msg.user .hl').forEach((hl) => {
          const r = Array.from(hl.getClientRects());
          for (let i = 1; i < r.length; i++) gap = Math.max(gap, r[i].top - r[i - 1].bottom);
        });
        out.wrapLineGap = gap === -Infinity ? null : Math.round(gap * 10) / 10;
        out.sendLabel = document.getElementById('send').textContent;
        const sample = Array.from(document.querySelectorAll('.msg.user .hl')).reverse().find((hl) => hl.getClientRects().length > 1);
        if (sample) { sample.scrollIntoView({ block: 'center' }); await wait(300); }
        // Pasted code in the captain's messages: one block each; show the newest.
        const codeBlocks = Array.from(document.querySelectorAll('.msg.user pre'));
        out.captainCodeBlocks = codeBlocks.length;
        out.codeLineHighlights = document.querySelectorAll('.msg.user pre .hl').length;
        if (codeBlocks.length) { codeBlocks[codeBlocks.length - 1].scrollIntoView({ block: 'center' }); await wait(300); }
        return JSON.stringify(out);
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                ConversationServer.appendLog("conversation selftest: \(value ?? "nil")")
                self.logWindowState()
                self.saveSnapshot(webView)
                self.voiceSelfTest(webView)
            case .failure(let error): ConversationServer.appendLog("conversation selftest failed: \(error)")
            }
        }
    }

    /// Push-to-talk through the same bridge the Fn+Control path uses, without
    /// the microphone: start, words arrive, then cancel (nothing is sent).
    private func voiceSelfTest(_ webView: WKWebView) {
        let probe = "JSON.stringify({ value: document.getElementById('input').value, listening: document.getElementById('composer').classList.contains('listening') })"
        // Background: with the window closed, push-to-talk must not bring it back.
        window?.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
        voice(.start)
        ConversationServer.appendLog("conversation voice selftest: after start windowVisible=\(window?.isVisible ?? false) dockIcon=\(NSApp.activationPolicy() == .regular)")
        voice(.draft("selftest words"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            webView.evaluateJavaScript(probe) { during, _ in
                self.voice(.cancel)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    webView.evaluateJavaScript(probe) { after, _ in
                        ConversationServer.appendLog("conversation voice selftest: during=\(during ?? "nil") after=\(after ?? "nil")")
                    }
                }
            }
        }
    }

    /// What the selftest saw of the window itself.
    private func logWindowState() {
        guard let window else { return }
        let onScreen = NSScreen.screens.contains { $0.visibleFrame.intersects(window.frame) }
        ConversationServer.appendLog(
            "conversation window: visible=\(window.isVisible) key=\(window.isKeyWindow) onScreen=\(onScreen) " +
            "frame=\(NSStringFromRect(window.frame)) appActive=\(NSApp.isActive) dockIcon=\(NSApp.activationPolicy() == .regular)"
        )
    }

    /// The window's content as the captain sees it, without needing Screen Recording.
    private func saveSnapshot(_ webView: WKWebView) {
        webView.takeSnapshot(with: nil) { image, _ in
            guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else { return }
            let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".flyd/overlay/conversation-window.png")
            try? png.write(to: url)
            ConversationServer.appendLog("conversation snapshot: \(url.path)")
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.scheme == "http" else { return }
        pageReady = true
        let scripts = pendingScripts
        pendingScripts = []
        // Give the page's own script a moment to connect before replaying.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            scripts.forEach { webView.evaluateJavaScript($0, completionHandler: nil) }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }

    // MARK: WKScriptMessageHandler

    /// The page reports its theme (so the title bar matches it) and sent messages (for the island).
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "flyd", let body = message.body as? [String: Any] else { return }
        if body["sent"] as? Bool == true {
            ConversationStatus.shared.sent()
            return
        }
        guard let theme = body["theme"] as? String else { return }
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
