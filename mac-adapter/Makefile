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

.PHONY: build bundle run install clean test-work-intelligence check-foundry-gate

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

test-work-intelligence:
	@echo "=== Running Swift adapter tests ==="
	swift test
	@echo ""
	@echo "=== Running TypeScript Core tests ==="
	cd ../cli && npm test
	@echo ""
	@echo "=== Combined test result: PASSED ==="

check-foundry-gate:
	@echo "=== Checking Core health ==="
	@CORE_HEALTHY=0; \
	if curl -sf http://localhost:4815/health > /dev/null 2>&1; then \
		echo "Port 4815 (/health): OK"; \
		CORE_HEALTHY=$$((CORE_HEALTHY + 1)); \
	else \
		echo "Port 4815 (/health): NOT RESPONDING"; \
	fi; \
	if lsof -i tcp:4816 | grep -q LISTEN 2>/dev/null; then \
		echo "Port 4816 (transcription): OK"; \
		CORE_HEALTHY=$$((CORE_HEALTHY + 1)); \
	else \
		echo "Port 4816 (transcription): NOT LISTENING"; \
	fi; \
	if lsof -i tcp:4817 | grep -q LISTEN 2>/dev/null; then \
		echo "Port 4817 (realtime): OK"; \
		CORE_HEALTHY=$$((CORE_HEALTHY + 1)); \
	else \
		echo "Port 4817 (realtime): NOT LISTENING"; \
	fi; \
	echo ""; \
	echo "=== Running release acceptance tests ==="; \
	cd ../cli && npm test -- src/__tests__/work-intelligence-release-acceptance.test.ts; \
	TEST_EXIT=$$?; \
	echo ""; \
	if [ $$CORE_HEALTHY -eq 3 ] && [ $$TEST_EXIT -eq 0 ]; then \
		echo "=== Foundry Gate: ready ==="; \
	else \
		if [ $$CORE_HEALTHY -ne 3 ]; then \
			echo "Foundry Gate issue: Core not fully healthy ($$CORE_HEALTHY/3 ports)"; \
		fi; \
		if [ $$TEST_EXIT -ne 0 ]; then \
			echo "Foundry Gate issue: release acceptance tests failed"; \
		fi; \
		echo "=== Foundry Gate: not ready ==="; \
	fi
