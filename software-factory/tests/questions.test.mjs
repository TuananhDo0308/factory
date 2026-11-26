import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRecommendedAnswers,
  extractQuestionSetFromAssistantText,
  extractQuestionsFromInteractionPayload,
  extractQuestionsFromMarkdown,
  formatQuestionAnswers,
  parseQuestionsJson,
  splitAssistantQuestionsBlock,
} from "../src/lib/questions.ts";

describe("sf-questions structured block parser", () => {
  it("strips closed sf-questions fences and preserves prose", () => {
    const raw = [
      "I scanned the repository and have two quick questions.",
      "",
      "```sf-questions",
      JSON.stringify({
        questions: [
          {
            id: "Q1",
            header: "Payment",
            question: "How should customers pay the deposit?",
            multiSelect: false,
            options: [
              { label: "VietQR bank transfer", description: "Fastest to launch", recommended: true },
              { label: "Stripe Checkout", description: "Cards & Apple Pay" },
            ],
            allowOther: true,
          },
          {
            id: "Q2",
            header: "Languages",
            question: "Which languages are needed at launch?",
            multiSelect: true,
            options: ["(Recommended) English", "Vietnamese", "Other"],
          },
        ],
      }),
      "```",
    ].join("\n");

    const split = splitAssistantQuestionsBlock(raw);
    assert.equal(split.prose, "I scanned the repository and have two quick questions.");
    assert.equal(split.questionsStreaming, false);
    assert.ok(split.questionsJson);

    const parsed = extractQuestionSetFromAssistantText(raw);
    assert.ok(parsed);
    assert.equal(parsed.source, "sf-questions");
    assert.equal(parsed.questions.length, 2);

    assert.equal(parsed.questions[0].header, "Payment");
    assert.equal(parsed.questions[0].multiSelect, false);
    assert.equal(parsed.questions[0].options.length, 2);
    assert.equal(parsed.questions[0].options[0].recommended, true);

    assert.equal(parsed.questions[1].header, "Languages");
    assert.equal(parsed.questions[1].multiSelect, true);
    // "Other" option is deduplicated into allowOther
    assert.equal(parsed.questions[1].options.length, 2);
    assert.equal(parsed.questions[1].options[0].label, "English");
    assert.equal(parsed.questions[1].options[0].recommended, true);
    assert.equal(parsed.questions[1].allowOther, true);
  });

  it("handles streaming unclosed sf-questions block gracefully", () => {
    const partial =
      'Brief intro.\n\n```sf-questions\n{ "questions": [ { "question": "First?"';
    const split = splitAssistantQuestionsBlock(partial);
    assert.equal(split.prose, "Brief intro.");
    assert.equal(split.questionsStreaming, true);
    assert.equal(split.questionCount, 1);
    assert.equal(extractQuestionSetFromAssistantText(partial), null);
  });

  it("supports question-level recommended index and string", () => {
    const parsed = parseQuestionsJson(
      JSON.stringify({
        questions: [
          {
            question: "Pick DB?",
            options: ["SQLite", "PostgreSQL"],
            recommended: 1,
          },
          {
            question: "Auth provider?",
            options: [{ id: "gh", label: "GitHub OAuth" }, { id: "email", label: "Magic link" }],
            recommended: "gh",
          },
        ],
      }),
    );
    assert.ok(parsed);
    assert.equal(parsed.questions[0].options[1].recommended, true);
    assert.equal(parsed.questions[1].options[0].recommended, true);
  });
});

