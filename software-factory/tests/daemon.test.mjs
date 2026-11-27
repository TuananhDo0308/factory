// `sf daemon` end to end against a fake Software Factory server: a BA turn on a fake `claude`,
// then an epic run on new-factory (fake claude and gh from factory_v2's fixtures).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SF = join(HERE, "..", "cli", "sf.ts");
/** The nearest `factory_v2/skills` above this checkout (it sits beside or above software-factory). */
function findV2Skills(from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const skills = join(dir, "factory_v2", "skills");
    if (existsSync(join(skills, "new-factory", "SKILL.md"))) return skills;
    if (dirname(dir) === dir) return join(from, "factory_v2", "skills");
  }
}
const SKILLS = findV2Skills(HERE);
const HARNESS = join(SKILLS, "new-factory", "tests", "integration", "harness.mjs");

// Plays one BA turn: asks a question with an sf-questions block, as the contract says.
const FAKE_CLAUDE = `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("9.9.9 (Claude Code)"); process.exit(0); }
if (a[0] === "mcp") process.exit(0);
const emit = (e) => process.stdout.write(JSON.stringify(e) + "\\n");
const prompt = a[a.indexOf("-p") + 1] || "";
const fs = require("fs");
const n = fs.readdirSync(process.env.FAKE_DIR).filter((f) => f.startsWith("args-")).length + 1;
fs.writeFileSync(process.env.FAKE_DIR + "/args-" + n + ".json", JSON.stringify(a));
fs.writeFileSync(process.env.FAKE_DIR + "/cwd-" + n + ".txt", process.cwd());
emit({ type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus-5-5" });
const u = { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 400 };
emit({ type: "assistant", session_id: "sess-1", message: { id: "m1", usage: u, content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "gh issue list" } }] } });
emit({ type: "user", session_id: "sess-1", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "[]" }] } });
emit({ type: "assistant", session_id: "sess-1", message: { id: "m2", usage: { input_tokens: 10, output_tokens: 50 }, content: [{ type: "text", text: "Who uses it?\\n\`\`\`sf-questions\\n{\\"questions\\":[]}\\n\`\`\`" }] } });
emit({ type: "result", subtype: "success", session_id: "sess-1", result: prompt.startsWith("/new-ba") ? "asked" : "answered", total_cost_usd: 0.123, usage: { input_tokens: 130, output_tokens: 80, cache_read_input_tokens: 400 } });
`;

function fakeServer(commands, later) {
  const posts = [];
  const patches = new Map();
  let served = false;
  let servedLater = false;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      if (req.url === "/api/v1/runners/heartbeat") {
        let out = served ? [] : commands;
        served = true;
        if (!servedLater && patches.get(later.after) === "done") {
          servedLater = true;
          out = later.commands;
        }
        res.end(JSON.stringify({ ok: true, commands: out }));
        return;
      }
      if (req.method === "PATCH") patches.set(req.url.split("/").pop(), json.status);
      else posts.push({ path: req.url, body: json });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, posts, patches, port: server.address().port })));
}

