APP_NAME = FlydMacAdapter
BUNDLE_NAME = Flyd.app
BUILD_DIR = .build
APP_DIR = $(BUILD_DIR)/$(BUNDLE_NAME)
EXECUTABLE = $(BUILD_DIR)/release/$(APP_NAME)

.PHONY: build bundle run clean

build:
	swift build -c release

bundle: build
	mkdir -p "$(APP_DIR)/Contents/MacOS"
	mkdir -p "$(APP_DIR)/Contents/Resources"
	cp "$(EXECUTABLE)" "$(APP_DIR)/Contents/MacOS/$(APP_NAME)"
	cp Resources/Info.plist "$(APP_DIR)/Contents/Info.plist"

run: bundle
	open "$(APP_DIR)"

clean:
	rm -rf "$(BUILD_DIR)"
	swift package clean
