import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  deriveTicketStatus,
  findIssueNumbers,
  findPrototypeFolder,
  findRepoInText,
  isUnreachableUrl,
  repoEventToDelivery,
  issuesClosedByPullRequest,
  linkedPullRequest,
  parseCriteriaFromBody,
  parseEpicPlan,
  parseFactoryComment,
  parseFactoryCommit,
  parseRepoLink,
  ticketsFromPlan,
  verifyWebhookSignature,
} from "../src/lib/github-sync.ts";

describe("parseRepoLink", () => {
  it("accepts repo URLs, deeper links, SSH remotes and owner/name", () => {
    const want = { owner: "acme", name: "claude-todo", fullName: "acme/claude-todo" };
    assert.deepEqual(parseRepoLink("https://github.com/acme/claude-todo"), want);
    assert.deepEqual(parseRepoLink("github.com/acme/claude-todo/issues/42"), want);
    assert.deepEqual(parseRepoLink("https://github.com/acme/claude-todo.git"), want);
    assert.deepEqual(parseRepoLink("git@github.com:acme/claude-todo.git"), want);
    assert.deepEqual(parseRepoLink("  acme/claude-todo  "), want);
  });

  it("rejects anything that is not a GitHub repository", () => {
    assert.equal(parseRepoLink("https://gitlab.com/acme/x"), null);
    assert.equal(parseRepoLink("https://github.com/acme"), null);
    assert.equal(parseRepoLink(""), null);
  });
});

const PLAN = {
  id: "todo-v1",
  hash: "sha256:abc",
  architecture: { layout: "pages-features", checks: [], shared: [], extensionPoint: "x", contracts: [] },
  prototype: { branch: "prototype/todo-v1", commit: "c0ffee", path: "docs/ba/prototypes/todo-v1/" },
  waves: [
    { wave: 0, tickets: [{ issue: 11, key: "T1", title: "Foundation", size: "L", dependsOn: [], criteria: ["C1", "C2"], owns: [], uses: [], newDependencies: [], sizeReason: "" }] },
    { wave: 1, tickets: [{ issue: 12, key: "T2", title: "Sign up", size: "M", dependsOn: [11], criteria: ["C15"], owns: [], uses: [], newDependencies: [], sizeReason: "" }] },
  ],
};
const EPIC_BODY = `## Objective\n\nTodo app.\n\n## Plan\n\nWritten by new-ba.\n\n\`\`\`json\n${JSON.stringify(PLAN, null, 2)}\n\`\`\`\n`;

describe("parseEpicPlan", () => {
  it("reads the plan new-ba writes into the epic", () => {
    assert.equal(parseEpicPlan(EPIC_BODY)?.id, "todo-v1");
  });

  it("returns null for an issue without a plan or with a broken one", () => {
    assert.equal(parseEpicPlan("## Objective\n\nNothing"), null);
    assert.equal(parseEpicPlan("## Plan\n\n```json\n{ nope\n```\n"), null);
    assert.equal(parseEpicPlan("## Plan\n\n```json\n{\"id\":\"x\"}\n```\n"), null);
  });
});

describe("parseCriteriaFromBody", () => {
  it("reads the bold criterion ids of a ticket", () => {
    const body = "## Acceptance criteria\n\n- **C15** Given a visitor, they sign up.\n- **C16** `POST /api/auth/signup` stores the hash.\n\n## Owns\n\n- src/x/";
    assert.deepEqual(parseCriteriaFromBody(body), [
      { id: "C15", text: "Given a visitor, they sign up." },
      { id: "C16", text: "`POST /api/auth/signup` stores the hash." },
    ]);
  });
});

describe("parseFactoryCommit", () => {
  it("reads merges and reverts new-factory makes on staging", () => {
    assert.deepEqual(parseFactoryCommit("factory: merge #12 Sign up\n\nnf-run: r1\nnf-tip: abc"), {
      type: "merge",
      issue: 12,
      title: "Sign up",
      runId: "r1",
    });
    assert.deepEqual(parseFactoryCommit("factory: revert #12 (needs a decision on #13)\n\nnf-run: r1\nnf-revert: deadbeef"), {
      type: "revert",
      issue: 12,
      title: null,
      runId: "r1",
    });
    assert.equal(parseFactoryCommit("fix: typo"), null);
  });
});

