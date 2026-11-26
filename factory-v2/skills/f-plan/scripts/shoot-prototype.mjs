#!/usr/bin/env node
// Captures prototype screenshots at 1440px and 390px (light & dark) via Playwright.
// Works with either an http:// URL (live /_preview route) or a local file:// HTML prototype.
import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function shootPrototype(target, outDir, cwd = process.cwd()) {
  const url = /^https?:\/\/|^file:\/\//.test(target) ? target : `file://${resolve(target)}`;
  const dest = resolve(outDir);
  mkdirSync(dest, { recursive: true });

  const script = `
    const { chromium } = require("playwright");
    const path = require("path");
    const fs = require("fs");
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const results = [];
      const shots = [
        { name: "preview-1440-light.png", width: 1440, height: 900, scheme: "light" },
        { name: "preview-1440-dark.png", width: 1440, height: 900, scheme: "dark" },
        { name: "preview-390-light.png", width: 390, height: 844, scheme: "light" },
        { name: "preview-390-dark.png", width: 390, height: 844, scheme: "dark" },
      ];
      for (const s of shots) {
        const ctx = await browser.newContext({
          viewport: { width: s.width, height: s.height },
          colorScheme: s.scheme,
        });
        const page = await ctx.newPage();
        await page.goto(process.env.PROTO_URL, { waitUntil: "networkidle", timeout: 25000 });
        const ov = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        const out = path.join(process.env.PROTO_OUT, s.name);
        await page.screenshot({ path: out, fullPage: true });
        results.push({ file: out, overflow: ov.scrollWidth > ov.clientWidth + 1, ...ov });
        await ctx.close();
      }
      await browser.close();
      console.log(JSON.stringify({ ok: true, shots: results }, null, 2));
    })().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
  `;

  const res = spawnSync(process.execPath, ["-e", script], {
    cwd,
    env: { ...process.env, PROTO_URL: url, PROTO_OUT: dest },
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`shoot-prototype failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const target = process.argv[2];
  const outDir = process.argv[3] || ".";
  if (!target) {
    console.error("Usage: node shoot-prototype.mjs <url-or-html-file> <out-dir>");
    process.exit(2);
  }
  console.log(JSON.stringify(shootPrototype(target, outDir), null, 2));
}
