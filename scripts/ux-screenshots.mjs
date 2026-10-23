// Full-page screenshots of the three main screens with real device emulation
// (Chrome DevTools Protocol over Node's built-in WebSocket; no extra deps).
//   node scripts/ux-screenshots.mjs <base-url> <output-dir>
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3001";
const OUT = process.argv[3] ?? "docs/screenshots/current";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGES = [["overview", "/"], ["recommendations", "/recommendations"], ["purchase-orders", "/purchase-orders"]];
const SIZES = [["desktop", 1440, false], ["tablet", 768, true], ["mobile", 390, true]];

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "ux-shots-"));
const port = 9333;
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => undefined);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Page.enable");

  for (const [name, path] of PAGES) {
    for (const [label, width, mobile] of SIZES) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
      await send("Page.navigate", { url: BASE + path });
      await sleep(3500);
      const { result } = await send("Runtime.evaluate", {
        expression: "JSON.stringify({h: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth})",
        returnByValue: true,
      });
      const { h, overflow } = JSON.parse(result.result.value);
      await send("Emulation.setDeviceMetricsOverride", { width, height: Math.min(h, 4000), deviceScaleFactor: 1, mobile });
      await sleep(300);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = join(OUT, `${name}-${label}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, "base64"));
      console.log(`✓ ${file}${overflow ? "  ⚠ horizontal overflow" : ""}`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
