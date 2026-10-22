import XCTest

final class AnvayaUITests: XCTestCase {
  @MainActor func testAccessibleRegistrationControls() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.textFields["auth.destination"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["auth.start"].exists)
    XCTAssertFalse(app.buttons["auth.start"].isEnabled)
    app.textFields["auth.destination"].tap()
    app.textFields["auth.destination"].typeText("review@example.invalid")
    XCTAssertTrue(app.buttons["auth.start"].isEnabled)
  }
}
