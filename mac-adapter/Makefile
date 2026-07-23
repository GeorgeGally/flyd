APP_NAME = FlydMacAdapter
BUNDLE_NAME = Flyd.app
INSTALL_DIR = $(HOME)/Applications
INSTALLED_APP = $(INSTALL_DIR)/$(BUNDLE_NAME)
BUILD_DIR = .build
APP_DIR = $(BUILD_DIR)/$(BUNDLE_NAME)
EXECUTABLE = $(BUILD_DIR)/release/$(APP_NAME)

.PHONY: build bundle run install clean

build:
	swift build -c release

bundle: build
	mkdir -p "$(APP_DIR)/Contents/MacOS"
	mkdir -p "$(APP_DIR)/Contents/Resources"
	cp "$(EXECUTABLE)" "$(APP_DIR)/Contents/MacOS/$(APP_NAME)"
	cp Resources/Info.plist "$(APP_DIR)/Contents/Info.plist"

install: bundle
	mkdir -p "$(INSTALL_DIR)"
	rm -rf "$(INSTALLED_APP)"
	cp -R "$(APP_DIR)" "$(INSTALLED_APP)"
	@echo "Installed to $(INSTALLED_APP)"

run: install
	open "$(INSTALLED_APP)"

clean:
	rm -rf "$(BUILD_DIR)"
	swift package clean
