import XCTest
@testable import FlydMacAdapter

final class AugmentPlacementPolicyTests: XCTestCase {

    let visibleFrame = NSRect(x: 0, y: 0, width: 2560, height: 1440)

    func testBelowElementPlacement() {
        let anchor = NSRect(x: 200, y: 800, width: 600, height: 400)
        let placement = AugmentPlacementPolicy.resolve(
            placement: "below_element",
            anchorRect: anchor,
            selectionRect: nil,
            screenVisibleFrame: visibleFrame
        )

        switch placement {
        case .belowElement(let rect):
            XCTAssertEqual(rect, anchor)
        default:
            XCTFail("Expected belowElement placement")
        }
    }

    func testCursorPlacementWithNoAnchor() {
        let cursorPoint = NSPoint(x: 500, y: 500)
        let placement = AugmentPlacementPolicy.resolve(
            placement: "cursor",
            anchorRect: nil,
            selectionRect: nil,
            screenVisibleFrame: visibleFrame,
            cursorPoint: cursorPoint
        )

        switch placement {
        case .besideCursor:
            break
        default:
            XCTFail("Expected besideCursor placement")
        }
    }

    func testBesideSelectionFallsBackToCursorWhenNoSelection() {
        let placement = AugmentPlacementPolicy.resolve(
            placement: "beside_selection",
            anchorRect: nil,
            selectionRect: nil,
            screenVisibleFrame: visibleFrame
        )

        switch placement {
        case .besideCursor:
            break
        default:
            XCTFail("Expected besideCursor fallback")
        }
    }

    func testAnchorRectClampedToScreenBounds() {
        let placement = AugmentPlacementPolicy.Placement.besideCursor(NSPoint(x: 2580, y: 1500))
        let panelSize = NSSize(width: 400, height: 300)
        let rect = AugmentPlacementPolicy.computeAnchorRect(
            from: placement,
            panelSize: panelSize,
            screenVisibleFrame: visibleFrame
        )

        XCTAssertGreaterThanOrEqual(rect.origin.x, 0)
        XCTAssertLessThanOrEqual(rect.maxX, 2560)
        XCTAssertGreaterThanOrEqual(rect.origin.y, 0)
        XCTAssertLessThanOrEqual(rect.maxY, 1440)
    }

    func testCenteredPlacement() {
        let placement = AugmentPlacementPolicy.Placement.centered
        let panelSize = NSSize(width: 400, height: 300)
        let rect = AugmentPlacementPolicy.computeAnchorRect(
            from: placement,
            panelSize: panelSize,
            screenVisibleFrame: visibleFrame
        )

        XCTAssertEqual(rect.origin.x, 2560 / 2 - 400 / 2, accuracy: 1)
        XCTAssertEqual(rect.origin.y, 1440 / 2 - 300 / 2, accuracy: 1)
    }

    func testBelowElementClampedToTopEdge() {
        let anchor = NSRect(x: 200, y: 20, width: 600, height: 40)
        let placement = AugmentPlacementPolicy.resolve(
            placement: "below_element",
            anchorRect: anchor,
            selectionRect: nil,
            screenVisibleFrame: visibleFrame
        )

        let panelSize = NSSize(width: 400, height: 300)
        let rect = AugmentPlacementPolicy.computeAnchorRect(
            from: placement,
            panelSize: panelSize,
            screenVisibleFrame: visibleFrame
        )

        XCTAssertGreaterThanOrEqual(rect.minY, 0)
    }

    func testPanelPlacementFallsBackToCentered() {
        let placement = AugmentPlacementPolicy.resolve(
            placement: "panel",
            anchorRect: nil,
            selectionRect: nil,
            screenVisibleFrame: visibleFrame
        )

        switch placement {
        case .centered:
            break
        default:
            XCTFail("Expected centered fallback")
        }
    }
}
