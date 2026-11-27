import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyHtmlToolCall,
  classifyBaHtmlPath,
  collectPrototypeActivity,
  readPrototypeToolCall,
} from "../src/lib/prototype-capture.ts";

const BATCH = "/private/tmp/claude-501/x/scratchpad/todo-batch";

describe("classifyBaHtmlPath", () => {
  it("recognises the batch prototype", () => {
    assert.deepEqual(classifyBaHtmlPath(`${BATCH}/prototype/index.html`), {
      kind: "prototype",
      batch: "todo-batch",
      slug: "todo-batch-prototype",
      title: "todo-batch prototype",
    });
  });

  it("recognises each design direction but not the screenshot compare page", () => {
    assert.deepEqual(classifyBaHtmlPath(`${BATCH}/directions/b.html`), {
      kind: "direction",
      batch: "todo-batch",
      slug: "todo-batch-direction-b",
      title: "Direction B",
    });
    assert.equal(classifyBaHtmlPath(`${BATCH}/directions/compare.html`), null);
    assert.equal(classifyBaHtmlPath(`${BATCH}/prototype/open-me.html`), null);
  });

  it("ignores html anywhere else", () => {
    assert.equal(classifyBaHtmlPath("/repo/src/app/index.html"), null);
    assert.equal(classifyBaHtmlPath(`${BATCH}/prototype/taste.md`), null);
    assert.equal(classifyBaHtmlPath(""), null);
  });
});

describe("readPrototypeToolCall", () => {
  it("reads a Write of the prototype from a tool_call step", () => {
    const call = readPrototypeToolCall({
      kind: "tool_call",
      tool: "Write",
      input: { file_path: `${BATCH}/prototype/index.html`, content: "<main>hi</main>" },
    });
    assert.equal(call?.target.slug, "todo-batch-prototype");
    assert.equal(call?.tool, "Write");
  });

  it("ignores other tools, other files and other step kinds", () => {
    assert.equal(
      readPrototypeToolCall({ kind: "tool_call", tool: "Read", input: { file_path: `${BATCH}/prototype/index.html` } }),
      null,
    );
    assert.equal(
      readPrototypeToolCall({ kind: "tool_call", tool: "Write", input: { file_path: "/repo/a.ts", content: "x" } }),
      null,
    );
    assert.equal(readPrototypeToolCall({ kind: "assistant_message" }), null);
    assert.equal(readPrototypeToolCall(null), null);
  });
});

describe("applyHtmlToolCall", () => {
  it("Write replaces the whole file", () => {
    assert.equal(applyHtmlToolCall("<old/>", "Write", { content: "<new/>" }), "<new/>");
    assert.equal(applyHtmlToolCall(null, "Write", { content: "<new/>" }), "<new/>");
  });

  it("Edit replaces the first match, or every match with replace_all", () => {
    const html = "<b>a</b><b>a</b>";
    assert.equal(
      applyHtmlToolCall(html, "Edit", { old_string: "a", new_string: "z" }),
      "<b>z</b><b>a</b>",
    );
    assert.equal(
      applyHtmlToolCall(html, "Edit", { old_string: "a", new_string: "z", replace_all: true }),
      "<b>z</b><b>z</b>",
    );
  });

  it("MultiEdit applies its edits in order", () => {
    assert.equal(
      applyHtmlToolCall("one two", "MultiEdit", {
        edits: [
          { old_string: "one", new_string: "1" },
          { old_string: "two", new_string: "2" },
        ],
      }),
      "1 2",
    );
  });

  it("returns null when an edit cannot be applied, so a replayed edit never applies twice", () => {
    assert.equal(applyHtmlToolCall(null, "Edit", { old_string: "a", new_string: "b" }), null);
    assert.equal(applyHtmlToolCall("xyz", "Edit", { old_string: "a", new_string: "b" }), null);
    assert.equal(applyHtmlToolCall("xyz", "Write", {}), null);
  });
});

describe("collectPrototypeActivity", () => {
  const step = (prototype) => ({ data: { kind: "tool_call", tool: "Write", prototype } });

  it("groups writes of one prototype and the directions of one batch", () => {
    const activity = collectPrototypeActivity([
      step({ kind: "direction", batch: "b1", slug: "b1-direction-a", title: "Direction A" }),
      { data: { kind: "tool_call", tool: "Bash" } },
      step({ kind: "direction", batch: "b1", slug: "b1-direction-b", title: "Direction B" }),
      step({ kind: "prototype", batch: "b1", slug: "b1-prototype", title: "b1 prototype" }),
      step({ kind: "prototype", batch: "b1", slug: "b1-prototype", title: "b1 prototype" }),
      step({ kind: "direction", batch: "b1", slug: "b1-direction-a", title: "Direction A" }),
    ]);
    assert.deepEqual(activity, [
      { type: "directions", key: "d:b1", batch: "b1", slugs: ["b1-direction-a", "b1-direction-b"], writes: 3 },
      { type: "prototype", key: "p:b1-prototype", slug: "b1-prototype", title: "b1 prototype", writes: 2 },
    ]);
  });

  it("returns nothing for steps without a prototype", () => {
    assert.deepEqual(collectPrototypeActivity([{ data: null }, {}, { data: { prototype: { kind: "x" } } }]), []);
  });
});
