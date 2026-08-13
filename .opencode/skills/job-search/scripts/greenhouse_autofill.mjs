#!/usr/bin/env node
import fs from "node:fs";

const args = parseArgs(process.argv.slice(2));
if (!args.packet) usage("Missing --packet");
const packet = JSON.parse(fs.readFileSync(args.packet, "utf-8"));
const cdpPort = Number(args["cdp-port"] || 9223);
const screenshotPath = args.screenshot || "application_autofill.png";

async function main() {
  const page = await ensurePage(packet.job.url);
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  try {
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.bringToFront");
    await waitForForm(cdp);
    await attachResume(cdp, packet.candidate.resume_path);
    const result = await fillForm(cdp, packet);
    await selectKnownDropdowns(cdp, packet);
    const state = await inspectState(cdp);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, 30000);
    fs.writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"));
    console.log(
      JSON.stringify(
        {
          ok: true,
          submitted: false,
          screenshot: screenshotPath,
          filled: result.filled,
          resumeAttached: state.resumeAttached,
          attachedFiles: state.attachedFiles,
          emptyRequired: state.emptyRequired,
          reviewRequired: true,
        },
        null,
        2
      )
    );
  } finally {
    cdp.close();
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    parsed[key.slice(2)] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : "true";
  }
  return parsed;
}

function usage(message) {
  console.error(message);
  console.error("Usage: node greenhouse_autofill.mjs --packet application_packet.json --cdp-port 9223 --screenshot out.png");
  process.exit(2);
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

async function ensurePage(url) {
  const pages = await getJson(`http://127.0.0.1:${cdpPort}/json`);
  const existing = pages.find((item) => item.type === "page" && item.url === url);
  if (existing) return existing;
  return getJson(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    };
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  close() {
    this.ws.close();
  }
}

async function waitForForm(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await cdp.send("Runtime.evaluate", {
      expression: "document.readyState !== 'loading' && !!document.querySelector('input, textarea, form')",
      returnByValue: true,
    });
    if (ready.result.value) return;
    await sleep(250);
  }
  throw new Error("Application form did not load.");
}