describe("parseFactoryComment", () => {
  it("reads the marker new-factory puts on its comments", () => {
    assert.deepEqual(parseFactoryComment("Pick one.\n\n<!-- new-factory:r1:needs-decision:12:1 -->\n"), {
      runId: "r1",
      kind: "needs-decision",
      issue: 12,
    });
    assert.deepEqual(parseFactoryComment("Tests fail.\n\n<!-- new-factory:r1:alarm:3 -->"), {
      runId: "r1",
      kind: "alarm",
      issue: null,
    });
    assert.equal(parseFactoryComment("looks good"), null);
  });
});

describe("deriveTicketStatus", () => {
  const base = { state: "open", labels: [], merged: false, reverted: false };

  it("a merge that was not reverted is passed, whatever the factory reported", () => {
    assert.equal(deriveTicketStatus({ ...base, merged: true }, "in_progress"), "passed");
    assert.equal(deriveTicketStatus({ ...base, merged: true, reverted: true }, "passed"), "ready");
  });

  it("the needs-decision label waits on a person; removing it releases the ticket", () => {
    assert.equal(deriveTicketStatus({ ...base, labels: ["needs-decision"] }, "in_progress"), "needs_human");
    assert.equal(deriveTicketStatus(base, "needs_human"), "ready");
  });

  it("keeps a live status the daemon reported while GitHub has nothing to say", () => {
    assert.equal(deriveTicketStatus(base, "in_progress"), "in_progress");
    assert.equal(deriveTicketStatus(base, "blocked"), "blocked");
    assert.equal(deriveTicketStatus(base, "failed"), "failed");
  });

  it("a closed ticket is done, otherwise ready", () => {
    assert.equal(deriveTicketStatus({ ...base, state: "closed" }, "ready"), "passed");
    assert.equal(deriveTicketStatus(base, null), "ready");
  });
});

describe("ticketsFromPlan", () => {
  it("joins the plan with each ticket issue and its merge", () => {
    const tickets = ticketsFromPlan(
      PLAN,
      new Map([
        [11, { number: 11, title: "[FEAT] Foundation", body: "- **C1** one\n- **C2** two", state: "open", labels: [], url: "u11" }],
        [12, { number: 12, title: "[FEAT] Sign up", body: "- **C15** sign up", state: "open", labels: ["needs-decision"], url: "u12" }],
      ]),
      new Map([[11, { merged: true, reverted: false }]]),
      new Map([[12, "in_progress"]]),
    );
    assert.deepEqual(
      tickets.map((t) => [t.number, t.key, t.wave, t.size, t.dependsOn, t.status, t.criteria?.length, t.title]),
      [
        [11, "T1", 0, "L", [], "passed", 2, "[FEAT] Foundation"],
        [12, "T2", 1, "M", ["#11"], "needs_human", 1, "[FEAT] Sign up"],
      ],
    );
  });
});

describe("findPrototypeFolder", () => {
  it("finds the folder holding prototype.json and index.html", () => {
    assert.equal(
      findPrototypeFolder(["README.md", "docs/ba/prototypes/todo-v1/index.html", "docs/ba/prototypes/todo-v1/prototype.json", "docs/ba/prototypes/todo-v1/shots/a.png"]),
      "docs/ba/prototypes/todo-v1/",
    );
    assert.equal(findPrototypeFolder(["index.html", "prototype.json"]), "");
    assert.equal(findPrototypeFolder(["src/index.html"]), null);
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts GitHub's sha256 HMAC and nothing else", () => {
    const body = '{"zen":"hi"}';
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    assert.equal(verifyWebhookSignature("s3cret", body, sig), true);
    assert.equal(verifyWebhookSignature("other", body, sig), false);
    assert.equal(verifyWebhookSignature("s3cret", body + " ", sig), false);
    assert.equal(verifyWebhookSignature("s3cret", body, null), false);
    assert.equal(verifyWebhookSignature("s3cret", body, "sha256=zz"), false);
  });
});

