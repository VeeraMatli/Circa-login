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
  @MainActor func testInvalidEmailShowsVisibleError() {
    let app = XCUIApplication()
    app.launch()
    let destination = app.textFields["auth.destination"]
    XCTAssertTrue(destination.waitForExistence(timeout: 10))
    destination.tap()
    destination.typeText("invalid-email")
    app.buttons["auth.start"].tap()
    let alert = app.alerts["Unable to continue"]
    XCTAssertTrue(alert.waitForExistence(timeout: 5))
    XCTAssertTrue(alert.staticTexts["Enter a valid email address to continue."].exists)
    alert.buttons["OK"].tap()
    XCTAssertTrue(app.buttons["auth.start"].isEnabled)
  }
  @MainActor func testSwitchingMethodsClearsDestinationAndError() {
    let app = XCUIApplication()
    app.launch()
    let destination = app.textFields["auth.destination"]
    XCTAssertTrue(destination.waitForExistence(timeout: 10))
    destination.tap()
    destination.typeText("invalid-email")
    app.buttons["auth.start"].tap()
    let alert = app.alerts["Unable to continue"]
    XCTAssertTrue(alert.waitForExistence(timeout: 5))
    alert.buttons["OK"].tap()
    app.segmentedControls.buttons["Phone"].tap()
    XCTAssertEqual(destination.value as? String, "+1 555 123 4567")
    XCTAssertFalse(app.buttons["auth.start"].isEnabled)
    XCTAssertFalse(app.staticTexts["Enter a valid email address to continue."].exists)
    destination.tap()
    destination.typeText("+14155552671")
    app.segmentedControls.buttons["Email"].tap()
    XCTAssertEqual(destination.value as? String, "Your email address")
    XCTAssertFalse(app.buttons["auth.start"].isEnabled)
  }
}