describe("markdown fallback parser", () => {
  it("parses real-world /factory init wave (cmwwzlqzh000008i78rq4r1b0)", () => {
    const sample = `I've started the init. \`init-status\` says **\`none\`**, so this is a first setup.

**What I found:**
- **This is a new, empty project.**
- **It sits inside the ScamHunter repo.**

Before I write \`.factory/product.md\`, here is the first wave of questions:

**1. What is claude-blue-hour?**
- a) a new, separate product
- b) a part, spin-off or rewrite of ScamHunter (for example a new screen, a hub, a demo)
- c) something else

Please also tell me in a sentence or two what problem it solves and for whom.
> *My suggestion:* if it's meant for the MoMo Hackathon, say so and how it relates to ScamHunter. I'll then reuse ScamHunter's rules instead of asking them again.

**2. Who uses it, and which one journey must work end to end first?**
For example: "a MoMo user pastes a suspicious message and gets a scam verdict". Also: on what device (web, mobile, CLI)?
> *My suggestion:* one web journey on desktop and mobile, usable by a demo judge without signing in. That's the smallest version that works for a hackathon demo.

**3. Stack: is there a constraint, or should I propose options?**
> *My suggestion:* match ScamHunter: Python 3.11 + FastAPI + uv on the backend, and React + TypeScript strict + Vite + Tailwind 4 on the frontend.

Answer "yes" or "you pick" to take my suggestions. If you don't know an answer yet, I'll record it under **Open** in \`product.md\`.`;

    const parsed = extractQuestionsFromMarkdown(sample);
    assert.ok(parsed);
    assert.equal(parsed.source, "markdown");
    assert.equal(parsed.questions.length, 3);
    assert.equal(parsed.acceptAllLabel, "Accept AI suggestions");

    // Q1: a) and b) as options, c) "something else" absorbed into allowOther
    const [q1, q2, q3] = parsed.questions;
    assert.equal(q1.question, "What is claude-blue-hour?");
    assert.equal(q1.options.length, 2);
    assert.equal(q1.options[0].label, "a new, separate product");
    assert.equal(q1.allowOther, true);
    assert.ok(q1.hint?.includes("MoMo Hackathon"));

    // Q2: open-ended with suggestion -> 1-click recommended option
    assert.equal(q2.options.length, 1);
    assert.equal(q2.options[0].recommended, true);
    assert.ok(q2.options[0].description?.includes("one web journey"));

    // Q3: derived header "Stack" + 1-click recommended option
    assert.equal(q3.header, "Stack");
    assert.equal(q3.options.length, 1);
    assert.equal(q3.options[0].recommended, true);
    assert.ok(q3.options[0].description?.includes("Python 3.11"));
  });

  it("parses Vietnamese markdown questions with checkboxes and inline Đề xuất", () => {
    const viSample = `Trước khi tạo ticket, mình hỏi nhanh 2 câu:

**1. Hình thức đặt cọc cho khách là gì?**
- a) **VietQR chuyển khoản** — xác nhận nhanh, dễ triển khai *(Đề xuất)*
- b) **Stripe / VNPay** — thanh toán tự động ngay trên web
- c) Khác

**2. Ngôn ngữ website cần hỗ trợ? (có thể chọn nhiều)**
- [ ] Tiếng Việt
- [ ] Tiếng Anh
- [ ] Tiếng Nhật`;

    const parsed = extractQuestionsFromMarkdown(viSample);
    assert.ok(parsed);
    assert.equal(parsed.questions.length, 2);
    assert.equal(parsed.questions[0].options.length, 2);
    assert.equal(parsed.questions[0].options[0].label, "VietQR chuyển khoản");
    assert.equal(parsed.questions[0].options[0].recommended, true);
    assert.equal(parsed.questions[0].allowOther, true);

    assert.equal(parsed.questions[1].multiSelect, true);
    assert.equal(parsed.questions[1].options.length, 3);
  });

  it("returns null for non-question numbered summaries (zero false positives)", () => {
    const summary = `Done! Here is what I completed:

1. Created the database migration in \`prisma/schema.prisma\`.
2. Added the REST endpoint in \`src/app/api/tours/route.ts\`.
3. Verified all 14 unit tests pass with zero warnings.`;

    assert.equal(extractQuestionsFromMarkdown(summary), null);
  });
});

describe("answer formatting and recommendation helpers", () => {
  it("formats single-select, multi-select, custom notes, and recommendations cleanly", () => {
    const parsed = parseQuestionsJson(
      JSON.stringify({
        questions: [
          {
            id: "Q1",
            question: "Product type?",
            multiSelect: false,
            options: [
              { id: "new", label: "New separate product", recommended: true },
              { id: "sub", label: "Spin-off" },
            ],
          },
          {
            id: "Q2",
            question: "Target channels?",
            multiSelect: true,
            options: [
              { id: "web", label: "Web", recommended: true },
              { id: "mobile", label: "Mobile web", recommended: true },
            ],
          },
        ],
      }),
    );
    assert.ok(parsed);

    const recAnswers = buildRecommendedAnswers(parsed.questions);
    const formattedRec = formatQuestionAnswers(parsed.questions, recAnswers);
    assert.match(formattedRec, /1\. \*\*Product type\?\*\*: New separate product/);
    assert.match(formattedRec, /2\. \*\*Target channels\?\*\*: Web, Mobile web/);

    const customFormatted = formatQuestionAnswers(parsed.questions, {
      Q1: { selectedOptionIds: ["new"], useOther: false, otherText: "Blue Hour Freediving" },
      Q2: { selectedOptionIds: ["web"], useOther: true, otherText: "LINE OA" },
    });
    assert.match(customFormatted, /New separate product — Note: Blue Hour Freediving/);
    assert.match(customFormatted, /Web, LINE OA/);
  });

  it("extracts options from RunInteraction payload", () => {
    const qs = extractQuestionsFromInteractionPayload(
      { options: ["(Recommended) Continue", "Abort"] },
      "Proceed with migration?",
    );
    assert.ok(qs);
    assert.equal(qs.length, 1);
    assert.equal(qs[0].question, "Proceed with migration?");
    assert.equal(qs[0].options[0].label, "Continue");
    assert.equal(qs[0].options[0].recommended, true);
  });
});
