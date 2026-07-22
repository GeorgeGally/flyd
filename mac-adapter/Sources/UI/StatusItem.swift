import AppKit

final class StatusItem {
    private var statusItem: NSStatusItem?
    private var dotView: StatusDotView?

    func start() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = statusItem?.button else { return }

        let view = StatusDotView(frame: NSRect(x: 0, y: 0, width: 18, height: 18))
        dotView = view
        button.addSubview(view)
        view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            view.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            view.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            view.widthAnchor.constraint(equalToConstant: 8),
            view.heightAnchor.constraint(equalToConstant: 8),
        ])

        updateColor(for: FlydState.shared.mode)

        NotificationCenter.default.addObserver(
            forName: .flydModeDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.updateColor(for: FlydState.shared.mode)
        }
    }

    private func updateColor(for mode: FlydMode) {
        var color: NSColor
        switch mode {
        case .present:
            color = .lightGray
        case .invoked:
            color = .systemBlue
        }

        if FlydState.shared.phase == .cancelled {
            color = .systemRed
        }

        dotView?.color = color
    }
}

private final class StatusDotView: NSView {
    var color: NSColor = .lightGray {
        didSet { needsDisplay = true }
    }

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        let path = NSBezierPath(ovalIn: bounds)
        path.fill()
    }
}