async function attachResume(cdp, resumePath) {
  if (!resumePath) return;
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      function norm(text) { return String(text || "").replace(/\\s+/g, " ").trim().toLowerCase(); }
      function context(el) {
        const parts = [el.id, el.name, el.getAttribute("aria-label")];
        for (const label of Array.from(el.labels || [])) parts.push(label.innerText || label.textContent);
        for (let node = el.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
          const text = norm(node.innerText || node.textContent);
          if (text && text.length <= 260) parts.push(text);
        }
        return norm(parts.filter(Boolean).join(" "));
      }
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      for (const input of inputs) {
        if (/resume|cv|curriculum/.test(context(input)) || input.id === "_systemfield_resume") {
          input.setAttribute("data-job-autofill-resume", "1");
        }
      }
      if (!document.querySelector('input[type="file"][data-job-autofill-resume="1"]') && inputs[0]) {
        inputs[0].setAttribute("data-job-autofill-resume", "1");
      }
    })()`,
    returnByValue: true,
  });
  const documentNode = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const fileNodes = await cdp.send("DOM.querySelectorAll", {
    nodeId: documentNode.root.nodeId,
    selector: 'input[type="file"][data-job-autofill-resume="1"]',
  });
  for (const nodeId of fileNodes.nodeIds || []) {
    await cdp.send("DOM.setFileInputFiles", { nodeId, files: [resumePath] });
  }
  await sleep(800);
}

async function fillForm(cdp, packet) {
  const expression = `(() => {
    const packet = ${JSON.stringify(packet)};
    const filled = [];
    function norm(text) { return String(text || "").replace(/\\s+/g, " ").trim(); }
    function lower(text) { return norm(text).toLowerCase(); }
    function labelText(el) {
      const parts = [el.id, el.name, el.placeholder, el.getAttribute("aria-label")];
      for (const label of Array.from(el.labels || [])) parts.push(label.innerText || label.textContent);
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        for (const id of labelledBy.split(/\\s+/)) {
          const node = document.getElementById(id);
          if (node) parts.push(node.innerText || node.textContent);
        }
      }
      for (let node = el.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
        const text = norm(node.innerText || node.textContent);
        if (text && text.length <= 700) parts.push(text);
      }
      return lower(parts.filter(Boolean).join(" "));
    }
    function fieldByLabel(fragments, selector = "input, textarea") {
      const wanted = fragments.map(lower);
      return Array.from(document.querySelectorAll(selector)).find((el) => {
        const type = lower(el.getAttribute("type") || "");
        if (["hidden", "file", "button", "submit", "reset", "checkbox", "radio"].includes(type)) return false;
        const text = labelText(el);
        return wanted.some((fragment) => fragment && text.includes(fragment));
      });
    }
    function setNativeValue(el, value) {
      if (!el || value === undefined || value === null || value === "") return false;
      el.scrollIntoView({ block: "center" });
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    }
    function fill(name, fragments, value, selector) {
      const el = fieldByLabel(fragments, selector);
      if (setNativeValue(el, value)) filled.push(name);
    }
    const c = packet.candidate || {};
    const links = c.links || {};
    const p = packet.preferences || {};
    const r = packet.responses || {};
    fill("first_name", ["first name"], c.first_name);
    fill("last_name", ["last name"], c.last_name);
    fill("email", ["email"], c.email);
    fill("phone", ["phone"], c.phone);
    fill("website", ["website", "personal site"], links.website || links.google_scholar || links.github);
    fill("linkedin", ["linkedin"], links.linkedin);
    fill("github", ["github"], links.github);
    fill("google_scholar", ["google scholar", "publications"], links.google_scholar);
    fill("start_date", ["earliest", "start"], p.start_date);
    fill("timeline", ["timeline", "deadline"], r.timeline);
    fill("planned_work_address", ["address from which", "planned work address"], r.planned_work_address);
    fill("why_company_role", ["why", "want to work"], r.why_company_role, "textarea");
    fill("additional_information", ["additional information", "cover letter", "anything else"], r.additional_information, "textarea");
    return { filled };
  })()`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, 30000);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value || { filled: [] };
}

async function selectKnownDropdowns(cdp, packet) {
  const p = packet.preferences || {};
  const sid = packet.self_identification || {};
  const candidates = [
    [["country"], p.phone_country],
    [["open to working in-person", "office"], p.office_25_percent],
    [["ai policy"], p.ai_policy],
    [["require visa sponsorship"], p.needs_sponsorship],
    [["future require employment visa sponsorship"], p.needs_sponsorship],
    [["open to relocation"], p.relocation],
    [["interviewed", "before"], p.interviewed_before],
    [["gender"], sid.gender],
    [["hispanic"], sid.hispanic_latino],
    [["race"], sid.race],
    [["veteran"], sid.veteran],
    [["disability"], sid.disability],
  ];
  for (const [fragments, value] of candidates) {
    if (value) await chooseDropdownByLabel(cdp, fragments, value);
  }
}

async function chooseDropdownByLabel(cdp, fragments, value) {
  await key(cdp, "Escape", "Escape");
  const box = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const fragments = ${JSON.stringify(fragments)}.map((item) => String(item).toLowerCase());
      function norm(text) { return String(text || "").replace(/\\s+/g, " ").trim().toLowerCase(); }
      function labelText(el) {
        const parts = [el.id, el.name, el.getAttribute("aria-label")];
        for (const label of Array.from(el.labels || [])) parts.push(label.innerText || label.textContent);
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          for (const id of labelledBy.split(/\\s+/)) {
            const node = document.getElementById(id);
            if (node) parts.push(node.innerText || node.textContent);
          }
        }
        for (let node = el.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
          const text = norm(node.innerText || node.textContent);
          if (text && text.length <= 700) parts.push(text);
        }
        return norm(parts.filter(Boolean).join(" "));
      }
      const el = Array.from(document.querySelectorAll('input[role="combobox"], input.select__input, input'))
        .find((input) => fragments.some((fragment) => fragment && labelText(input).includes(fragment)));
      if (!el) return null;
      const shell = el.closest(".select") || el.closest(".select-shell") || el.parentElement;
      const control = shell && (shell.querySelector(".select__control") || shell);
      if (!control) return null;
      control.scrollIntoView({ block: "center" });
      const rect = control.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
    returnByValue: true,
  });
  if (!box.result.value) return false;
  await click(cdp, box.result.value.x, box.result.value.y);
  await sleep(450);
  const option = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const wanted = String(${JSON.stringify(value)} || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const options = Array.from(document.querySelectorAll('[role="option"], .select__option, [id^="react-select-"][id*="-option-"]'))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            text: String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim(),
            visible: Boolean(rect.width || rect.height || el.getClientRects().length),
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        })
        .filter((item) => item.visible && item.text);
      return options.find((item) => {
        const text = item.text.toLowerCase();
        return text === wanted || text.includes(wanted) || wanted.includes(text);
      }) || null;
    })()`,
    returnByValue: true,
  });
  if (!option.result.value) {
    await key(cdp, "Escape", "Escape");
    return false;
  }
  await click(cdp, option.result.value.x, option.result.value.y);
  await sleep(250);
  return true;
}

async function inspectState(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      function norm(text) { return String(text || "").replace(/\\s+/g, " ").trim(); }
      function visible(el) {
        const rect = el.getBoundingClientRect();
        return Boolean(rect.width || rect.height || el.getClientRects().length);
      }
      function labelText(el) {
        const parts = [];
        for (const label of Array.from(el.labels || [])) parts.push(label.innerText || label.textContent);
        for (let node = el.parentElement, depth = 0; node && depth < 2; node = node.parentElement, depth += 1) {
          const text = norm(node.innerText || node.textContent);
          if (text && text.length <= 260) parts.push(text);
        }
        return norm(parts.join(" | "));
      }
      function display(el) {
        const shell = el.closest(".select-shell") || el.closest(".select") || el.parentElement;
        const single = shell && shell.querySelector(".select__single-value");
        return norm(single ? single.innerText || single.textContent : (el.value || (shell ? shell.innerText || shell.textContent : "")));
      }
      const emptyRequired = Array.from(document.querySelectorAll("input, textarea")).map((el) => {
        const label = labelText(el);
        const required = visible(el) && /\\*/.test((label.split("|")[0] || ""));
        const value = display(el);
        return { id: el.id || "", label: label.slice(0, 180), value: value.slice(0, 120), required };
      }).filter((item) => item.required && item.id && (!item.value || item.value === "Select..."));
      const attachedFiles = Array.from(document.querySelectorAll('input[type="file"]'))
        .flatMap((input) => Array.from(input.files || []).map((file) => file.name))
        .filter(Boolean);
      return {
        resumeAttached: attachedFiles.length > 0,
        attachedFiles,
        emptyRequired,
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function click(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function key(cdp, keyName, code = keyName) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, code });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error.message || error), submitted: false }, null, 2));
  process.exit(1);
});
