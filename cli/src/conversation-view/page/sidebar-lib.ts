/**
 * The sidebar's content rules, as plain functions the page script carries and
 * the tests run on their own (see sidebar.test.ts). Kept as one string of
 * browser JavaScript, joined into the page script before the parts that use it,
 * so the page and the tests run exactly the same code.
 *
 * - The live line: one whole line of what is happening now, written to fit,
 *   never cut off with an ellipsis (a long one wraps rather than lose its end).
 * - The project shortcut: "/flyd" for the Flyd project, the same slug its
 *   thread is named by (project-threads.ts threadId).
 * - For this chat: what George is talking about, as a few plain terms, and the
 *   things the page already holds that match them.
 * - Pictures: shown only when the item says it is meant to be seen
 *   (`intentional`), never because a screenshot happens to exist.
 */
export const SIDEBAR_LIB = String.raw`
  function sideFlat(text) { return String(text == null ? "" : text).replace(/\s+/g, " ").trim(); }
  // One whole line of what is happening now: its first sentence or clause when that fits the room,
  // else the line whole. Never cut off: a line that arrived already cut ("Choose the...") loses the dangling end.
  function sideNowLine(text, room) {
    room = room || 90;
    var flat = sideFlat(text);
    var line = flat.replace(/(?:\s*(?:\.{3}|…))+$/, "");
    // A line that arrived already cut keeps only what it said whole: up to its last sentence or clause.
    if (line !== flat) {
      var whole = /^(.{12,})(?:[.!?:;—–]\s|\s[—–]\s)/.exec(line);
      if (whole) line = whole[1];
      else while (/\s(?:the|a|an|as|of|in|on|to|and|or|for|with|by|at)$/i.test(line)) line = line.replace(/[\s,;:–—-]*\s(?:the|a|an|as|of|in|on|to|and|or|for|with|by|at)$/i, "");
    }
    line = line.replace(/[\s,;:–—-]+$/, "");
    if (line.length <= room) return line;
    var sentence = new RegExp("^.{12," + room + "}?[.!?](?=\\s|$)").exec(line);
    if (sentence) return sentence[0];
    var clause = /^(.{24,}?)(?:[;:—–]\s|\s(?:so|because|which|while|but)\s|,\s(?:and|so|but)\s)/.exec(line);
    if (clause && clause[1].length <= room) return clause[1].replace(/[\s,]+$/, "");
    return line;
  }
  // The slug "/flyd" names a project by: its thread's own slug, so the shortcut and the thread agree.
  function sideSlug(name) {
    return sideFlat(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  // Each project with a thread as a shortcut: "/flyd" opens its thread. "All" and "Other" are not projects.
  function sideShortcuts(threads) {
    var seen = {};
    return (threads || []).filter(function (thread) {
      if (!thread || !thread.id || thread.id.indexOf("project:") !== 0) return false;
      var slug = thread.id.slice(8);
      if (!slug || slug === "all" || slug === "other" || seen[slug]) return false;
      seen[slug] = true;
      return true;
    }).map(function (thread) {
      return { name: thread.id.slice(8), project: thread.name || thread.id.slice(8), thread: thread.id };
    });
  }
  // The shortcut a message box holds when it is exactly one ("/flyd", give or take spaces), else null.
  function sideShortcutFor(typed, shortcuts) {
    var exact = /^\s*\/([a-z0-9-]+)\s*$/i.exec(String(typed || ""));
    if (!exact) return null;
    var slug = exact[1].toLowerCase();
    return (shortcuts || []).filter(function (one) { return one.name === slug; })[0] || null;
  }
  var SIDE_STOP = ("a an and are as at be been but by can could did do does doing done for from get got had has have how i i'd i'll i'm i've if in into is it it's its just let like look looks make me more my need no not now of off ok okay on one or our out over please really right same say see should so some still such than that that's the their them then there these they thing things think this those to too try up us use very want was way we well were what what's when where which while who why will with would yes yet you you're your sir flyd hey hi thanks thank morning tonight today tomorrow yesterday going work working bit lot also maybe whether worth").split(" ");
  // What he is talking about, as a few plain terms from his newest words: names first, then the longer words.
  function sideTerms(texts, most) {
    most = most || 3;
    var counts = {};
    var order = [];
    (texts || []).slice(-3).reverse().forEach(function (text, age) {
      var words = [];
      // A capital that only starts a sentence says nothing; one mid-sentence marks a name.
      sideFlat(text).split(/(?<=[.!?])\s+/).forEach(function (sentence) {
        (sentence.match(/[A-Za-z][A-Za-z0-9'’-]{2,}/g) || []).forEach(function (word, at) { words.push(at === 0 ? word.toLowerCase() : word); });
      });
      words.forEach(function (word) {
        var bare = word.replace(/['’]s$/i, "").replace(/['’-]+$/, "");
        var key = bare.toLowerCase();
        if (key.length < 3 || SIDE_STOP.indexOf(key) >= 0) return;
        if (!counts[key]) { counts[key] = { word: bare, score: 0, first: order.length }; order.push(key); }
        // Newer words count more; a name (capitalised mid-sentence) or a long word counts more again.
        counts[key].score += (3 - age) + (/^[A-Z]/.test(bare) ? 2 : 0) + (bare.length >= 7 ? 1 : 0);
      });
    });
    var picked = [];
    order.map(function (key) { return counts[key]; })
      .sort(function (a, b) { return b.score - a.score || a.first - b.first; })
      .forEach(function (one) {
        // One word for one thing: "pixel" and "pixelating" are the same term.
        var key = one.word.toLowerCase();
        var same = picked.some(function (had) { var h = had.toLowerCase(); return h.indexOf(key.slice(0, 5)) === 0 || key.indexOf(h.slice(0, 5)) === 0; });
        if (!same && picked.length < most) picked.push(one.word);
      });
    return picked;
  }
  // The things the page already holds that match what he is talking about: best match first, then newest.
  function sideMatches(items, terms, most) {
    most = most || 4;
    var lower = (terms || []).map(function (term) { return term.toLowerCase(); });
    if (!lower.length) return [];
    return (items || []).map(function (item, index) {
      var said = (sideFlat(item.title) + " " + sideFlat(item.text) + " " + sideFlat(item.by)).toLowerCase();
      var score = lower.filter(function (term) { return new RegExp("\\b" + term.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")).test(said); }).length;
      return { item: item, score: score, index: index, at: Date.parse(item.at || "") || 0 };
    }).filter(function (one) { return one.score > 0 && sideFlat(one.item.title); })
      .sort(function (a, b) { return b.score - a.score || b.at - a.at || a.index - b.index; })
      .slice(0, most).map(function (one) { return one.item; });
  }
  // A picture is shown only when the item is meant to be seen: never because a screenshot happens to exist.
  function sidePicture(item) {
    return item && item.intentional === true && typeof item.image === "string" && item.image ? item.image : "";
  }
  // What the small dot says when pointed at: where the work stands and since when, in plain words.
  function sideDotDetail(job, when) {
    var state = sideFlat(job && job.state) || "Under way";
    return state + (job && job.project ? " in " + sideFlat(job.project) : "") + (when ? ", " + when : "");
  }
`;
