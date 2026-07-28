APP_NAME = FlydMacAdapter
BUNDLE_NAME = Flyd.app
INSTALL_DIR = $(HOME)/Applications
INSTALLED_APP = $(INSTALL_DIR)/$(BUNDLE_NAME)
BUILD_DIR = .build
APP_DIR = $(BUILD_DIR)/$(BUNDLE_NAME)
EXECUTABLE = $(BUILD_DIR)/release/$(APP_NAME)
REPO_ROOT = $(abspath $(CURDIR)/..)
FLYD_CODESIGN_KEYCHAIN = $(HOME)/Library/Keychains/flyd-local-signing.keychain-db
FLYD_CODESIGN_KEYCHAIN_PASSWORD ?= flyd-local-signing
FLYD_CODESIGN_IDENTITY ?= $(shell /usr/bin/security find-identity -v -p codesigning 2>/dev/null | /usr/bin/awk '/Flyd Local Development/ { print $$2; exit }')

.PHONY: build bundle run install clean

build:
	swift build -c release

bundle: build
	mkdir -p "$(APP_DIR)/Contents/MacOS"
	mkdir -p "$(APP_DIR)/Contents/Resources"
	cp "$(EXECUTABLE)" "$(APP_DIR)/Contents/MacOS/$(APP_NAME)"
	cp Resources/Info.plist "$(APP_DIR)/Contents/Info.plist"
	/usr/libexec/PlistBuddy -c "Add :FlydRepoRoot string $(REPO_ROOT)" "$(APP_DIR)/Contents/Info.plist" 2>/dev/null || \
		/usr/libexec/PlistBuddy -c "Set :FlydRepoRoot $(REPO_ROOT)" "$(APP_DIR)/Contents/Info.plist"
	@if [ -n "$(FLYD_CODESIGN_IDENTITY)" ]; then \
		/usr/bin/security unlock-keychain -p "$(FLYD_CODESIGN_KEYCHAIN_PASSWORD)" "$(FLYD_CODESIGN_KEYCHAIN)"; \
		/usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k "$(FLYD_CODESIGN_KEYCHAIN_PASSWORD)" "$(FLYD_CODESIGN_KEYCHAIN)" >/dev/null 2>&1 || true; \
		codesign --force --deep --sign "$(FLYD_CODESIGN_IDENTITY)" "$(APP_DIR)"; \
	else \
		codesign --force --deep --sign - "$(APP_DIR)"; \
	fi

install: bundle
	mkdir -p "$(INSTALL_DIR)"
	-pkill -9 -x "$(APP_NAME)" 2>/dev/null
	@while pgrep -x "$(APP_NAME)" >/dev/null 2>&1; do sleep 0.2; done
	-lsof -ti tcp:4815,4816,4817 | xargs -r kill -9 2>/dev/null
	rm -rf "$(INSTALLED_APP)"
	cp -R "$(APP_DIR)" "$(INSTALLED_APP)"
	@echo "Installed to $(INSTALLED_APP)"

run: install
	open -n "$(INSTALLED_APP)"

clean:
	rm -rf "$(BUILD_DIR)"
	swift package clean
