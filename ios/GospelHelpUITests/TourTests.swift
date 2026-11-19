import XCTest

/// Drives the main flows end to end against the live API and keeps a
/// screenshot of each screen (attachments in the .xcresult). Set
/// GH_ORIENTATION=landscape, GH_THEME=dark, GH_ASK=1 to vary a run.
final class TourTests: XCTestCase {
    private var app: XCUIApplication!
    private var device = ""
    private var shot = 0

    override func setUp() async throws {
        continueAfterFailure = false
    }

    @MainActor
    func testTour() throws {
        let env = ProcessInfo.processInfo.environment
        if env["GH_ORIENTATION"] == "landscape" {
            XCUIDevice.shared.orientation = .landscapeLeft
        } else {
            XCUIDevice.shared.orientation = .portrait
        }
        app = XCUIApplication()
        app.launchArguments = ["-GHResetState", "-gs-theme", env["GH_THEME"] ?? "light"]
        app.launch()
        device = env["GH_NAME"] ?? "device"

        let field = app.textFields["searchField"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        capture("start")

        // Search
        field.tap()
        field.typeText("charity never faileth")
        app.buttons["searchSubmit"].tap()
        let count = app.staticTexts["resultCount"]
        XCTAssertTrue(count.waitForExistence(timeout: 60), "results never arrived")
        XCTAssertTrue(count.label.contains("results"))

        // Save the first two results.
        let bookmarks = app.buttons.matching(identifier: "bookmarkButton")
        XCTAssertTrue(bookmarks.firstMatch.waitForExistence(timeout: 5))
        bookmarks.element(boundBy: 0).tap()
        bookmarks.element(boundBy: 1).tap()
        capture("results")

        // Open a passage (a sheet on phones, the pane on wide screens).
        app.staticTexts.matching(identifier: "resultHeading").element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["Read"].waitForExistence(timeout: 5))
        let context = app.buttons["Read surrounding verses"]
        if context.waitForExistence(timeout: 3) {
            context.tap()
            sleep(3)
        }
        capture("passage")
        let close = app.buttons["Close"]
        if close.exists { close.tap() }

        // Ask (optional: each run uses one real question).
        tab("Ask")
        if env["GH_ASK"] == "1" {
            let ask = app.textViews["askField"].exists ? app.textViews["askField"] : app.textFields["askField"]
            XCTAssertTrue(ask.waitForExistence(timeout: 5))
            app.buttons["What do the scriptures teach about grace?"].tap()
            let disclaimer = app.staticTexts["Written by AI from the passages below. It can get things wrong, so read the sources."]
            XCTAssertTrue(disclaimer.waitForExistence(timeout: 90), "answer never finished")
            app.swipeUp()
            sleep(1)
            app.swipeDown()
            sleep(1)
        } else {
            XCTAssertTrue(app.staticTexts["Try asking"].waitForExistence(timeout: 5))
        }
        capture("ask")

        tab("Saved")
        XCTAssertTrue(app.staticTexts["2 passages · kept on this device"].waitForExistence(timeout: 5))
        capture("saved")

        tab("Settings")
        XCTAssertTrue(app.staticTexts["The library, by the numbers"].waitForExistence(timeout: 5))
        capture("settings")
        app.staticTexts["The library, by the numbers"].tap()
        sleep(6)
        capture("stats")
    }

    @MainActor
    private func tab(_ name: String) {
        // The tab bar, or the sidebar on wide screens.
        let button = app.tabBars.buttons[name].exists ? app.tabBars.buttons[name] : app.buttons[name].firstMatch
        button.tap()
        sleep(1)
    }

    @MainActor
    private func capture(_ name: String) {
        shot += 1
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = String(format: "%@-%02d-%@", device, shot, name)
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
