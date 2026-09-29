// Which style dictated text is cleaned into, chosen from where it will land.
// Local table, no network. Browsers say nothing through their bundle id, so
// their front window title picks a family instead (title only: no URL, no
// Automation permission).

export type DictationProfile = "code" | "chat" | "prose";

export interface DictationTarget {
  bundleId: string;
  windowTitle?: string;
}

const APP_PROFILES: Record<string, DictationProfile> = {
  "com.mitchellh.ghostty": "code",
  "com.googlecode.iterm2": "code",
  "com.apple.Terminal": "code",
  "dev.warp.Warp-Stable": "code",
  "com.github.wez.wezterm": "code",
  "net.kovidgoyal.kitty": "code",
  "com.microsoft.VSCode": "code",
  "com.todesktop.230313mzl4w4u92": "code",
  "dev.zed.Zed": "code",
  "com.apple.dt.Xcode": "code",
  "com.tinyspeck.slackmacgap": "chat",
  "com.apple.MobileSMS": "chat",
  "net.whatsapp.WhatsApp": "chat",
  "ru.keepcoder.Telegram": "chat",
  "com.hnc.Discord": "chat",
};

const BROWSERS = new Set([
  "com.apple.Safari",
  "com.google.Chrome",
  "company.thebrowser.Browser",
  "com.brave.Browser",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
]);

// First match wins. Assistants come first: text typed there is a prompt, so it
// gets the never-reword code style and is never answered.
const TITLE_FAMILIES: Array<{ title: RegExp; profile: DictationProfile }> = [
  { title: /\b(ChatGPT|Claude|Gemini|Perplexity)\b/i, profile: "code" },
  { title: /\b(GitHub|GitLab)\b/i, profile: "code" },
  { title: /\b(Slack|WhatsApp|Messenger|Discord|LinkedIn)\b/i, profile: "chat" },
  { title: /\/ X$|\bon X\b/, profile: "chat" },
  { title: /\b(Gmail|Outlook|Mail)\b/i, profile: "prose" },
];

export function dictationProfile(target: DictationTarget): DictationProfile {
  const byApp = APP_PROFILES[target.bundleId];
  if (byApp) return byApp;
  if (BROWSERS.has(target.bundleId) && target.windowTitle) {
    const family = TITLE_FAMILIES.find(({ title }) => title.test(target.windowTitle!.trim()));
    if (family) return family.profile;
  }
  return "prose";
}
