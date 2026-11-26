"""End-to-end mocked workflow tests for factory/workflow/factory.py."""

import ast
import asyncio
import json
import os
import subprocess
import tempfile
import types
import unittest
from pathlib import Path


def load_factory_module():
    path = Path(__file__).resolve().parent.parent / "factory" / "workflow" / "factory.py"
    source = path.read_text(encoding="utf-8")
    code = compile(source, str(path), "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    mod = types.ModuleType("factory_workflow")
    mod.__file__ = str(path)
    res = eval(code, mod.__dict__)
    if asyncio.iscoroutine(res):
        asyncio.run(res)
    return mod, source


h, SOURCE = load_factory_module()

ALL_ROLES = {
    "planner": "/roles/planner.md",
    "implementer": "/roles/implementer.md",
    "qa": "/roles/qa.md",
    "checker": "/roles/checker.md",
    "reviewer": "/roles/reviewer.md",
    "specReviewer": "/roles/spec-reviewer.md",
    "qc": "/roles/qc.md",
}

ALL_SKILLS = {name: f"/home/.gemini/config/skills/{name}/SKILL.md" for name in h.required_skills()}

BASE_CONTRACT = {
    "objective": "Add --json flag to CLI status command",
    "criteria": [
        {"id": "C1", "text": "status --json prints valid JSON"},
        {"id": "C2", "text": "Human output remains unchanged without --json"},
    ],
    "outOfScope": ["Watch mode"],
    "checks": [{"name": "test", "command": "run-tests"}],
    "run": "node bin/cli.js status",
}


def make_spec(**over):
    spec = {
        "id": "S1",
        "title": "Add JSON flag",
        "goal": "Support --json on status",
        "kind": "feature",
        "skills": [],
        "criteria": ["C1", "C2"],
        "dependsOn": [],
        "filesOwned": ["src/cli.py"],
        "testFiles": ["tests/test_cli.py"],
        "context": "",
        "interfaces": "run_status(as_json: bool)",
        "changes": "Format status payload as JSON when --json is passed",
        "tests": "Verify JSON and default output",
        "outOfScope": "",
        "doneWhen": ["Both outputs tested"],
    }
    spec.update(over)
    return spec


def base_args(**over):
    a = {
        "repo": "/repo",
        "base": "abc1234",
        "roles": dict(ALL_ROLES),
        "skills": dict(ALL_SKILLS),
        "contract": json.loads(json.dumps(BASE_CONTRACT)),
    }
    a.update(over)
    return a


async def run_workflow(args, respond=None):
    calls = []
    phases = []
    logs = []
    contract = args.get("contract") or {}
    criteria = contract.get("criteria") or []
    checks = contract.get("checks") or []
    specs_by_id = {}

    def remember_specs(specs):
        for sp in specs or []:
            specs_by_id[sp["id"]] = sp

    remember_specs(args.get("specs"))

    def default_response(role, prompt):
        if role in ("planner", "planner (revision)"):
            specs = [make_spec()]
            remember_specs(specs)
            return {
                "overview": "Single CLI update",
                "risks": [],
                "risk": "low",
                "surfaces": [],
                "questions": [],
                "specs": specs,
            }
        if role.startswith("build ") or role.startswith("rebuild "):
            sid = role.split()[-1]
            sp = specs_by_id.get(sid) or make_spec(id=sid)
            owned = list(sp.get("filesOwned") or []) + list(sp.get("testFiles") or [])
            return {
                "status": "done",
                "filesChanged": owned,
                "testsWritten": list(sp.get("testFiles") or []),
                "commandsRun": [{"command": "run-tests", "result": "passed"}],
                "openIssues": [],
            }
        if role.startswith("qa "):
            return {
                "status": "done",
                "filesChanged": [],
                "commandsRun": [{"command": "run-tests", "result": "passed"}],
                "failures": [],
                "openIssues": [],
            }
        if role == "checker" or role.startswith("checker "):
            changed = []
            for sp in specs_by_id.values():
                changed.extend(sp.get("filesOwned") or [])
                changed.extend(sp.get("testFiles") or [])
            return {
                "results": [
                    {"name": c["name"], "command": c["command"], "exitCode": 0, "outputTail": "ok"}
                    for c in checks
                ],
                "changedFiles": list(dict.fromkeys(changed)),
                "baseRuns": [],
            }
        if role == "reviewer" or role.startswith("reviewer ") or role.startswith("review "):
            stds = [
                {"id": r["id"], "status": "pass", "file": "", "line": 0, "evidence": "ok"}
                for r in ((contract.get("standards") or {}).get("rules") or [])
                if r.get("enforced") == "review"
            ]
            return {
                "criteria": [{"id": c["id"], "status": "met", "evidence": "ok"} for c in criteria],
                "findings": [],
                "standards": stds,
                "notReviewed": [],
            }
        if role == "qc" or role.startswith("qc "):
            screens = [
                {"screen": sc["screen"], "screenshot": f"/tmp/{sc['screen']}.png", "status": "match", "differences": []}
                for sc in ((contract.get("design") or {}).get("screens") or [])
            ]
            return {
                "status": "done",
                "blockedReason": "",
                "startedWith": contract.get("run") or "app",
                "criteria": [
                    {
                        "id": c["id"],
                        "status": "pass",
                        "scenario": "Run product",
                        "expected": c["text"],
                        "observed": c["text"],
                        "steps": ["node bin/cli.js status --json"],
                    }
                    for c in criteria
                ],
                "screens": screens,
                "baseline": [],
                "a11y": [],
                "filesChanged": [],
                "commandsRun": [],
                "openIssues": [],
            }
        raise AssertionError(f"Unexpected role: {role}")

    async def agent_fn(prompt, schema, role, model=None):
        call = {"role": role, "prompt": prompt, "schema": schema, "model": model}
        calls.append(call)
        if respond is not None:
            custom = respond(role, call, calls)
            if custom is not None:
                if "specs" in custom:
                    remember_specs(custom["specs"])
                return custom
        return default_response(role, prompt)

    async def parallel_fn(items, fn):
        return await asyncio.gather(*(fn(item) for item in items))

    state = await h.run_factory(
        args,
        agent_fn=agent_fn,
        parallel_fn=parallel_fn,
        phase_fn=lambda p: phases.append(p),
        log_fn=lambda msg: logs.append(msg),
    )
    by_role = {}
    for c in calls:
        by_role.setdefault(c["role"], []).append(c)
    return {
        "state": state,
        "calls": calls,
        "roles": [c["role"] for c in calls],
        "by_role": by_role,
        "phases": phases,
        "logs": logs,
    }


class FactoryWorkflowTests(unittest.TestCase):
    def test_qc_runs_beside_reviewer_and_clean_qc_passes(self):
        r = asyncio.run(run_workflow(base_args()))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertIn("QC saw it work", r["state"]["reason"])
        self.assertIn("reviewer", r["roles"])
        self.assertIn("qc", r["roles"])

    def test_qc_sees_contract_and_run_not_spec_files_or_checks(self):
        r = asyncio.run(run_workflow(base_args()))
        qc_prompt = r["by_role"]["qc"][0]["prompt"]
        self.assertIn(BASE_CONTRACT["objective"], qc_prompt)
        self.assertIn("C1: status --json prints valid JSON", qc_prompt)
        self.assertIn("node bin/cli.js status", qc_prompt)
        self.assertNotIn("run-tests", qc_prompt)
        self.assertNotIn("src/cli.py", qc_prompt)
        self.assertNotIn("tests/test_cli.py", qc_prompt)
        self.assertNotIn("filesOwned", qc_prompt)

    def test_qc_criterion_fail_goes_back_to_build_and_reruns(self):
        def respond(role, _call, _calls):
            if role == "qc":
                return {
                    "status": "done",
                    "blockedReason": "",
                    "startedWith": "node bin/cli.js status",
                    "criteria": [
                        {"id": "C1", "status": "fail", "scenario": "s", "expected": "JSON", "observed": "text", "steps": ["cmd"]},
                        {"id": "C2", "status": "pass", "scenario": "s", "expected": "ok", "observed": "ok", "steps": ["cmd"]},
                    ],
                    "screens": [],
                    "baseline": [],
                    "a11y": [],
                    "filesChanged": [],
                    "commandsRun": [],
                    "openIssues": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertEqual(r["state"]["repairRounds"], 1)
        self.assertIn("rebuild 1 S1", r["roles"])
        self.assertIn("qa 1 S1", r["roles"])
        self.assertIn("checker (round 1)", r["roles"])
        self.assertIn("reviewer (round 1)", r["roles"])
        self.assertIn("qc (round 1)", r["roles"])

    def test_gate_failing_check_goes_back_to_build_with_no_reviewer_or_qc(self):
        def respond(role, _call, _calls):
            if role == "checker":
                return {
                    "results": [{"name": "test", "command": "run-tests", "exitCode": 1, "rerunExitCode": 1, "outputTail": "FAIL"}],
                    "changedFiles": ["src/cli.py", "tests/test_cli.py"],
                    "baseRuns": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertNotIn("reviewer", r["roles"])
        self.assertNotIn("qc", r["roles"])
        self.assertIn("rebuild 1 S1", r["roles"])
        self.assertIn("checker (round 1)", r["roles"])
        self.assertIn("reviewer (round 1)", r["roles"])
        self.assertIn("qc (round 1)", r["roles"])

    def test_qc_keeps_failing_fails_at_rebuild_cap(self):
        def respond(role, _call, _calls):
            if role.startswith("qc"):
                return {
                    "status": "done",
                    "blockedReason": "",
                    "startedWith": "app",
                    "criteria": [
                        {"id": "C1", "status": "fail", "scenario": "s", "expected": "e", "observed": "bad", "steps": ["cmd"]},
                        {"id": "C2", "status": "pass", "scenario": "s", "expected": "e", "observed": "ok", "steps": ["cmd"]},
                    ],
                    "screens": [],
                    "baseline": [],
                    "a11y": [],
                    "filesChanged": [],
                    "commandsRun": [],
                    "openIssues": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(maxRebuilds=1), respond))
        self.assertEqual(r["state"]["outcome"], "failed")
        self.assertIn("sent back to Build 1 time(s)", r["state"]["reason"])

    def test_qc_blocked_or_leftover_files_stops_run_as_blocked(self):
        def blocked_qc(role, _call, _calls):
            if role == "qc":
                return {
                    "status": "blocked",
                    "blockedReason": "No database available",
                    "startedWith": "",
                    "criteria": [],
                    "screens": [],
                    "baseline": [],
                    "a11y": [],
                    "filesChanged": [],
                    "commandsRun": [],
                    "openIssues": [],
                }
            return None

        r1 = asyncio.run(run_workflow(base_args(), blocked_qc))
        self.assertEqual(r1["state"]["outcome"], "blocked")
        self.assertIn("QC could not run the product: No database available", r1["state"]["reason"])

        def dirty_qc(role, _call, _calls):
            if role == "qc":
                return {
                    "status": "done",
                    "blockedReason": "",
                    "startedWith": "app",
                    "criteria": [
                        {"id": c["id"], "status": "pass", "scenario": "s", "expected": "e", "observed": "o", "steps": ["cmd"]}
                        for c in BASE_CONTRACT["criteria"]
                    ],
                    "screens": [],
                    "baseline": [],
                    "a11y": [],
                    "filesChanged": ["temp.log"],
                    "commandsRun": [],
                    "openIssues": [],
                }
            return None

        r2 = asyncio.run(run_workflow(base_args(), dirty_qc))
        self.assertEqual(r2["state"]["outcome"], "blocked")
        self.assertIn("QC changed files in the repository", r2["state"]["reason"])
        self.assertIn("temp.log", r2["state"]["reason"])

    def test_qc_false_runs_no_qc_and_needs_no_qc_brief(self):
        roles = {k: v for k, v in ALL_ROLES.items() if k != "qc"}
        r = asyncio.run(run_workflow(base_args(roles=roles, qc=False)))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertIn("(QC was turned off)", r["state"]["reason"])
        self.assertNotIn("qc", r["roles"])

    def test_planner_open_questions_stops_before_build(self):
        def respond(role, _call, _calls):
            if role == "planner":
                return {
                    "overview": "Needs clarification",
                    "risks": [],
                    "risk": "low",
                    "surfaces": [],
                    "questions": [{"question": "Should --json pretty-print?", "why": "Ambiguous", "criteria": ["C1"]}],
                    "specs": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], ["planner"])
        self.assertEqual(len(r["state"]["questions"]), 1)

    def test_planner_without_questions_builds_normally(self):
        r = asyncio.run(run_workflow(base_args()))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertEqual(r["state"]["questions"], [])
        self.assertIn("build S1", r["roles"])

    def test_questions_only_runs_planner_alone_returns_ready(self):
        r = asyncio.run(run_workflow({
            "repo": "/repo",
            "base": "abc1234",
            "roles": {"planner": "/roles/planner.md"},
            "contract": BASE_CONTRACT,
            "questionsOnly": True,
        }))
        self.assertEqual(r["state"]["outcome"], "ready")
        self.assertEqual(r["roles"], ["planner"])

    def test_questions_only_returns_questions_as_blocked(self):
        def respond(role, _call, _calls):
            if role == "planner":
                return {
                    "overview": "Needs answer",
                    "risks": [],
                    "risk": "low",
                    "surfaces": [],
                    "questions": [{"question": "Exit code on empty?", "why": "Unclear", "criteria": ["C1"]}],
                    "specs": [],
                }
            return None

        r = asyncio.run(run_workflow({
            "repo": "/repo",
            "base": "abc1234",
            "roles": {"planner": "/roles/planner.md"},
            "contract": BASE_CONTRACT,
            "questionsOnly": True,
        }, respond))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], ["planner"])
        self.assertEqual(len(r["state"]["questions"]), 1)

    def test_questions_only_refuses_supplied_specs(self):
        r = asyncio.run(run_workflow({
            "repo": "/repo",
            "base": "abc1234",
            "roles": {"planner": "/roles/planner.md"},
            "contract": BASE_CONTRACT,
            "questionsOnly": True,
            "specs": [make_spec()],
        }))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertIn("questionsOnly", r["state"]["reason"])
        self.assertEqual(r["roles"], [])

    def test_low_risk_single_reviewer_on_flash_even_when_split(self):
        two = [
            make_spec(id="S1", criteria=["C1"], filesOwned=["src/a.py"], testFiles=["tests/test_a.py"]),
            make_spec(id="S2", criteria=["C2"], filesOwned=["src/b.py"], testFiles=["tests/test_b.py"]),
        ]

        def respond(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "low", "surfaces": [], "questions": [], "specs": two}
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertNotIn("review S1", r["roles"])
        self.assertNotIn("review S2", r["roles"])
        self.assertEqual(r["by_role"]["reviewer"][0]["model"], "gemini-4-carbon-medium")

    def test_medium_risk_split_keeps_spec_reviewers_and_pro_reviewer(self):
        two = [
            make_spec(id="S1", criteria=["C1"], filesOwned=["src/a.py"], testFiles=["tests/test_a.py"]),
            make_spec(id="S2", criteria=["C2"], filesOwned=["src/b.py"], testFiles=["tests/test_b.py"]),
        ]

        def respond(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "medium", "surfaces": [], "questions": [], "specs": two}
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertEqual(r["by_role"]["reviewer"][0]["model"], "gemini-4-neon-high")
        self.assertEqual(r["by_role"]["review S1"][0]["model"], "gemini-4-carbon-medium")
        self.assertEqual(r["by_role"]["review S2"][0]["model"], "gemini-4-carbon-medium")

    def test_auth_files_raise_low_risk_to_high(self):
        two = [
            make_spec(id="S1", criteria=["C1"], filesOwned=["src/auth/login.ts"], testFiles=["tests/test_a.py"]),
            make_spec(id="S2", criteria=["C2"], filesOwned=["src/b.py"], testFiles=["tests/test_b.py"]),
        ]

        def respond(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "low", "surfaces": [], "questions": [], "specs": two}
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertEqual(r["state"]["risk"]["risk"], "high")
        self.assertIn("security", r["state"]["risk"]["surfaces"])
        self.assertEqual(r["by_role"]["reviewer"][0]["model"], "gemini-4-neon-xhigh")
        self.assertEqual(r["by_role"]["review S1"][0]["model"], "gemini-4-neon-high")
        self.assertEqual(r["by_role"]["review S2"][0]["model"], "gemini-4-neon-high")
        self.assertIn("pr-security-review", r["by_role"]["reviewer"][0]["prompt"])
        self.assertEqual(r["state"]["merge"]["decision"], "person")

    def test_caller_models_override_routing(self):
        def respond(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "low", "surfaces": [], "questions": [], "specs": [make_spec()]}
            return None

        r = asyncio.run(run_workflow(base_args(models={"reviewer": {"model": "gemini-4-hydrogen-high"}}), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertEqual(r["by_role"]["reviewer"][0]["model"], "gemini-4-hydrogen-high")

    def test_plain_passing_change_auto_merges(self):
        r = asyncio.run(run_workflow(base_args()))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertEqual(r["state"]["merge"]["decision"], "auto")
        self.assertIn("without a person", r["state"]["reason"])

    def test_dependency_change_waits_for_person(self):
        pkg_spec = make_spec(filesOwned=["package.json", "src/cli.py"], testFiles=["tests/test_cli.py"])

        def respond(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "low", "surfaces": [], "questions": [], "specs": [pkg_spec]}
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertEqual(r["state"]["merge"]["decision"], "person")
        self.assertTrue(any("package.json" in reason for reason in r["state"]["merge"]["reasons"]))

    def test_protected_file_disallowed_unless_allow_protected(self):
        ci_spec = make_spec(filesOwned=[".github/workflows/ci.yml"])

        def respond(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "low", "surfaces": [], "questions": [], "specs": [ci_spec]}
            return None

        blocked = asyncio.run(run_workflow(base_args(maxSpecRevisions=0), respond))
        self.assertEqual(blocked["state"]["outcome"], "blocked")
        self.assertIn("protected", blocked["state"]["reason"].lower())

        allowed = asyncio.run(run_workflow(base_args(allowProtected=[".github/workflows/ci.yml"]), respond))
        self.assertEqual(allowed["state"]["outcome"], "passed")

    def test_protected_file_changed_outside_spec_stops_run_even_when_ignored(self):
        def respond(role, _call, _calls):
            if role == "checker":
                return {
                    "results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": "ok"}],
                    "changedFiles": ["src/cli.py", "tests/test_cli.py", ".github/workflows/ci.yml"],
                    "baseRuns": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(ignoreFiles=[".github/workflows/ci.yml"]), respond))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertIn("Protected files were changed", r["state"]["reason"])

    def test_factory_workspace_artifacts_never_block_and_allow_protected_true_or_env(self):
        def respond_factory_artifacts(role, _call, _calls):
            if role == "checker":
                return {
                    "results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": "ok"}],
                    "changedFiles": [
                        "src/cli.py",
                        "tests/test_cli.py",
                        ".factory/decisions.md",
                        ".factory/plans/2026-11-25-landing-demo-ba.json",
                        ".factory/product.md",
                    ],
                    "baseRuns": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(), respond_factory_artifacts))
        self.assertEqual(r["state"]["outcome"], "passed")

        ci_spec = make_spec(filesOwned=[".github/workflows/ci.yml", "src/cli.py"])

        def respond_ci(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "low", "surfaces": [], "questions": [], "specs": [ci_spec]}
            if role == "checker":
                return {
                    "results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": "ok"}],
                    "changedFiles": [".github/workflows/ci.yml", "src/cli.py", "tests/test_cli.py"],
                    "baseRuns": [],
                }
            return None

        r_true = asyncio.run(run_workflow(base_args(allowProtected=True), respond_ci))
        self.assertEqual(r_true["state"]["outcome"], "passed")

        prev_env = os.environ.get("FACTORY_ALLOW_PROTECTED")
        os.environ["FACTORY_ALLOW_PROTECTED"] = "1"
        try:
            r_env = asyncio.run(run_workflow(base_args(), respond_ci))
            self.assertEqual(r_env["state"]["outcome"], "blocked")
            self.assertIn(".github/workflows/ci.yml", r_env["state"]["reason"])
        finally:
            if prev_env is None:
                os.environ.pop("FACTORY_ALLOW_PROTECTED", None)
            else:
                os.environ["FACTORY_ALLOW_PROTECTED"] = prev_env

    def test_project_profile_reaches_agents_not_qc(self):
        skills = {**ALL_SKILLS, "fastapi-patterns": "/s/fastapi-patterns/SKILL.md"}
        r = asyncio.run(run_workflow(base_args(
            skills=skills,
            projectDocs={"agents": "GEMINI.md", "product": "docs/product.md", "decisions": "DECISIONS.md"},
            projectStack={"languages": ["Python"], "frameworks": ["FastAPI"], "packageManager": "uv"},
            projectSkills={"planner": ["fastapi-patterns"], "implementer": ["fastapi-patterns"], "reviewer": ["fastapi-patterns"]},
        )))
        self.assertEqual(r["state"]["outcome"], "passed")
        for role in ("planner", "build S1", "reviewer"):
            prompt = r["by_role"][role][0]["prompt"]
            self.assertIn("GEMINI.md", prompt)
            self.assertIn("FastAPI", prompt)
            self.assertIn("fastapi-patterns", prompt)
        qc_prompt = r["by_role"]["qc"][0]["prompt"]
        self.assertNotIn("GEMINI.md", qc_prompt)
        self.assertNotIn("FastAPI", qc_prompt)
        self.assertNotIn("fastapi-patterns", qc_prompt)

    def test_missing_stack_skill_blocks_before_any_agent(self):
        r = asyncio.run(run_workflow(base_args(projectSkills={"implementer": ["missing-stack-skill"]})))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], [])
        self.assertIn("missing-stack-skill", r["state"]["reason"])

    def test_design_reaches_implementer_and_qc_and_screen_differs_rebuilds(self):
        contract = {
            **BASE_CONTRACT,
            "design": {
                "doc": "DESIGN.md",
                "tokens": "src/tokens.css",
                "uiStore": "docs/ui",
                "reuse": ["components/Table"],
                "screens": [{"screen": "Orders", "criteria": ["C1"], "mockup": "docs/mockups/orders.png", "states": ["empty"]}],
            },
        }

        def respond(role, _call, _calls):
            if role == "qc":
                return {
                    "status": "done",
                    "blockedReason": "",
                    "startedWith": "npm run dev",
                    "criteria": [
                        {"id": c["id"], "status": "pass", "scenario": "s", "expected": "e", "observed": "o", "steps": ["open"]}
                        for c in contract["criteria"]
                    ],
                    "screens": [{"screen": "Orders", "screenshot": "/tmp/orders.png", "status": "differs", "differences": ["Button misaligned"]}],
                    "baseline": [],
                    "a11y": [],
                    "filesChanged": [],
                    "commandsRun": [],
                    "openIssues": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(contract=contract, browser="playwright"), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertIn("docs/mockups/orders.png", r["by_role"]["build S1"][0]["prompt"])
        self.assertIn("DESIGN.md", r["by_role"]["build S1"][0]["prompt"])
        self.assertIn("docs/mockups/orders.png", r["by_role"]["qc"][0]["prompt"])
        self.assertIn("rebuild 1 S1", r["roles"])

    def test_qc_uses_browser_mcp_tools_and_writes_no_script(self):
        contract = {
            **BASE_CONTRACT,
            "design": {
                "doc": "DESIGN.md",
                "screens": [{"screen": "Orders", "criteria": ["C1"], "mockup": "docs/mockups/orders.png", "states": []}],
            },
        }
        r = asyncio.run(run_workflow(base_args(contract=contract, browser="playwright")))
        qc_prompt = r["by_role"]["qc"][0]["prompt"]
        self.assertIn('server "playwright"', qc_prompt)
        self.assertIn("browser_navigate", qc_prompt)
        self.assertIn("browser_click", qc_prompt)
        self.assertIn("Write no browser script", qc_prompt)
        self.assertNotIn("mcp__", qc_prompt)
        self.assertNotIn(".mcp.json", qc_prompt)

    def test_screens_without_browser_blocks_before_any_agent(self):
        contract = {
            **BASE_CONTRACT,
            "design": {
                "doc": "DESIGN.md",
                "screens": [{"screen": "Orders", "criteria": ["C1"], "mockup": "docs/mockups/orders.png", "states": []}],
            },
        }
        r = asyncio.run(run_workflow(base_args(contract=contract)))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], [])
        self.assertIn("browser MCP server", r["state"]["reason"])

    def test_planner_ui_surface_without_browser_stops_before_build(self):
        def respond(role, _call, _calls):
            if role == "planner":
                return {"overview": "o", "risks": [], "risk": "low", "surfaces": ["ui"], "questions": [], "specs": [make_spec()]}
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], ["planner"])
        self.assertIn("browser MCP server", r["state"]["reason"])

    def test_coding_standards_reach_agents_and_broken_blocking_rule_rebuilds(self):
        contract = {
            **BASE_CONTRACT,
            "checks": [
                {"name": "test", "command": "run-tests"},
                {"name": "lint", "command": "npm run lint"},
            ],
            "standards": {
                "file": "CODING_STANDARDS.md",
                "rules": [
                    {"id": "S1", "text": "Lint passes cleanly.", "severity": "blocking", "enforced": "tool", "check": "lint"},
                    {"id": "S2", "text": "Errors are never swallowed.", "severity": "blocking", "enforced": "review"},
                    {"id": "S3", "text": "Names stay clear.", "severity": "minor", "enforced": "review"},
                ],
            },
        }

        def respond(role, _call, _calls):
            if role == "reviewer":
                return {
                    "criteria": [{"id": c["id"], "status": "met", "evidence": "ok"} for c in contract["criteria"]],
                    "findings": [],
                    "standards": [
                        {"id": "S2", "status": "fail", "file": "src/cli.py", "line": 12, "evidence": "empty catch"},
                        {"id": "S3", "status": "pass", "file": "", "line": 0, "evidence": "ok"},
                    ],
                    "notReviewed": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(contract=contract), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertIn("Errors are never swallowed", r["by_role"]["build S1"][0]["prompt"])
        self.assertIn("Errors are never swallowed", r["by_role"]["reviewer"][0]["prompt"])
        self.assertIn("rebuild 1 S1", r["roles"])
        self.assertEqual(
            [[x["id"], x["status"]] for x in r["state"]["standards"]],
            [["S1", "pass"], ["S2", "pass"], ["S3", "pass"]],
        )

    def test_tool_rule_missing_check_blocks_before_any_agent(self):
        contract = {
            **BASE_CONTRACT,
            "standards": {
                "file": "CODING_STANDARDS.md",
                "rules": [{"id": "S1", "text": "Lint clean", "severity": "blocking", "enforced": "tool", "check": "lint"}],
            },
        }
        r = asyncio.run(run_workflow(base_args(contract=contract)))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], [])
        self.assertIn('check "lint" is not one of the contract\'s checks', r["state"]["reason"])

    def test_mockup_url_blocks_run(self):
        contract = {
            **BASE_CONTRACT,
            "design": {
                "doc": "DESIGN.md",
                "screens": [{"screen": "Orders", "criteria": ["C1"], "mockup": "https://www.figma.com/design/abc", "states": []}],
            },
        }
        r = asyncio.run(run_workflow(base_args(contract=contract, browser="playwright")))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], [])
        self.assertIn("is a link (https://www.figma.com/design/abc)", r["state"]["reason"])

    def test_flaky_check_does_not_rebuild_and_is_reported(self):
        def respond(role, _call, _calls):
            if role == "checker":
                return {
                    "results": [{"name": "test", "command": "run-tests", "exitCode": 1, "rerunExitCode": 0, "outputTail": "flaked"}],
                    "changedFiles": ["src/cli.py", "tests/test_cli.py"],
                    "baseRuns": [],
                }
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertNotIn("rebuild 1 S1", r["roles"])
        self.assertEqual([f["name"] for f in r["state"]["flaky"]], ["test"])
        self.assertIn("Flaky", r["state"]["reason"])

    def test_tdd_tests_pass_on_base_send_spec_back(self):
        contract = {**BASE_CONTRACT, "testFileCommand": "pytest {files}"}

        def respond(role, _call, _calls):
            if role == "checker":
                return {
                    "results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": "ok"}],
                    "changedFiles": ["src/cli.py", "tests/test_cli.py"],
                    "baseRuns": [{"spec": "S1", "files": ["tests/test_cli.py"], "command": "pytest tests/test_cli.py", "exitCode": 0, "outputTail": "1 passed"}],
                }
            if role == "checker (round 1)":
                return {
                    "results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": "ok"}],
                    "changedFiles": ["src/cli.py", "tests/test_cli.py"],
                    "baseRuns": [{"spec": "S1", "files": ["tests/test_cli.py"], "command": "pytest tests/test_cli.py", "exitCode": 1, "outputTail": "1 failed"}],
                }
            return None

        r = asyncio.run(run_workflow(base_args(contract=contract), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertNotIn("reviewer", r["roles"])
        self.assertIn("rebuild 1 S1", r["roles"])
        self.assertIn("checker (round 1)", r["roles"])

    def test_without_test_file_command_no_base_run_required(self):
        r = asyncio.run(run_workflow(base_args()))
        self.assertEqual(r["state"]["outcome"], "passed")
        self.assertNotIn("git worktree add", r["by_role"]["checker"][0]["prompt"])
        self.assertEqual(r["state"]["tddUnproven"], [])

    def test_dashboard_writes_live_js_directly_without_spawning_recorder(self):
        with tempfile.TemporaryDirectory() as tmp:
            live = Path(tmp) / "live.js"
            r = asyncio.run(run_workflow(base_args(dashboard={"file": str(live), "id": "r1", "title": "Demo"})))
            self.assertEqual(r["state"]["outcome"], "passed")
            self.assertNotIn("recorder", r["roles"])
            text = live.read_text(encoding="utf-8")
            self.assertTrue(text.startswith("window.FACTORY_LIVE = "))
            payload = json.loads(text[len("window.FACTORY_LIVE = "):].strip().rstrip(";"))
            self.assertEqual(payload["id"], "r1")
            self.assertEqual(payload["title"], "Demo")
            self.assertEqual(payload["outcome"], "passed")

    def test_per_run_state_and_events_written_even_without_dashboard_arg(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = asyncio.run(
                run_workflow(
                    base_args(
                        repo=tmp,
                        runId="2026-11-26-i1-test",
                        issueKey="I1",
                    )
                )
            )
            self.assertEqual(r["state"]["outcome"], "passed")
            run_dir = Path(tmp) / ".factory" / "runs" / "2026-11-26-i1-test"
            state_file = run_dir / "state.json"
            events_file = run_dir / "events.jsonl"
            self.assertTrue(state_file.exists(), "expected per-run state.json to be written")
            self.assertTrue(events_file.exists(), "expected per-run events.jsonl to be written")

            snapshot = json.loads(state_file.read_text(encoding="utf-8"))
            self.assertEqual(snapshot["id"], "2026-11-26-i1-test")
            self.assertEqual(snapshot["issueKey"], "I1")
            self.assertEqual(snapshot["outcome"], "passed")
            self.assertIn("updatedAt", snapshot)

            events = [
                json.loads(line)
                for line in events_file.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            event_types = [ev["event"] for ev in events]
            self.assertIn("agent_start", event_types)
            self.assertIn("agent_done", event_types)
            self.assertIn("phase_state", event_types)
            final_phase = [ev for ev in events if ev["event"] == "phase_state"][-1]
            self.assertEqual(final_phase["outcome"], "passed")
            self.assertTrue(
                any(ev["event"] == "agent_start" and ev["role"] == "planner" for ev in events)
            )

    def test_factory_prototypes_ignored_as_workspace_artifacts(self):
        self.assertEqual(
            h.files_outside_ownership(
                [".factory/prototypes/task-list-i1/index.html", ".factory/runs/r1/state.json", "src/a.js"],
                [{"filesOwned": ["src/a.js"], "testFiles": []}],
                [],
            ),
            [],
        )

    def test_workflow_never_runs_ba_inside_build_loop(self):
        args = base_args(
            idea="Build a landing page for NovaPulse AI devtool",
            autoBa=True,
            contract={
                "criteria": [
                    {"id": "C1", "text": "Hero section renders CTA"},
                ],
                "checks": [{"name": "test", "command": "run-tests"}],
            },
        )
        r = asyncio.run(run_workflow(args))
        self.assertEqual(r["state"]["outcome"], "blocked")
        self.assertEqual(r["roles"], [])
        self.assertIn("contract.objective", r["state"]["reason"])

    def test_model_profile_end_to_end_and_rejects_invalid(self):
        bad = asyncio.run(run_workflow(base_args(modelProfile="invalid-tier", qc=False)))
        self.assertEqual(bad["state"]["outcome"], "blocked")
        self.assertIn("modelProfile", bad["state"]["reason"])
        self.assertEqual(bad["roles"], [])

        fast = asyncio.run(run_workflow({
            "repo": "/repo",
            "base": "abc1234",
            "roles": {"planner": "/roles/planner.md"},
            "contract": BASE_CONTRACT,
            "questionsOnly": True,
            "modelProfile": "fast",
        }))
        self.assertEqual(fast["state"]["outcome"], "ready")
        self.assertEqual(fast["by_role"]["planner"][0]["model"], "gemini-4-carbon-high")

        orch = asyncio.run(run_workflow({
            "repo": "/repo",
            "base": "abc1234",
            "roles": {"planner": "/roles/planner.md"},
            "contract": BASE_CONTRACT,
            "questionsOnly": True,
            "modelProfile": "orchestrator",
        }))
        self.assertEqual(orch["state"]["outcome"], "ready")
        self.assertEqual(orch["by_role"]["planner"][0]["model"], "gemini-pro-orchestrator-neon")

        flagship = asyncio.run(run_workflow(base_args(modelProfile="flagship", models={"checker": {"model": "gemini-4-hydrogen-low"}})))
        self.assertEqual(flagship["state"]["outcome"], "passed")
        self.assertEqual(flagship["by_role"]["build S1"][0]["model"], "gemini-4-neon-high")
        self.assertEqual(flagship["by_role"]["qa S1"][0]["model"], "gemini-4-neon-high")
        self.assertEqual(flagship["by_role"]["checker"][0]["model"], "gemini-4-hydrogen-low")
        self.assertEqual(flagship["by_role"]["qc"][0]["model"], "gemini-4-carbon-high")

    def test_tier_only_runner_falls_back_gracefully_from_gemini_4_ids(self):
        tiers = {"inherit", "flash_lite", "flash", "pro"}

        def respond(role, call, _calls):
            model = call.get("model")
            if model and model not in tiers:
                raise ValueError(f"Invalid model '{model}': must be one of inherit, flash_lite, flash, pro")
            if role == "planner":
                return {
                    "overview": "o",
                    "risks": [],
                    "risk": "medium",
                    "surfaces": [],
                    "questions": [],
                    "specs": [make_spec()],
                }
            return None

        r = asyncio.run(run_workflow(base_args(), respond))
        self.assertEqual(r["state"]["outcome"], "passed")
        # Planner tried gemini-4-neon-xhigh first, rejected, then retried on pro; subsequent roles went straight to tiers
        self.assertEqual([c["model"] for c in r["by_role"]["planner"]], ["gemini-4-neon-xhigh", "pro"])
        self.assertEqual([c["model"] for c in r["by_role"]["build S1"]], ["flash"])
        self.assertEqual([c["model"] for c in r["by_role"]["qa S1"]], ["flash"])
        self.assertEqual([c["model"] for c in r["by_role"]["checker"]], ["flash_lite"])
        self.assertEqual([c["model"] for c in r["by_role"]["reviewer"]], ["pro"])
        self.assertEqual([c["model"] for c in r["by_role"]["qc"]], ["flash_lite"])

    def test_checker_hallucinated_changed_files_overridden_by_real_git_diff(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            env = {
                **os.environ,
                "GIT_AUTHOR_NAME": "Test",
                "GIT_AUTHOR_EMAIL": "test@example.com",
                "GIT_COMMITTER_NAME": "Test",
                "GIT_COMMITTER_EMAIL": "test@example.com",
            }
            subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True, env=env)
            (repo / "src").mkdir()
            (repo / "tests").mkdir()
            (repo / "src" / "cli.py").write_text("print('base')\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(repo), "add", "."], check=True, env=env)
            subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", "base"], check=True, env=env)
            base_sha = subprocess.check_output(
                ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True, env=env
            ).strip()

            # Modify only owned files on disk
            (repo / "src" / "cli.py").write_text("print('changed')\n", encoding="utf-8")
            (repo / "tests" / "test_cli.py").write_text("assert True\n", encoding="utf-8")

            def respond_hallucinated(role, _call, _calls):
                if role == "checker":
                    return {
                        "results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": "ok"}],
                        "changedFiles": ["src/cli.py", "tests/test_cli.py", "test/account-customer-store.test.js"],
                        "baseRuns": [],
                    }
                return None

            ok = asyncio.run(
                run_workflow(
                    base_args(repo=str(repo), base=base_sha, specs=[make_spec()]),
                    respond_hallucinated,
                )
            )
            self.assertEqual(ok["state"]["outcome"], "passed", ok["state"]["reason"])
            self.assertEqual(sorted(ok["state"]["check"]["changedFiles"]), ["src/cli.py", "tests/test_cli.py"])
            self.assertTrue(any("differed from git" in msg for msg in ok["logs"]))

            # Conversely, an actual unowned file on disk is caught from git even if checker omits it
            (repo / "stray.py").write_text("x = 1\n", encoding="utf-8")

            def respond_omitted(role, _call, _calls):
                if role == "checker":
                    return {
                        "results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": "ok"}],
                        "changedFiles": ["src/cli.py", "tests/test_cli.py"],
                        "baseRuns": [],
                    }
                return None

            blocked = asyncio.run(
                run_workflow(
                    base_args(repo=str(repo), base=base_sha, specs=[make_spec()]),
                    respond_omitted,
                )
            )
            self.assertEqual(blocked["state"]["outcome"], "blocked")
            self.assertIn("stray.py", blocked["state"]["reason"])


if __name__ == "__main__":
    unittest.main()
