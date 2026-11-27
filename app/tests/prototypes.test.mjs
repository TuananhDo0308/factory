import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSandboxedPrototypeDocument,
  extractScreensFromHtml,
  normalizePrototypeManifest,
  splitAssistantPrototypeBlocks,
} from "../src/lib/prototypes.ts";

describe("sf-prototype block parser", () => {
  it("strips sf-prototype + sf-prototype-html blocks and pairs them cleanly", () => {
    const raw = [
      "Here is the first screen direction for your review.",
      "",
      "```sf-prototype",
      JSON.stringify({
        slug: "orders-export",
        title: "Orders Export",
        kind: "first_screen",
        binding: "flow",
        issueKeys: ["I1"],
        screens: [
          { id: "orders-list", title: "Orders list", criteria: ["C1"], shows: "Filter bar & table" },
          { id: "orders-empty", title: "Empty state", criteria: ["C2"], shows: "Clear filter CTA" },
        ],
        notShown: [{ criterion: "C5", why: "Server-side rate limit" }],
      }),
      "```",
      "",
      "```sf-prototype-html",
      `<section data-screen="orders-list"><h1>Orders</h1></section><section data-screen="orders-empty">Empty</section>`,
      "```",
      "",
      "Click through both states and let me know if you want changes.",
    ].join("\n");

    const parsed = splitAssistantPrototypeBlocks(raw);
    assert.equal(parsed.prototypeStreaming, false);
    assert.equal(
      parsed.prose,
      "Here is the first screen direction for your review.\n\nClick through both states and let me know if you want changes.",
    );
    assert.equal(parsed.prototypes.length, 1);

    const p = parsed.prototypes[0];
    assert.equal(p.slug, "orders-export");
    assert.equal(p.title, "Orders Export");
    assert.equal(p.kind, "first_screen");
    assert.equal(p.binding, "flow");
    assert.deepEqual(p.issueKeys, ["I1"]);
    assert.equal(p.screens.length, 2);
    assert.equal(p.notShown.length, 1);
    assert.match(p.htmlContent || "", /data-screen="orders-list"/);
  });

  it("supports file-backed htmlPath metadata without inline HTML", () => {
    const raw = [
      "Built the clickable prototype:",
      "```sf-prototype",
      JSON.stringify({
        title: "Checkout Flow",
        kind: "whole_flow",
        binding: "look",
        issueKeys: ["I1", "I2"],
        htmlPath: ".factory/prototypes/checkout-flow/index.html",
        screens: [{ id: "cart", title: "Cart", criteria: ["C1"] }],
      }),
      "```",
    ].join("\n");

    const parsed = splitAssistantPrototypeBlocks(raw);
    assert.equal(parsed.prototypes.length, 1);
    assert.equal(parsed.prototypes[0].slug, "checkout-flow");
    assert.equal(parsed.prototypes[0].kind, "whole_flow");
    assert.equal(parsed.prototypes[0].binding, "look");
    assert.equal(parsed.prototypes[0].htmlPath, ".factory/prototypes/checkout-flow/index.html");
    assert.equal(parsed.prototypes[0].htmlContent, undefined);
  });

  it("detects unclosed streaming sf-prototype fences gracefully", () => {
    const partial = 'Drawing screen...\n```sf-prototype\n{"title": "Dashboard V1", "kind": "first';
    const parsed = splitAssistantPrototypeBlocks(partial);
    assert.equal(parsed.prose, "Drawing screen...");
    assert.equal(parsed.prototypeStreaming, true);
    assert.equal(parsed.streamingTitle, "Dashboard V1");
    assert.equal(parsed.prototypes.length, 0);
  });
});

describe("HTML screen extractor & sandbox wrapper", () => {
  it("extracts data-screen sections when manifest omits screens", () => {
    const html = `
      <main>
        <section data-screen="list-normal" data-title="Normal List" data-criteria="C1,C2">Rows</section>
        <section data-screen="list-error" aria-label="Network Error">Retry</section>
      </main>
    `;
    const screens = extractScreensFromHtml(html);
    assert.equal(screens.length, 2);
    assert.deepEqual(screens[0], {
      id: "list-normal",
      title: "Normal List",
      criteria: ["C1", "C2"],
    });
    assert.deepEqual(screens[1], {
      id: "list-error",
      title: "Network Error",
      criteria: [],
    });

    const manifest = normalizePrototypeManifest({ title: "Demo" }, html);
    assert.equal(manifest.screens.length, 2);
  });

  it("wraps fragments into a complete HTML5 document with the postMessage bridge", () => {
    const frag = `<style>body{color:#111}</style><section data-screen="home">Hello</section>`;
    const doc = buildSandboxedPrototypeDocument(frag, {
      initialScreenId: "home",
      theme: "dark",
    });
    assert.match(doc, /^<!doctype html>/i);
    assert.match(doc, /data-theme="dark"/);
    assert.match(doc, /data-sf-proto-bridge/);
    assert.match(doc, /sf-proto:set-screen/);
    assert.match(doc, /<section data-screen="home">Hello<\/section>/);
  });

  it("injects the bridge into full HTML documents before </body>", () => {
    const full = `<!doctype html><html><head><title>App</title></head><body><div data-screen="s1">Hi</div></body></html>`;
    const doc = buildSandboxedPrototypeDocument(full, {
      initialScreenId: "s1",
      theme: "light",
    });
    assert.match(doc, /data-sf-proto-bridge[\s\S]*<\/body>/);
  });
});
