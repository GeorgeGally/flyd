/**
 * The arguments every headless Chrome Flyd starts begins with. A throwaway profile with no keychain of its own
 * made macOS ask "Keychain Not Found" for every launch, hundreds of times during a test run; a mock keychain and
 * the basic password store keep Chrome away from the macOS keychain entirely.
 */
export const HEADLESS_CHROME_ARGS: readonly string[] = [
  "--headless=new",
  "--use-mock-keychain",
  "--password-store=basic",
  "--no-first-run",
  "--no-default-browser-check",
];