describe("linkedPullRequest", () => {
  const ref = (number, state, merged_at = null, at = "2026-11-27T05:00:00Z") => ({
    event: "cross-referenced",
    created_at: at,
    source: { issue: { number, html_url: `https://github.com/acme/x/pull/${number}`, state, pull_request: { merged_at } } },
  });

  it("takes the newest pull request that references the issue, merged when it was merged", () => {
    assert.deepEqual(
      linkedPullRequest([
        ref(20, "closed", null, "2026-11-27T05:00:00Z"),
        { event: "labeled", created_at: "2026-11-27T05:30:00Z" },
        ref(21, "closed", "2026-11-27T06:00:00Z", "2026-11-27T05:40:00Z"),
      ]),
      { number: 21, url: "https://github.com/acme/x/pull/21", state: "merged" },
    );
    assert.deepEqual(linkedPullRequest([ref(22, "open")]), { number: 22, url: "https://github.com/acme/x/pull/22", state: "open" });
  });

  it("ignores references from other issues and returns null without a pull request", () => {
    const fromIssue = { event: "cross-referenced", created_at: "x", source: { issue: { number: 3, html_url: "u", state: "open" } } };
    assert.equal(linkedPullRequest([fromIssue]), null);
    assert.equal(linkedPullRequest([]), null);
  });
});

describe("issuesClosedByPullRequest", () => {
  it("reads GitHub's closing keywords, one issue per keyword", () => {
    assert.deepEqual(issuesClosedByPullRequest("[FEAT] Sign up", "Closes #12\nfixes #13, resolved #14\nSee #99"), [12, 13, 14]);
    assert.deepEqual(issuesClosedByPullRequest("Close #7", null), [7]);
    assert.deepEqual(issuesClosedByPullRequest("nothing", "mentions #5 only"), []);
  });
});

describe("findRepoInText", () => {
  it("reads the repository a BA run publishes to", () => {
    assert.equal(
      findRepoInText("node publish-batch.mjs --dir /tmp/b --repo TuananhDo0308/claude-todo --label ready")?.fullName,
      "TuananhDo0308/claude-todo",
    );
    assert.equal(findRepoInText("**Epic:** https://github.com/acme/todo/issues/1")?.fullName, "acme/todo");
    assert.equal(findRepoInText("--repo=acme/x")?.fullName, "acme/x");
    assert.equal(findRepoInText("no repository here"), null);
  });
});

describe("findIssueNumbers", () => {
  it("lists the issues of one repository a message links to, in order, once each", () => {
    const text = "Epic https://github.com/acme/todo/issues/1 then [#2](https://github.com/acme/todo/issues/2), again /issues/1 and https://github.com/other/x/issues/9";
    assert.deepEqual(findIssueNumbers(text.replace("again /issues/1", "again https://github.com/acme/todo/issues/1"), "acme/todo"), [1, 2]);
    assert.deepEqual(findIssueNumbers(text, "ACME/Todo"), [1, 2]);
    assert.deepEqual(findIssueNumbers("nothing", "acme/todo"), []);
  });
});

describe("isUnreachableUrl", () => {
  it("treats loopback, LAN and .local addresses as unreachable from GitHub", () => {
    for (const u of ["http://localhost:8787", "http://127.0.0.1:8787", "http://192.168.100.54:8787", "http://10.0.0.5", "http://172.20.1.1", "http://my-mac.local:8787", "http://0.0.0.0:3000"]) {
      assert.equal(isUnreachableUrl(u), true, u);
    }
    for (const u of ["https://factory.example.com", "https://abc.trycloudflare.com", "http://172.32.0.1"]) {
      assert.equal(isUnreachableUrl(u), false, u);
    }
  });
});

describe("repoEventToDelivery", () => {
  it("turns repository events into the webhook deliveries they stand for", () => {
    assert.deepEqual(
      repoEventToDelivery({ type: "PushEvent", created_at: "2026-11-27T06:00:00Z", payload: { ref: "refs/heads/staging", size: 1, commits: [{ sha: "abc", message: "factory: merge #2 x" }] } }),
      { event: "push", payload: { ref: "refs/heads/staging", size: 1, commits: [{ id: "abc", message: "factory: merge #2 x", timestamp: "2026-11-27T06:00:00Z" }] } },
    );
    assert.equal(repoEventToDelivery({ type: "IssuesEvent", payload: { action: "labeled", issue: { number: 3 } } }).event, "issues");
    assert.equal(repoEventToDelivery({ type: "IssueCommentEvent", payload: { issue: { number: 3 }, comment: { body: "x" } } }).event, "issue_comment");
    assert.equal(repoEventToDelivery({ type: "PullRequestEvent", payload: { pull_request: { number: 9 } } }).event, "pull_request");
    assert.equal(repoEventToDelivery({ type: "CreateEvent", payload: { ref: "prototype/x", ref_type: "branch" } }).event, "create");
    assert.equal(repoEventToDelivery({ type: "WatchEvent", payload: {} }), null);
  });
});