test("sf daemon runs a BA turn and an epic sent from the web app", { skip: !existsSync(HARNESS) && "factory_v2 not in this checkout", timeout: 240_000 }, async () => {
  const { foundation, setup } = await import(HARNESS);
  const h = await setup("sf-daemon", {
    tickets: [foundation()],
    scenario: `export default (c) => {
  if (c.role === 'implementer') return { files: { ...foundationFiles, 'e2e/app.spec.mjs': \`import test from 'node:test';
import assert from 'node:assert/strict';
test('C2 the app answers on PORT', async () => {
  const r = await (await fetch(process.env.BASE_URL)).json();
  assert.equal(r.ok, true);
});
\` } };
};`,
  });
  const home = mkdtempSync(join(tmpdir(), "sf-home-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);
  const ba = mkdtempSync(join(tmpdir(), "sf-ba-"));
  const srv = await fakeServer([
    { id: "c1", type: "start_run", payload: { runKey: "ba-1", mode: "ba", engine: "claude", model: "sonnet", prompt: "/new-ba Add a todo list", localPath: ba } },
    { id: "c2", type: "run_epic", payload: { runKey: "epic-1", mode: "epic", repo: "o/r", epic: 10, localPath: h.work } },
  ], {
    // The user answers the BA's question: the same session, resumed where it ran.
    after: "c1",
    commands: [{ id: "c3", type: "answer_interaction", payload: { runKey: "ba-1", message: "Teachers", localPath: h.work } }],
  });
  // The orchestrator's environment, as factory_v2's harness sets it for its own runs.
  const nf = {
    NF_CLAUDE_BIN: join(h.root, "bin", "claude"),
    NF_GH_BIN: join(h.root, "bin", "gh"),
    NF_FAKE_GH_DATA: h.data,
    NF_FAKE_SCENARIO: join(h.root, "scenario.mjs"),
    NF_FAKE_STATE: h.stateDir,
    NF_WT_ROOT: join(h.root, "wt"),
    NF_NO_NOTIFY: "1",
    NF_MCP_CHECK: "skip",
    NF_BROWSER_CHECK: "skip",
    NF_QUEUE_POLL_MS: "200",
    NF_API_RETRY_MS: "100",
    NF_SERVER_WAIT_MS: "15000",
  };
  const env = { ...process.env, ...nf, SF_HOME: home, SF_URL: `http://127.0.0.1:${srv.port}`, SF_TOKEN: "t", SF_PROJECTS_DIR: join(home, "projects"), SF_V2_SKILLS_DIR: SKILLS, PATH: `${bin}:${process.env.PATH}`, FAKE_DIR: home };
  delete env.NODE_TEST_CONTEXT;
  const daemon = spawn(process.execPath, [SF, "daemon", "--interval-ms", "1500"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  daemon.stdout.on("data", (d) => (out += d));
  daemon.stderr.on("data", (d) => (out += d));
  try {
    const deadline = Date.now() + 200_000;
    const settled = (id) => srv.patches.get(id) && srv.patches.get(id) !== "claimed";
    while (!(settled("c1") && settled("c2") && settled("c3"))) {
      if (Date.now() > deadline) assert.fail(`daemon did not finish both commands\n${out}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    // Give the last posts (finish) a moment after the command PATCH.
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(srv.patches.get("c1"), "done", out);
    assert.equal(srv.patches.get("c2"), "done", out);
    assert.equal(srv.patches.get("c3"), "done", out);

    const of = (run) => srv.posts.filter((p) => p.body.run === run);
    // BA: /new-ba, headless contract, no AskUserQuestion; exact tokens and cost.
    const fs = await import("node:fs");
    const args = JSON.parse(fs.readFileSync(join(home, "args-1.json"), "utf8"));
    const prompt = args[args.indexOf("-p") + 1];
    assert.match(prompt, /^\/new-ba Add a todo list/);
    assert.ok(!args.includes("--resume"));
    const answer = JSON.parse(fs.readFileSync(join(home, "args-2.json"), "utf8"));
    assert.equal(answer[answer.indexOf("--resume") + 1], "sess-1");
    assert.match(answer[answer.indexOf("-p") + 1], /^Teachers/);
    assert.equal(fs.readFileSync(join(home, "cwd-2.txt"), "utf8"), fs.realpathSync(ba), "resumed in the BA's own directory, not the payload's");
    assert.match(prompt, /sf-questions/);
    assert.ok(args.includes("--disallowedTools") && args.includes("AskUserQuestion"));
    assert.equal(args[args.indexOf("--model") + 1], "sonnet");
    const firstTurn = (p) => typeof p.body.step === "string" && p.body.step.startsWith("ba-c1-");
    const baSteps = of("ba-1").filter((p) => p.path === "/api/v1/runs/step" && firstTurn(p));
    const sum = (k) => baSteps.reduce((n, p) => n + (p.body[k] || 0), 0);
    assert.equal(sum("inputTokens"), 130);
    assert.equal(sum("outputTokens"), 80);
    assert.equal(sum("cacheReadTokens"), 400);
    assert.equal(sum("costUsd"), 0.123);
    assert.ok(baSteps.some((p) => p.body.data?.kind === "assistant_message" && /sf-questions/.test(p.body.summary)));
    const baFinish = of("ba-1").find((p) => p.path === "/api/v1/runs/finish");
    assert.equal(baFinish.body.outcome, "passed");
    assert.equal(baFinish.body.respectPendingInteraction, true);
    // The session is saved for the user's answer.
    const sessions = JSON.parse((await import("node:fs")).readFileSync(join(home, "sessions.json"), "utf8"));
    assert.equal(sessions["ba-1"].sessionId, "sess-1");
    assert.equal(sessions["ba-1"].cwd, ba);

    // Epic: new-factory ran to the end, the ticket reached the board, outcome passed.
    const epicFinish = of("epic-1").find((p) => p.path === "/api/v1/runs/finish");
    assert.equal(epicFinish.body.outcome, "passed", epicFinish.body.summary);
    const ticket = srv.posts.filter((p) => p.path === "/api/v1/epics/sync").flatMap((p) => p.body.tickets).filter((t) => t.number === 11).at(-1);
    assert.equal(ticket.status, "merged");
    const st = h.state();
    const cost = of("epic-1").filter((p) => p.path === "/api/v1/runs/step").reduce((n, p) => n + (p.body.costUsd || 0), 0);
    assert.equal(cost.toFixed(6), st.agents.reduce((n, a) => n + a.cost, 0).toFixed(6));
  } finally {
    daemon.kill("SIGTERM");
    srv.server.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(ba, { recursive: true, force: true });
  }
});
