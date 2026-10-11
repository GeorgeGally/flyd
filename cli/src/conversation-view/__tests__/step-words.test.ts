import { describe, expect, it } from "vitest";
import { commandStep, fewWords, fileStep } from "../step-words.js";

const G = "G=/Users/george/Documents/good_neighbours; F=/Users/george/Documents/firstmate";
const MACHINERY = /[/$`|]|\b(?:bash|sed|grep|git|chrome|axi|firstmate|inbox|css)\b/i;

describe("a step in a few plain words", () => {
  it("reads what firstmate's undescribed commands do", () => {
    const steps: Array<[string, string | undefined]> = [
      [`${G}; cat >> $G/css/christmas-2026.css <<'EOF'\n.xm-tickets { width: 44rem; }\nEOF`, "Editing the styles"],
      [`${G}; sed -i '' "s/Bali/Asia/g" $G/index.html`, "Editing the page"],
      [`${G}; python3 - <<'EOF'\np='/Users/george/Documents/good_neighbours/index.html'; s=open(p).read(); open(p,'w').write(s)\nEOF`, "Editing the page"],
      [`export CHROME_DEVTOOLS_AXI_SESSION=fm-main; chrome-devtools-axi resize 390 844; chrome-devtools-axi screenshot --output /tmp/a.png`, "Taking screenshots"],
      [`chrome-devtools-axi eval "(()=>getComputedStyle(document.body).width)()"`, "Measuring the page"],
      [`${G}; git -C $G add -u && git -C $G commit -qm "Site map: white"`, "Saving the change"],
      [`${G}; bash $G/scripts/deploy-christmas.sh`, "Putting it live"],
      [`ssh -o BatchMode=yes me@goodneighboursmarket.com 'php -r "require \\"db.php\\";"'`, "Checking the live site"],
      [`${G}; grep -n "xm-tickets" $G/css/christmas-2026.css | head -30`, "Looking through the code"],
      [`${G}; ( cd $G && node vendor-apply/tests/interface_test.cjs )`, "Running the tests"],
      [`F=/Users/george/Documents/firstmate; sed -n '6,$p' $F/state/inbox/1791697890-Y0nABS.note`, "Reading your note"],
      [`FM_HOME=/Users/george/Documents/firstmate /Users/george/Documents/firstmate/bin/fm-wake-drain.sh`, undefined],
      [`F=/Users/george/Documents/firstmate; sed -n 1,40p $F/bin/fm-pr-merge.sh | grep -n "^#"`, undefined],
    ];
    for (const [command, step] of steps) expect(commandStep(command)).toBe(step);
  });

  it("names a file edit by what it changes, and a look at a screenshot or his note", () => {
    expect(fileStep("Edit", "/Users/george/site/css/main.css")).toBe("Editing the styles");
    expect(fileStep("Write", "/Users/george/site/js/remind.js")).toBe("Editing the code");
    expect(fileStep("Write", "/Users/george/.claude/projects/x/memory/a.md")).toBe("Saving it to memory");
    expect(fileStep("Read", "/private/tmp/scratchpad/m.png")).toBe("Looking at the screenshots");
    expect(fileStep("Read", "/Users/george/Documents/firstmate/state/inbox/1791722780-h1i26b.note")).toBe("Reading your note");
    expect(fileStep("Read", "/Users/george/site/index.html")).toBeUndefined();
  });

  it("keeps the opening clause, as something being done, in a few words", () => {
    expect(fewWords("Making the site map all white: removing the dark fade at the top")).toBe("Making the site map all white");
    expect(fewWords("Find ticket modal CSS")).toBe("Finding ticket modal styles");
    expect(fewWords("Centre copy+calendar pair; measure margins")).toBe("Centring copy+calendar pair");
    expect(fewWords("Enlarge ticket popup; screenshots")).toBe("Enlarging ticket popup");
    expect(fewWords("Set the hero height")).toBe("Setting the hero height");
    expect(fewWords("Block42 headline width")).toBe("Block42 headline width");
    expect(fewWords("Moving the remind me button next to the tickets button and the calendar").split(" ").length).toBeLessThanOrEqual(7);
    expect(fewWords('Building the "Remind me when the applications open" form')).toBe("Building the Remind me when the applications");
    expect(fewWords('Building the "Remind me" form')).toBe('Building the "Remind me" form');
    expect(fewWords("Checking https://example.com/a: the page")).toBe("Checking https://example.com/a");
  });

  it("never shows a command, a path or a tool", () => {
    for (const command of [`ls -la /Users/george/site`, `cat /Users/george/site/a.css`, `git -C /Users/george/site push`, `rsync -a /Users/george/site/ host:/www`]) {
      const step = commandStep(command);
      if (step) expect(step).not.toMatch(MACHINERY);
    }
  });
});
