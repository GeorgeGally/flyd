import AppKit

/// Pure-function placement policy for augment panels.
/// Resolves where to position augment cards based on the diagnosed region,
/// cursor position, selection bounds, and display geometry.
/// All functions are testable without live AppKit state.
struct AugmentPlacementPolicy {

    enum Placement {
        case besideCursor(NSPoint)
        case belowElement(NSRect)
        case panel(NSPoint)
        case centered
    }

    static func resolve(
        placement: String,
        anchorRect: NSRect?,
        selectionRect: NSRect?,
        screenVisibleFrame: NSRect,
        cursorPoint: NSPoint = NSEvent.mouseLocation
    ) -> Placement {
        switch placement {
        case "beside_selection":
            if let rect = selectionRect, !NSIsEmptyRect(rect) {
                return .besideCursor(NSPoint(x: rect.maxX + 8, y: rect.midY))
            }
            if let rect = anchorRect, !NSIsEmptyRect(rect) {
                return .belowElement(rect)
            }
            return .besideCursor(cursorPoint)

        case "below_element":
            if let rect = anchorRect, !NSIsEmptyRect(rect) {
                return .belowElement(rect)
            }
            return .besideCursor(cursorPoint)

        case "panel":
            if let rect = anchorRect, !NSIsEmptyRect(rect) {
                return .panel(NSPoint(x: rect.midX, y: rect.midY))
            }
            return .centered

        case "cursor":
            return .besideCursor(cursorPoint)

        default:
            return .besideCursor(cursorPoint)
        }
    }

    static func computeAnchorRect(
        from placement: Placement,
        panelSize: NSSize,
        screenVisibleFrame: NSRect
    ) -> NSRect {
        switch placement {
        case .besideCursor(let point):
            var origin = NSPoint(x: point.x + 16, y: point.y - panelSize.height)
            origin = clampToScreen(origin: origin, size: panelSize, visibleFrame: screenVisibleFrame)
            return NSRect(origin: origin, size: panelSize)

        case .belowElement(let rect):
            var origin = NSPoint(x: rect.minX, y: rect.minY - panelSize.height - 8)
            origin = clampToScreen(origin: origin, size: panelSize, visibleFrame: screenVisibleFrame)
            return NSRect(origin: origin, size: panelSize)

        case .panel(let point):
            var origin = NSPoint(x: point.x - panelSize.width / 2, y: point.y - panelSize.height / 2)
            origin = clampToScreen(origin: origin, size: panelSize, visibleFrame: screenVisibleFrame)
            return NSRect(origin: origin, size: panelSize)

        case .centered:
            let origin = NSPoint(
                x: screenVisibleFrame.midX - panelSize.width / 2,
                y: screenVisibleFrame.midY - panelSize.height / 2
            )
            return NSRect(origin: origin, size: panelSize)
        }
    }

    private static func clampToScreen(origin: NSPoint, size: NSSize, visibleFrame: NSRect) -> NSPoint {
        var clamped = origin

        if clamped.x < visibleFrame.minX {
            clamped.x = visibleFrame.minX + 16
        }
        if clamped.x + size.width > visibleFrame.maxX {
            clamped.x = visibleFrame.maxX - size.width - 16
        }

        if clamped.y < visibleFrame.minY {
            clamped.y = visibleFrame.minY + 16
        }
        if clamped.y + size.height > visibleFrame.maxY {
            clamped.y = visibleFrame.maxY - size.height - 16
        }

        return clamped
    }
}
