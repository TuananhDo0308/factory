import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractStepAttachments,
  isSupportedAttachment,
  resolveAttachmentMime,
  sanitizeAttachmentFilename,
  validateIncomingAttachments,
} from "../src/lib/attachments.ts";

describe("Chat image & file attachments validation", () => {
  it("supports diverse image formats (PNG, JPG, WEBP, GIF, AVIF, BMP, SVG, ICO) and documents", () => {
    const samples = [
      ["screen.png", "image/png"],
      ["photo.jpg", "image/jpeg"],
      ["mock.webp", "image/webp"],
      ["anim.gif", "image/gif"],
      ["hero.avif", "image/avif"],
      ["legacy.bmp", "image/bmp"],
      ["logo.svg", "image/svg+xml"],
      ["favicon.ico", "image/x-icon"],
      ["spec.pdf", "application/pdf"],
      ["notes.md", "text/markdown"],
      ["data.csv", "text/csv"],
      ["schema.sql", ""],
    ];
    for (const [name, mime] of samples) {
      const resolved = resolveAttachmentMime(name, mime);
      assert.equal(isSupportedAttachment(name, resolved), true, `${name} should be supported`);
    }
    assert.equal(isSupportedAttachment("malware.exe", "application/x-msdownload"), false);
  });

  it("sanitizes filenames against path traversal and validates base64 payloads", () => {
    assert.equal(sanitizeAttachmentFilename("../../etc/passwd.png", "image/png"), "passwd.png");
    assert.equal(sanitizeAttachmentFilename("pasted", "image/webp"), "pasted.webp");

    const samplePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const sampleJson = Buffer.from('{"ok":true}', "utf8").toString("base64");

    const res = validateIncomingAttachments([
      {
        name: "ui-shot.avif",
        mimeType: "image/avif",
        dataBase64: `data:image/avif;base64,${samplePng}`,
      },
      {
        name: "config.json",
        mimeType: "application/json",
        dataBase64: sampleJson,
      },
    ]);

    assert.equal(res.error, undefined);
    assert.equal(res.attachments.length, 2);
    assert.equal(res.attachments[0].mimeType, "image/avif");
    assert.equal(res.attachments[0].isText, false);
    assert.equal(res.attachments[1].isText, true);
    assert.equal(res.attachments[1].textContent, '{"ok":true}');
  });

  it("rejects unsupported types and extracts stored attachment refs from step data", () => {
    const bad = validateIncomingAttachments([
      {
        name: "app.exe",
        mimeType: "application/octet-stream",
        dataBase64: Buffer.from("MZ").toString("base64"),
      },
    ]);
    assert.ok(bad.error && bad.error.includes("Unsupported"));

    const refs = extractStepAttachments({
      kind: "human_steer",
      attachments: [
        { artifactId: "art_1", name: "shot.webp", mimeType: "image/webp", size: 12345 },
      ],
    });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].artifactId, "art_1");
    assert.equal(refs[0].name, "shot.webp");
  });
});
