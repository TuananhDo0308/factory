"""Tests for pure helpers of factory/workflow/factory.py."""

import ast
import asyncio
import json
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
    return mod


h = load_factory_module()

CONTRACT = {
    "objective": "o",
    "criteria": [{"id": "C1", "text": "one"}, {"id": "C2", "text": "two"}],
    "outOfScope": [],
    "checks": [{"name": "test", "command": "run-tests"}],
}


def make_spec(**over):
    s = {
        "id": "S1",
        "title": "t",
        "goal": "g",
        "kind": "feature",
        "skills": [],
        "criteria": ["C1", "C2"],
        "dependsOn": [],
        "filesOwned": ["a.py"],
        "testFiles": ["tests/test_a.py"],
        "context": "",
        "interfaces": "f(x)",
        "changes": "c",
        "tests": "tt",
        "outOfScope": "",
        "doneWhen": ["x"],
    }
    s.update(over)
    return s


TWO = [
    make_spec(id="S1", criteria=["C1"]),
    make_spec(id="S2", criteria=["C2"], dependsOn=["S1"], filesOwned=["b.py"], testFiles=["tests/test_b.py"]),
]

GOOD_REVIEW = {
    "criteria": [{"id": "C1", "status": "met", "evidence": "e"}, {"id": "C2", "status": "met", "evidence": "e"}],
    "findings": [],
    "notReviewed": [],
}
GOOD_CHECK = {"results": [{"name": "test", "command": "run-tests", "exitCode": 0, "outputTail": ""}], "changedFiles": []}

GOOD_QC = {
    "status": "done",
    "criteria": [
        {"id": "C1", "status": "pass", "scenario": "s", "expected": "e", "observed": "o"},
        {"id": "C2", "status": "not_observable", "scenario": "about the code", "expected": "", "observed": ""},
    ],
    "filesChanged": [],
}

DESIGNED = {
    "objective": "o",
    "criteria": [{"id": "C1", "text": "one"}, {"id": "C2", "text": "two"}],
    "outOfScope": [],
    "checks": [],
    "design": {
        "doc": "DESIGN.md",
        "tokens": "src/tokens.css",
        "uiStore": "docs/ui",
        "reuse": ["components/DataTable"],
        "screens": [
            {"screen": "Orders", "criteria": ["C1"], "mockup": "docs/mockups/orders.png", "states": ["empty", "mobile-390"]},
            {"screen": "Export", "criteria": ["C2"], "mockup": "docs/mockups/export.png", "states": []},
        ],
    },
}

STANDARDS = {
    "file": "CODING_STANDARDS.md",
    "rules": [
        {"id": "S1", "text": "Lint passes with no warning.", "severity": "blocking", "enforced": "tool", "check": "lint"},
        {"id": "S2", "text": "Errors are handled or passed on, never swallowed.", "severity": "blocking", "enforced": "review"},
        {"id": "S3", "text": "Names say what a thing is.", "severity": "minor", "enforced": "review"},
    ],
}
WITH_STANDARDS = {
    **CONTRACT,
    "checks": [*CONTRACT["checks"], {"name": "lint", "command": "eslint ."}],
    "standards": STANDARDS,
}


class TestFactoryHelpers(unittest.TestCase):
    def test_validate_specs_accepts_usable_set(self):
        self.assertEqual(h.validate_specs([make_spec()], CONTRACT), [])
        self.assertEqual(h.validate_specs(TWO, CONTRACT), [])

    def test_validate_specs_rejects_what_planner_brief_says(self):
        def has(specs, substr):
            probs = h.validate_specs(specs, CONTRACT)
            self.assertTrue(any(substr in p for p in probs), f"expected {substr!r} in {probs}")

        has([], "No specs")
        has([make_spec(criteria=["C1"])], "C2 is not covered")
        has([make_spec(criteria=["C1", "C2", "C9"])], "C9, which is not in the contract")
        has([make_spec(filesOwned=[], testFiles=[])], "owns no files")
        has([make_spec(testFiles=["./a.py"])], "both filesOwned and testFiles")
        has([TWO[0], {**TWO[1], "filesOwned": ["a.py"]}], "owned by both S1 and S2")
        has([TWO[0], {**TWO[1], "testFiles": ["tests/test_a.py"]}], "owned by both S1 and S2")
        has([make_spec(dependsOn=["S7"])], "S7, which does not exist")
        has([make_spec(dependsOn=["S1"])], "depends on itself")
        has([{**TWO[0], "dependsOn": ["S2"]}, TWO[1]], "cycle")
        has([make_spec(), make_spec()], "used more than once")
        has([make_spec(changes="")], '"changes" is empty')

    def test_spec_only_tests_and_no_tests_allowed(self):
        self.assertEqual(h.validate_specs([make_spec(filesOwned=[], changes="", doneWhen=[])], CONTRACT), [])
        self.assertEqual(h.validate_specs([make_spec(testFiles=[])], CONTRACT), [])

    def test_build_levels_and_cycle(self):
        self.assertEqual([[s["id"] for s in lvl] for lvl in h.build_levels(TWO)], [["S1"], ["S2"]])
        self.assertIsNone(h.build_levels([{"id": "A", "dependsOn": ["B"]}, {"id": "B", "dependsOn": ["A"]}]))
        self.assertEqual(len(h.build_levels([{"id": "A"}, {"id": "B"}])), 1)

    def test_matches_ignore(self):
        self.assertTrue(h.matches_ignore("build/out.js", "build"))
        self.assertTrue(h.matches_ignore("build/out.js", "build/"))
        self.assertFalse(h.matches_ignore("builder/out.js", "build"))
        self.assertTrue(h.matches_ignore("a/b/x.pyc", "*.pyc"))
        self.assertTrue(h.matches_ignore("a/__pycache__/x", "**/__pycache__"))
        self.assertFalse(h.matches_ignore("a/b", ""))

    def test_ownership_stray_caches_ignored(self):
        changed = ["a.py", "tests/test_a.py", "other.py", "tests/__pycache__/x.pyc", "wip.txt"]
        self.assertEqual(h.files_outside_ownership(changed, [make_spec()], ["wip.txt"]), ["other.py"])
        self.assertEqual(h.files_outside_assignment(["./a.py", "b.py"], ["a.py"], "/repo"), ["b.py"])
        self.assertEqual(
            h.files_outside_assignment(["/repo/a.py", "/elsewhere/a.py"], ["a.py"], "/repo"),
            ["/elsewhere/a.py"],
        )

    def test_implementer_and_qa_file_permissions(self):
        s = make_spec()
        self.assertEqual(h.spec_files(s), ["a.py", "tests/test_a.py"])
        self.assertEqual(h.files_outside_assignment(["a.py", "tests/test_a.py"], h.spec_files(s), "/repo"), [])
        self.assertEqual(h.files_outside_assignment(["a.py"], s["testFiles"], "/repo"), ["a.py"])

    def test_tests_changed(self):
        s = make_spec()
        self.assertEqual(
            h.tests_changed(["a.py", "/repo/tests/test_a.py", "./tests/test_a.py"], s, "/repo"),
            ["tests/test_a.py"],
        )
        self.assertEqual(h.tests_changed(["a.py"], s, "/repo"), [])
        self.assertEqual(h.tests_changed(None, s, "/repo"), [])

    def test_evaluate_clean_and_failures(self):
        self.assertEqual(h.evaluate(CONTRACT, GOOD_CHECK, GOOD_REVIEW, []), [])
        kinds = lambda c, r, sr=None: [f["kind"] for f in h.evaluate(CONTRACT, c, r, sr or [])]
        self.assertEqual(kinds({"results": []}, GOOD_REVIEW), ["check"])
        self.assertEqual(kinds({"results": [{"name": "test", "exitCode": 1, "outputTail": "x"}]}, GOOD_REVIEW), ["check"])
        self.assertEqual(kinds(GOOD_CHECK, {"criteria": [GOOD_REVIEW["criteria"][0]], "findings": []}), ["criterion"])
        self.assertEqual(
            kinds(GOOD_CHECK, {**GOOD_REVIEW, "criteria": [GOOD_REVIEW["criteria"][0], {"id": "C2", "status": "unknown", "evidence": ""}]}),
            ["criterion"],
        )
        self.assertEqual(
            kinds(GOOD_CHECK, {**GOOD_REVIEW, "findings": [{"severity": "minor", "file": "a.py", "line": 1, "problem": "p"}]}),
            [],
        )
        self.assertEqual(
            kinds(GOOD_CHECK, {**GOOD_REVIEW, "findings": [{"severity": "blocking", "file": "a.py", "line": 1, "problem": "p"}]}),
            ["finding"],
        )

    def test_evaluate_spec_reviewer_can_fail(self):
        spec_reviews = [{"spec": TWO[0], "review": {"criteria": [{"id": "C1", "status": "not_met", "evidence": "e"}], "findings": []}}]
        failures = h.evaluate(CONTRACT, GOOD_CHECK, GOOD_REVIEW, spec_reviews)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["spec"], "S1")

    def test_evaluate_qc_failures(self):
        self.assertEqual(h.evaluate(CONTRACT, GOOD_CHECK, GOOD_REVIEW, [], GOOD_QC), [])
        self.assertEqual(h.evaluate(CONTRACT, GOOD_CHECK, GOOD_REVIEW, [], None), [])
        failing = {
            **GOOD_QC,
            "criteria": [{"id": "C1", "status": "fail", "scenario": "ran wc --json a.txt", "expected": "JSON", "observed": "usage error"}],
        }
        failures = h.evaluate(CONTRACT, GOOD_CHECK, GOOD_REVIEW, [], failing)
        self.assertEqual([[f["kind"], f["id"]] for f in failures], [["qc", "C1"], ["qc", "C2"]])
        self.assertIn("Scenario: ran wc --json a.txt Expected: JSON Observed: usage error", failures[0]["problem"])
        self.assertIn("C2 was not judged by QC", failures[1]["problem"])

    def test_check_failures(self):
        self.assertEqual(h.check_failures(CONTRACT, GOOD_CHECK), [])
        self.assertEqual([f["kind"] for f in h.check_failures(CONTRACT, {"results": [{"name": "test", "exitCode": 2}]})], ["check"])

    def test_route_failures_and_failure_entries_qc(self):
        f = {"kind": "qc", "id": "C2", "problem": "p"}
        groups = h.route_failures([f], TWO)
        self.assertEqual([g["spec"]["id"] for g in groups], ["S2"])
        entries = h.failure_entries(groups, {"stage": "review", "round": 1, "sentBack": True})
        self.assertEqual(
            entries,
            [{"stage": "review", "round": 1, "kind": "qc", "specs": ["S2"], "criterion": "C2", "problem": "p", "sentBack": True}],
        )

    def test_qc_text(self):
        text = h.qc_text({**CONTRACT, "run": "python3 wordstats.py FILE"})
        self.assertIn("- C1: one", text)
        self.assertIn("How to run the product:\npython3 wordstats.py FILE", text)
        self.assertNotIn("run-tests", text)
        self.assertIn("Not given. Find out from the repository's README", h.qc_text(CONTRACT))

    def test_needs_browser_and_browser_problem(self):
        screens = {**CONTRACT, "design": {"screens": [{"screen": "S", "criteria": ["C1"], "mockup": "m.png"}]}}
        baseline = {**CONTRACT, "design": {"baseline": [{"screen": "Home", "route": "/", "before": ["b.png"]}]}}
        self.assertFalse(h.needs_browser(CONTRACT, []))
        self.assertTrue(h.needs_browser(CONTRACT, ["ui"]))
        self.assertTrue(h.needs_browser(screens, []))
        self.assertTrue(h.needs_browser(baseline, []))
        self.assertEqual(h.browser_problem(None, CONTRACT, [], True), "")
        self.assertIn("browser MCP server", h.browser_problem(None, screens, [], True))
        self.assertEqual(h.browser_problem("", CONTRACT, ["ui"], False), "")
        self.assertEqual(h.browser_problem("playwright", screens, ["ui"], True), "")
        self.assertIn("name of an MCP server", h.browser_problem("npx @playwright/mcp", CONTRACT, [], True))

    def test_browser_note(self):
        self.assertEqual(h.browser_note(""), "")
        note = h.browser_note("playwright")
        self.assertIn("browser_navigate", note)
        self.assertIn("browser_snapshot", note)
        self.assertIn("Write no browser script", note)
        self.assertIn("return `blocked`", note)
        self.assertNotIn("ToolSearch", note)
        self.assertNotIn("mcp__playwright__", note)

    def test_qc_line(self):
        self.assertEqual(h.qc_line(GOOD_QC), {"text": "1/2 criteria pass when used, 1 not observable", "state": "ok"})
        self.assertEqual(h.qc_line({"criteria": [{"id": "C1", "status": "fail"}]})["state"], "fail")
        self.assertEqual(h.qc_line({"criteria": []})["state"], "fail")
        blocked = h.qc_line({
            "status": "blocked",
            "blockedReason": "no browser tool",
            "criteria": [{"id": "C1", "status": "not_observable"}],
        })
        self.assertEqual(blocked["state"], "fail")
        self.assertIn("no browser tool", blocked["text"])

    def test_route_failures_by_file_and_criteria_and_check(self):
        groups = h.route_failures(
            [
                {"kind": "finding", "file": "b.py", "line": 1, "problem": "p"},
                {"kind": "finding", "file": "tests/test_b.py", "line": 1, "problem": "p"},
                {"kind": "finding", "file": "tests/test_a.py", "line": 1, "spec": "S2", "problem": "p"},
            ],
            TWO,
        )
        self.assertEqual([[g["spec"]["id"], len(g["failures"])] for g in groups], [["S1", 1], ["S2", 2]])

        whole = h.route_failures([{"kind": "criterion", "id": "C2", "problem": "p"}], TWO)
        self.assertEqual([g["spec"]["id"] for g in whole], ["S2"])
        judged = h.route_failures([{"kind": "criterion", "id": "C1", "spec": "S2", "problem": "p"}], TWO)
        self.assertEqual([g["spec"]["id"] for g in judged], ["S2"])

        named = h.route_failures([{"kind": "check", "name": "test", "problem": "p", "outputTail": "FAILED tests/test_b.py::test_x"}], TWO)
        self.assertEqual([g["spec"]["id"] for g in named], ["S2"])
        unnamed = h.route_failures([{"kind": "check", "name": "test", "problem": "p", "outputTail": "segfault"}], TWO)
        self.assertEqual([g["spec"]["id"] for g in unnamed], ["S1", "S2"])
        stray = h.route_failures([{"kind": "finding", "file": "nobody.py", "line": 1, "problem": "p"}], TWO)
        self.assertEqual([g["spec"]["id"] for g in stray], ["S1", "S2"])

    def test_route_failures_culprits(self):
        leak = "FAIL tests/test_a.py::t1\nFAIL tests/test_b.py::t2\nFAIL tests/old_test.py::t3"
        groups = h.route_failures(
            [{"kind": "check", "name": "test", "problem": "p", "outputTail": leak, "culprits": ["tests/test_b.py"]}],
            TWO,
            "/repo",
        )
        self.assertEqual([g["spec"]["id"] for g in groups], ["S2"])
        absolute = h.route_failures(
            [{"kind": "check", "name": "test", "problem": "p", "outputTail": "segfault", "culprits": ["/repo/tests/test_a.py"]}],
            TWO,
            "/repo",
        )
        self.assertEqual([g["spec"]["id"] for g in absolute], ["S1"])

        named = h.route_failures(
            [{"kind": "check", "name": "test", "problem": "p", "outputTail": "FAILED tests/test_b.py::test_x", "culprits": ["tests/old_test.py"]}],
            TWO,
            "/repo",
        )
        self.assertEqual([g["spec"]["id"] for g in named], ["S2"])
        unnamed = h.route_failures(
            [{"kind": "check", "name": "test", "problem": "p", "outputTail": "segfault", "culprits": ["tests/old_test.py"]}],
            TWO,
            "/repo",
        )
        self.assertEqual([g["spec"]["id"] for g in unnamed], ["S1", "S2"])

        for culprits in (None, []):
            groups = h.route_failures([{"kind": "check", "name": "test", "problem": "p", "outputTail": leak, "culprits": culprits}], TWO)
            self.assertEqual([g["spec"]["id"] for g in groups], ["S1", "S2"])

    def test_result_for(self):
        check = {"name": "ci-tests: Run unit tests", "command": "python3 -m unittest discover -s tests -v"}
        exact = {"name": "ci-tests: Run unit tests", "command": "other", "exitCode": 0}
        shortened = {"name": "ci-tests", "command": "python3  -m unittest discover -s tests -v ", "exitCode": 0}
        self.assertIs(h.result_for([shortened, exact], check), exact)
        self.assertIs(h.result_for([shortened], check), shortened)
        self.assertIsNone(h.result_for([{"name": "lint", "command": "ruff check .", "exitCode": 0}], check))
        self.assertIsNone(h.result_for(None, check))
        c_colon = {**CONTRACT, "checks": [check]}
        self.assertEqual(h.evaluate(c_colon, {"results": [shortened], "changedFiles": []}, GOOD_REVIEW, []), [])
        self.assertEqual(
            [f["problem"] for f in h.evaluate(c_colon, {"results": [], "changedFiles": []}, GOOD_REVIEW, [])],
            ['Check "ci-tests: Run unit tests" (python3 -m unittest discover -s tests -v) was not run.'],
        )

    def test_evaluate_culprits_carried(self):
        leak = "FAIL tests/test_a.py::t1\nFAIL tests/test_b.py::t2"
        check = {
            "results": [{"name": "test", "command": "run-tests", "exitCode": 1, "outputTail": leak, "culprits": ["./tests/test_b.py"], "culpritEvidence": "tests/test_a.py alone: pass"}],
            "changedFiles": [],
        }
        f = h.evaluate(CONTRACT, check, GOOD_REVIEW, [], None, "/repo")[0]
        self.assertEqual(f["culprits"], ["tests/test_b.py"])
        self.assertEqual(f["culpritEvidence"], "tests/test_a.py alone: pass")
        self.assertIn("tests/test_b.py", f["problem"])
        self.assertEqual([g["spec"]["id"] for g in h.route_failures([f], TWO, "/repo")], ["S2"])
        plain = h.evaluate(CONTRACT, {"results": [{**check["results"][0], "culprits": [], "culpritEvidence": "nothing found"}], "changedFiles": []}, GOOD_REVIEW, [])
        self.assertNotIn("culprits", plain[0])
        self.assertEqual(plain[0]["problem"], 'Check "test" (run-tests) exited with 1.')

    def test_isolation_text(self):
        text = h.isolation_text(TWO)
        self.assertIn("- S1: tests/test_a.py", text)
        self.assertIn("- S2: tests/test_b.py", text)
        self.assertIn(f"at most {h.MAX_ISOLATION_RUNS} extra runs", text)
        self.assertEqual(h.isolation_text([make_spec(testFiles=[])]), "")

    def test_failure_entries_and_truncation(self):
        failures = [
            {"kind": "check", "name": "test", "problem": 'Check "test" (run-tests) exited with 1.', "outputTail": "segfault"},
            {"kind": "criterion", "id": "C2", "problem": "Criterion C2 is not_met: e"},
            {"kind": "finding", "file": "./b.py", "line": 3, "spec": "S2", "problem": "p"},
        ]
        log = h.failure_entries(h.route_failures(failures, TWO), {"stage": "review", "round": 1, "sentBack": True})
        self.assertEqual(len(log), 3)
        self.assertEqual([e["kind"] for e in log], ["check", "criterion", "finding"])
        chk = next(e for e in log if e["kind"] == "check")
        self.assertEqual(chk["specs"], ["S1", "S2"])
        self.assertEqual(chk["check"], "test")
        self.assertNotIn("outputTail", chk)
        self.assertEqual(next(e for e in log if e["kind"] == "criterion")["criterion"], "C2")
        self.assertEqual(
            next(e for e in log if e["kind"] == "finding"),
            {"stage": "review", "round": 1, "kind": "finding", "specs": ["S2"], "file": "b.py", "line": 3, "problem": "p", "sentBack": True},
        )

        long_p = "x" * 1000
        e = h.failure_entries([{"spec": make_spec(), "failures": [{"kind": "qa", "file": "tests/test_a.py", "line": 1, "spec": "S1", "problem": long_p}]}], {"stage": "qa", "round": 2, "sentBack": False})[0]
        self.assertEqual(e["stage"], "qa")
        self.assertEqual(e["round"], 2)
        self.assertFalse(e["sentBack"])
        self.assertEqual(len(e["problem"]), 300)
        self.assertTrue(e["problem"].endswith("…"))
        self.assertEqual(h.failure_entries([], {"stage": "qa", "round": 0, "sentBack": True}), [])

    def test_spec_text_implementer_vs_qa(self):
        s = make_spec(changes="CHANGES-TEXT", tests="TESTS-TEXT", doneWhen=["DONE-TEXT"])
        impl = h.spec_text(s, CONTRACT, "implementer")
        qa = h.spec_text(s, CONTRACT, "qa")
        self.assertIn("CHANGES-TEXT", impl)
        self.assertIn("TESTS-TEXT", impl)
        self.assertIn("DONE-TEXT", impl)
        self.assertIn("tests/test_a.py", impl)
        self.assertIn("a.py", impl)
        self.assertIn("TESTS-TEXT", qa)
        self.assertNotIn("CHANGES-TEXT", qa)
        self.assertNotIn("DONE-TEXT", qa)

    def test_run_record_and_telemetry(self):
        run_meta = {"id": "r", "title": "t", "agents": 6, "maxRepairRounds": 2}
        state = {
            "specs": [make_spec(), make_spec(id="S2", testFiles=[], filesOwned=["b.py"])],
            "builds": [{"spec": "S1", "tdd": [{"criterion": "C1", "tests": ["t1"], "red": "r"}, {"criterion": "C2", "tests": [], "red": "none"}]}],
            "qa": [{"spec": "S1", "gaps": [{"severity": "high", "problem": "g", "written": True}, {"severity": "low", "problem": "g", "written": False}], "failures": []}],
            "check": GOOD_CHECK,
            "review": GOOD_REVIEW,
            "specReviews": [],
            "failures": [{"kind": "criterion", "id": "C2"}],
            "repairRounds": 0,
            "reason": "",
        }
        rec = h.run_record(run_meta, CONTRACT, state, {"phase": "Review", "outcome": "running", "levels": 1, "build": {"S1": {"impl": "ok", "test": "ok"}, "S2": {"impl": "ok", "test": "none"}}, "repairs": []})
        self.assertEqual(rec["specs"][0]["implNote"], "Test-first: 1/2 criteria")
        self.assertEqual(rec["specs"][0]["testNote"], "QA: 2 gap(s), 1 test(s) added")
        self.assertEqual(rec["specs"][1]["test"], "none")
        self.assertEqual(rec["check"]["state"], "ok")
        self.assertEqual([c["status"] for c in rec["criteria"]], ["met", "not_met"])
        self.assertEqual([r["tag"] for r in rec["review"]], ["whole change"])

        with_qc = h.run_record(run_meta, CONTRACT, {**state, "failures": [{"kind": "qc", "id": "C1"}], "qc": [{"round": 0, **GOOD_QC}]}, {"phase": "Review", "outcome": "running", "levels": 1, "build": {}, "repairs": []})
        self.assertEqual(with_qc["review"][-1], {"tag": "qc", "text": "1/2 criteria pass when used, 1 not observable", "state": "ok"})
        self.assertEqual([c["status"] for c in with_qc["criteria"]], ["not_met", "met"])

        early = h.run_record(run_meta, CONTRACT, {"specs": []}, {"phase": "Spec", "outcome": "running", "levels": 0, "build": {}, "repairs": []})
        self.assertEqual([c["status"] for c in early["criteria"]], ["", ""])
        self.assertEqual(rec["workflowOutcome"], "running")

        done = h.run_record(run_meta, CONTRACT, state, {"phase": "Review", "outcome": "passed", "levels": 1, "build": {}, "repairs": []})
        self.assertEqual(done["outcome"], "passed")
        self.assertEqual(done["workflowOutcome"], "passed")
        self.assertEqual(rec["failureLog"], [])
        entry = {"stage": "qa", "round": 0, "kind": "qa", "specs": ["S1"], "file": "tests/test_a.py", "line": 1, "problem": "p", "sentBack": True}
        self.assertEqual(h.run_record(run_meta, CONTRACT, {**state, "failureLog": [entry]}, {"phase": "Build", "outcome": "running", "levels": 1, "build": {}, "repairs": []})["failureLog"], [entry])

    def test_scratch_dir_and_note(self):
        labels = ["planner", "build S1", "qa S1", "review S1", "review S1 (round 1)", "rebuild 1 S1", "rebuild 2 S1", "checker", "checker (round 1)"]
        dirs = [h.scratch_dir("/w", l) for l in labels]
        self.assertEqual(len(set(dirs)), len(labels))
        for d in dirs:
            self.assertRegex(d, r"^/w/[a-z0-9]+(-[a-z0-9]+)*$")
        self.assertEqual(h.scratch_dir("/w", "review S1 (round 1)"), "/w/review-s1-round-1")
        self.assertEqual(h.scratch_dir("/w", "../../etc"), "/w/etc")
        self.assertEqual(h.scratch_dir("/w", ""), "/w/agent")
        self.assertEqual(h.scratch_dir("/w", "///"), "/w/agent")
        self.assertEqual(h.scratch_dir("/w", None), "/w/agent")

        note = h.scratch_note("/w/qa-s1")
        self.assertTrue(note.startswith("Scratch directory: /w/qa-s1\n"))
        self.assertIn("Never create a link", note)

    def test_validate_specs_kinds_and_skills(self):
        def has(specs, avail, substr):
            probs = h.validate_specs(specs, CONTRACT, avail)
            self.assertTrue(any(substr in p for p in probs), f"expected {substr!r} in {probs}")

        has([make_spec(kind=None)], None, '"kind" must be one of')
        has([make_spec(kind="chore")], None, '"kind" must be one of')
        has([make_spec(skills=["grill-me"])], ["grill-me"], "waits on a person")
        has([make_spec(skills=["impeccable"])], ["tdd"], "impeccable is not installed")
        self.assertEqual(h.validate_specs([make_spec(skills=["impeccable"])], CONTRACT, ["impeccable"]), [])

    def test_skills_for_and_missing_skills(self):
        self.assertEqual(h.skills_for("implementer", make_spec(kind="bug")), ["diagnosing-bugs", "tdd", "verification-before-completion", "mp-code-review"])
        self.assertEqual(h.skills_for("implementer", make_spec(kind="feature")), ["tdd", "codebase-design", "verification-before-completion", "mp-code-review"])
        self.assertEqual(h.skills_for("implementer", make_spec(kind="ux")), ["tdd", "verification-before-completion", "mp-code-review"])
        self.assertEqual(h.skills_for("implementer", make_spec(kind="tech-debt")), ["codebase-design", "tdd", "verification-before-completion", "mp-code-review"])
        self.assertEqual(h.skills_for("implementer", make_spec(kind="docs")), ["verification-before-completion", "mp-code-review"])
        self.assertEqual(h.skills_for("implementer", make_spec(kind="bug", skills=["impeccable"])), ["impeccable", "verification-before-completion", "mp-code-review"])
        self.assertEqual(h.skills_for("qa", make_spec(kind="bug", skills=["impeccable"])), ["tdd", "diagnosing-bugs", "verification-before-completion", "testing-strategy", "mp-code-review", "pr-security-review"])
        self.assertEqual(h.skills_for("reviewer"), ["mp-code-review", "codebase-design"])
        self.assertEqual(h.skills_for("specReviewer", make_spec()), ["mp-code-review", "codebase-design"])
        self.assertEqual(h.skills_for("planner"), ["codebase-design"])

        all_skills = {n: f"/s/{n}/SKILL.md" for n in h.required_skills()}
        self.assertEqual(h.missing_skills(all_skills), [])
        self.assertEqual(h.missing_skills({**all_skills, "tdd": ""}), ["tdd"])
        self.assertEqual(h.missing_skills(None), h.required_skills())
        for kind in h.SKILLS["kinds"]:
            self.assertIsInstance(h.SKILLS["implementer"][kind], list)

    def test_skills_note_and_conditional_for(self):
        self.assertEqual(h.skills_note([], {}), "")
        note = h.skills_note(["tdd"], {"tdd": "/s/tdd/SKILL.md"}, "FIXED")
        self.assertIn("read_file", note)
        self.assertIn("in this order: tdd", note)
        self.assertIn("- tdd: /s/tdd/SKILL.md", note)
        self.assertIn("the brief wins", note)
        self.assertTrue(note.endswith("FIXED"))

        paths = {"vitest": "/s/vitest/SKILL.md", "testing-strategy": "/s/ts/SKILL.md", "playwright-best-practices": "/s/p/SKILL.md"}
        self.assertEqual([c["name"] for c in h.conditional_for("implementer", paths)], ["vitest", "playwright-best-practices", "testing-strategy"])
        self.assertEqual([c["name"] for c in h.conditional_for("qa", paths)], ["vitest", "playwright-best-practices"])
        self.assertIn("Vitest", h.conditional_for("qa", paths)[0]["when"])
        self.assertEqual([c["name"] for c in h.conditional_for("implementer", paths, ["vitest"])], ["playwright-best-practices", "testing-strategy"])
        self.assertIn("domain-modeling", [c["name"] for c in h.conditional_for("implementer", {**paths, "domain-modeling": "/d"})])
        self.assertEqual(h.conditional_for("reviewer", paths), [])
        self.assertEqual(h.conditional_for("qc", paths), [])
        self.assertEqual(h.skills_for("qc"), [])
        self.assertEqual(h.conditional_for("implementer", None), [])
        self.assertEqual(h.optional_skills(), ["domain-modeling", "playwright-best-practices", "vitest"])
        for n in h.optional_skills():
            self.assertNotIn(n, h.required_skills())

        cond_note = h.skills_note(["tdd"], {"tdd": "/t", "vitest": "/v"}, "", [{"name": "vitest", "when": "when Vitest"}])
        self.assertIn("Read these too with `read_file`", cond_note)
        self.assertIn("- vitest, when Vitest: /v", cond_note)
        self.assertTrue(h.skills_note([], {"vitest": "/v"}, "", [{"name": "vitest", "when": "w"}]).startswith("Read these too"))

    def test_models_gemini_tiers(self):
        self.assertEqual(h.model_for("planner"), {"model": "gemini-4-neon-xhigh"})
        self.assertEqual(h.model_for("reviewer"), {"model": "gemini-4-neon-high"})
        self.assertEqual(h.model_for("rebuild"), {"model": "gemini-4-neon-high"})
        for role in ("implementer", "qa", "specReviewer"):
            self.assertEqual(h.model_for(role), {"model": "gemini-4-carbon-medium"})
        self.assertEqual(h.model_for("qc"), {"model": "gemini-4-hydrogen-medium"})
        self.assertEqual(h.model_for("checker"), {"model": "gemini-4-hydrogen-low"})

        self.assertEqual(h.model_for("implementer", {"implementer": {"model": "gemini-4-neon-high"}}), {"model": "gemini-4-neon-high"})
        self.assertEqual(h.model_for("implementer", {"implementer": {"model": "pro"}}), {"model": "pro"})
        self.assertEqual(h.model_for("reviewer", {"reviewer": {"model": "inherit"}}), {})
        self.assertEqual(h.model_for("qa", {"implementer": {"model": "gemini-4-neon-high"}}), {"model": "gemini-4-carbon-medium"})

        self.assertEqual(h.model_problems(None), [])
        for valid_model in (
            "gemini-4-neon-xhigh",
            "gemini-4-neon-high",
            "gemini-4-neon-medium",
            "gemini-4-neon-low",
            "gemini-4-carbon-high",
            "gemini-4-carbon-medium",
            "gemini-4-carbon-low",
            "gemini-4-argon-high",
            "gemini-4-argon-medium",
            "gemini-4-argon-low",
            "gemini-4-hydrogen-xhigh",
            "gemini-4-hydrogen-high",
            "gemini-4-hydrogen-medium",
            "gemini-4-hydrogen-low",
            "gemini-pro-orchestrator-neon",
            "gemini-pro-orchestrator",
            "gemini-pro-orchestrator-argon",
            "gemini-3.8-flash-high",
            "gemini-3.8-flash-medium",
            "gemini-3.8-flash-low",
            "pro",
            "flash",
            "flash_lite",
            "inherit",
        ):
            self.assertEqual(h.model_problems({"planner": {"model": valid_model}}), [], f"Rejected valid model {valid_model}")
        self.assertTrue(any("must be an object" in p for p in h.model_problems([])))
        self.assertTrue(any("tester, which is not a role" in p for p in h.model_problems({"tester": {"model": "gemini-4-neon-high"}})))
        self.assertTrue(any('model" must be one of' in p for p in h.model_problems({"planner": {"model": "gpt"}})))
        self.assertTrue(any("must be an object with" in p for p in h.model_problems({"planner": "gemini-4-neon-xhigh"})))

        self.assertEqual(h.workflow_model_tier("gemini-4-neon-xhigh"), "pro")
        self.assertEqual(h.workflow_model_tier("gemini-pro-orchestrator-neon"), "pro")
        self.assertEqual(h.workflow_model_tier("gemini-4-carbon-medium"), "flash")
        self.assertEqual(h.workflow_model_tier("gemini-4-argon-high"), "flash")
        self.assertEqual(h.workflow_model_tier("gemini-3.8-flash-medium"), "flash")
        self.assertEqual(h.workflow_model_tier("gemini-4-hydrogen-low"), "flash_lite")
        self.assertEqual(h.workflow_model_tier("pro"), "pro")
        self.assertEqual(h.workflow_model_tier("flash"), "flash")
        self.assertEqual(h.workflow_model_tier("flash_lite"), "flash_lite")
        self.assertIsNone(h.workflow_model_tier("inherit"))
        self.assertTrue(h.is_model_rejection_error(ValueError("Invalid model 'gemini-4-neon-xhigh': must be one of inherit, flash_lite, flash, pro")))
        self.assertFalse(h.is_model_rejection_error(RuntimeError("network timeout while reading file")))

    def test_issue_text_and_open_questions(self):
        self.assertEqual(h.issue_text(None), "")
        self.assertEqual(h.issue_text({"number": 7, "title": "", "body": ""}), "")
        text = h.issue_text({
            "number": 7,
            "title": "Send messages",
            "body": "Users send text.\n",
            "subIssues": [{"number": 8, "title": "Message store", "body": "Lives in src/store.ts"}, {"number": 9, "title": "Chat UI", "body": ""}],
        })
        self.assertIn("issue #7", text)
        self.assertIn("Issue #7: Send messages\nUsers send text.", text)
        self.assertIn("Sub-issue #8: Message store\nLives in src/store.ts", text)
        self.assertIn("Sub-issue #9: Chat UI\n(no description)", text)
        self.assertIn("not as specs or criteria", text)
        self.assertIn("Only the contract's criteria are judged", text)
        self.assertIn("It has no sub-issues.", h.issue_text({"number": 3, "title": "Fix", "body": "b"}))

        self.assertEqual(h.open_questions(None), [])
        self.assertEqual(h.open_questions({"questions": []}), [])
        self.assertEqual(h.open_questions({}), [])
        self.assertEqual(
            h.open_questions({"questions": [{"question": "  Is a deleted order recoverable? ", "why": "changes the delete path", "criteria": ["C2"]}, {"question": " ", "why": "x", "criteria": []}, "Who may export?"]}),
            [
                {"question": "Is a deleted order recoverable?", "why": "changes the delete path", "criteria": ["C2"]},
                {"question": "Who may export?", "why": "", "criteria": []},
            ],
        )
        self.assertEqual(
            h.questions_text([{"question": "A?", "why": "w", "criteria": ["C1", "C3"]}, {"question": "B?", "why": "", "criteria": []}]),
            "Q1: A? (C1, C3) - w Q2: B?",
        )

    def test_globs_protected_risk_and_escalation(self):
        self.assertTrue(h.matches_glob(".github/workflows/ci.yml", ".github/**"))
        self.assertTrue(h.matches_glob("web/vitest.config.ts", "vitest.config.*"))
        self.assertTrue(h.matches_glob("tsconfig.build.json", "tsconfig*.json"))
        self.assertTrue(h.matches_glob("src/auth/login.ts", "**/auth/**"))
        self.assertTrue(h.matches_glob("src/userAuthGuard.ts", "**/*auth*"))
        self.assertFalse(h.matches_glob("src/vitest.config/x.ts", "vitest.config.*"))
        self.assertFalse(h.matches_glob("docs/github/x.md", ".github/**"))

        files = ["src/a.ts", ".github/workflows/ci.yml", "jest.config.js", "eslint.config.mjs", "factory/checks.sh"]
        self.assertEqual(h.protected_files(files), [".github/workflows/ci.yml", "jest.config.js", "eslint.config.mjs", "factory/checks.sh"])
        self.assertEqual(h.protected_files(files, ["src/**"], [".github/**", "jest.config.js"]), ["src/a.ts", "eslint.config.mjs", "factory/checks.sh"])
        self.assertEqual(h.protected_files(files, None, True), [])
        self.assertEqual(h.protected_files(files, None, ["**"]), [])
        self.assertEqual(
            h.protected_files([".factory/decisions.md", ".factory/plans/2026-11-25-ba.json", ".factory/product.md", ".factory/project.json"]),
            [".factory/project.json"],
        )
        self.assertEqual(
            h.files_outside_ownership(
                ["src/a.ts", ".factory/decisions.md", ".factory/plans/2026-11-25-ba.json", ".factory/product.md", ".factory/init.json"],
                [{"filesOwned": ["src/a.ts"], "testFiles": []}],
            ),
            [],
        )

        self.assertEqual(
            h.sensitive_kinds(["src/auth/session.ts", "api/payments.py", "db/migrations/001.sql", "package.json", "Dockerfile"]),
            ["auth", "money", "migration", "dependency", "ci"],
        )
        self.assertEqual(h.sensitive_kinds(["src/list.ts"]), [])

        self.assertEqual(h.assess_risk("low", [], [{"filesOwned": ["src/list.py"]}]), {"risk": "low", "surfaces": [], "raisedBy": []})
        self.assertEqual(h.assess_risk(None, ["bogus"], []), {"risk": "medium", "surfaces": [], "raisedBy": []})
        a = h.assess_risk("low", [], [{"filesOwned": ["src/billing.ts", "src/Plan.tsx"]}])
        self.assertEqual(a["risk"], "high")
        self.assertEqual(a["surfaces"], ["ui", "security"])
        self.assertEqual(h.assess_risk("low", [], [{"filesOwned": ["package.json"]}])["risk"], "medium")
        self.assertEqual(h.assess_risk("high", [], [{"filesOwned": ["package.json"]}])["risk"], "high")

        self.assertEqual(h.routed_models("low", {}), {"reviewer": {"model": "gemini-4-carbon-medium"}})
        self.assertEqual(h.routed_models("high", {"reviewer": {"model": "inherit"}})["reviewer"], {"model": "inherit"})
        self.assertEqual(h.routed_models("high", {})["reviewer"], {"model": "gemini-4-neon-xhigh"})
        self.assertEqual(h.routed_models("high", {})["specReviewer"], {"model": "gemini-4-neon-high"})
        self.assertEqual(h.routed_models("medium", None), {})

        medium = {"risk": "medium", "surfaces": [], "raisedBy": []}
        self.assertEqual(h.escalation(["src/list.py"], medium, []), {"decision": "auto", "reasons": []})
        e = h.escalation(
            ["src/list.py", "db/migrations/002.sql", "yarn.lock"],
            {"risk": "high", "surfaces": ["ui"], "raisedBy": ["the specs own a migration"]},
            [{"rebuild": 1, "spec": "S1", "files": ["t.py"]}],
        )
        self.assertEqual(e["decision"], "person")
        self.assertEqual([r.split(":")[0] for r in e["reasons"]], ["migration", "dependency", "high-risk", "ui", "tests-rewritten"])
        self.assertIn("t.py", e["reasons"][4])
        self.assertEqual(h.escalation(["yarn.lock"], medium, [], ["auth"])["decision"], "auto")

    def test_project_skills_and_design_and_docs(self):
        project = {"implementer": ["vitest", "nextjs-conventions"], "reviewer": ["nextjs-conventions"], "qc": ["playwright-best-practices"]}
        self.assertEqual(h.skills_for("implementer", {"kind": "feature", "skills": []}, None, project), ["tdd", "codebase-design", "verification-before-completion", "mp-code-review", "vitest", "nextjs-conventions"])
        self.assertEqual(h.skills_for("specReviewer", {"kind": "feature"}, None, project), ["mp-code-review", "codebase-design", "nextjs-conventions"])
        self.assertEqual(h.skills_for("qc", None, None, project), ["playwright-best-practices"])
        self.assertEqual(h.skills_for("qc", None, None, None), [])

        self.assertEqual(h.missing_project_skills({"implementer": ["vitest", "x"], "qc": ["x"]}, {"vitest": "/s/vitest"}), ["x"])
        self.assertEqual(h.missing_project_skills(None, {}), [])

        self.assertEqual(h.design_problems(DESIGNED), [])
        self.assertEqual(h.design_problems({"criteria": []}), [])
        dp = " ".join(h.design_problems({**DESIGNED, "design": {"screens": [{"screen": "A", "criteria": ["C9"], "mockup": "https://www.figma.com/design/x"}, {"criteria": [], "mockup": ""}]}}))
        self.assertIn('"A"\'s mockup is a link', dp)
        self.assertIn("names C9, which is not in the contract", dp)
        self.assertIn("screen 2 has no mockup", dp)
        self.assertIn("screen 2 names no criterion", dp)
        self.assertIn("no design doc", dp)

        dt = h.design_text(DESIGNED["design"], ["C1"])
        self.assertIn("Design rules: DESIGN.md; tokens: src/tokens.css", dt)
        self.assertIn("Component catalogue: docs/ui/catalog.md", dt)
        self.assertIn("Reuse: components/DataTable", dt)
        self.assertIn('Screen "Orders" for C1: mockup docs/mockups/orders.png; states: empty, mobile-390', dt)
        self.assertNotIn("Export", dt)
        self.assertEqual(h.design_text(None, ["C1"]), "")

        s = {"id": "S1", "title": "t", "goal": "g", "criteria": ["C2"], "filesOwned": ["a.tsx"], "testFiles": [], "tests": "t", "doneWhen": []}
        self.assertIn('Screen "Export" for C2', h.spec_text(s, DESIGNED, "implementer"))
        self.assertNotIn('"Orders"', h.spec_text(s, DESIGNED, "implementer"))
        self.assertRegex(h.qc_text(DESIGNED), r'Screens to compare[\s\S]*"Orders" \(C1\): docs/mockups/orders\.png[\s\S]*"Export"')
        self.assertIn("Design (what the product must look like)", h.contract_text(DESIGNED))

        docs = {"agents": "GEMINI.md", "decisions": "DECISIONS.md", "product": "PRODUCT.md"}
        self.assertEqual(h.project_note("qc", docs), [])
        impl_note = "\n".join(h.project_note("implementer", docs))
        self.assertIn("read GEMINI.md before anything else", impl_note)
        self.assertIn("DECISIONS.md", impl_note)
        self.assertNotIn("PRODUCT.md", impl_note)
        self.assertIn("PRODUCT.md", "\n".join(h.project_note("planner", docs)))
        self.assertEqual(h.project_note("implementer", {}), [])

    def test_qc_mockups_flaky_tdd_migrations_a11y(self):
        ok = {
            "criteria": [{"id": "C1", "status": "pass"}, {"id": "C2", "status": "pass"}],
            "screens": [
                {"screen": "Orders", "status": "match", "screenshot": "s1", "differences": []},
                {"screen": "Export", "status": "differs", "screenshot": "s2", "differences": ["button is outlined, mockup is filled"]},
            ],
        }
        f = h.qc_failures(DESIGNED, ok)
        self.assertEqual([[x["kind"], x["id"]] for x in f], [["qc", "C2"]])
        self.assertIn("does not match its mockup docs/mockups/export.png: button is outlined", f[0]["problem"])
        missing = h.qc_failures(DESIGNED, {**ok, "screens": []})
        self.assertEqual([x["id"] for x in missing], ["C1", "C2"])
        self.assertIn("was not compared", missing[0]["problem"])

        c = {"checks": [{"name": "test", "command": "t"}, {"name": "lint", "command": "l"}]}
        chk = {"results": [{"name": "test", "command": "t", "exitCode": 1, "rerunExitCode": 0, "outputTail": "timeout"}, {"name": "lint", "command": "l", "exitCode": 1, "rerunExitCode": 1, "outputTail": "x"}]}
        self.assertEqual([x["name"] for x in h.check_failures(c, chk)], ["lint"])
        self.assertEqual([x["name"] for x in h.flaky_checks(c, chk)], ["test"])

        specs = [
            {"id": "S1", "kind": "feature", "testFiles": ["a.test.ts"]},
            {"id": "S2", "kind": "refactor", "testFiles": ["b.test.ts"]},
            {"id": "S3", "kind": "bug", "testFiles": []},
            {"id": "S4", "kind": "ux", "testFiles": ["c.test.ts"]},
        ]
        targets = h.tdd_targets(specs)
        self.assertEqual([s["id"] for s in targets], ["S1", "S4"])
        res = h.tdd_failures(targets, [{"spec": "S1", "files": ["a.test.ts"], "exitCode": 0}])
        self.assertEqual([[x["kind"], x["spec"]] for x in res["failures"]], [["tdd", "S1"]])
        self.assertIn("pass on the base code", res["failures"][0]["problem"])
        self.assertEqual(res["unproven"], ["S4"])
        self.assertEqual(h.tdd_failures(targets, [{"spec": "S1", "exitCode": 1}, {"spec": "S4", "exitCode": 2}])["failures"], [])
        # Guard against checker reporting exitCode 0 after cleanup masked a base-code crash or skipping with "N/A".
        masked = h.tdd_failures(
            targets,
            [
                {"spec": "S1", "exitCode": 0, "outputTail": "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'x.js'\nexit=0"},
                {"spec": "S4", "exitCode": 0, "outputTail": "N/A"},
            ],
        )
        self.assertEqual(masked["failures"], [])
        self.assertEqual(masked["unproven"], ["S4"])

        mc = {"migration": {"up": "db up", "down": "db down"}}
        self.assertEqual(h.migration_failures(mc, {"changedFiles": ["src/a.ts"]}), [])
        self.assertEqual(h.migration_failures({}, {"changedFiles": ["db/migrations/1.sql"]}), [])
        self.assertIn("was not run up, down and up again", h.migration_failures(mc, {"changedFiles": ["db/migrations/1.sql"]})[0]["problem"])
        mf = h.migration_failures(mc, {"changedFiles": ["db/migrations/1.sql"], "migration": {"ran": True, "steps": [{"command": "db up", "exitCode": 0}, {"command": "db down", "exitCode": 1, "outputTail": "cannot drop"}]}})
        self.assertEqual(len(mf), 1)
        mspecs = [{"id": "S1", "filesOwned": ["src/a.ts"], "testFiles": []}, {"id": "S2", "filesOwned": ["db/migrations/1.sql"], "testFiles": []}]
        self.assertEqual([g["spec"]["id"] for g in h.route_failures(mf, mspecs)], ["S2"])

        reg_contract = {"criteria": [{"id": "C1", "text": "x"}], "design": {"screens": [{"screen": "Export", "criteria": ["C1"], "mockup": "m.png"}], "baseline": [{"screen": "Orders", "route": "/orders", "before": ["b.png"]}]}}
        reg_qc = {
            "criteria": [{"id": "C1", "status": "pass"}],
            "screens": [{"screen": "Export", "status": "match", "screenshot": "s", "differences": []}],
            "baseline": [{"screen": "Orders", "after": "a.png", "status": "regressed", "differences": ["table header lost its border"]}],
            "a11y": [{"screen": "Export", "tool": "axe", "violations": [{"id": "button-name", "impact": "critical", "nodes": 1, "help": "Buttons must have text"}, {"id": "region", "impact": "moderate", "nodes": 3, "help": ""}]}],
        }
        rf = h.qc_failures(reg_contract, reg_qc)
        self.assertEqual([x["kind"] for x in rf], ["regression", "qc"])
        self.assertIn("table header lost its border", rf[0]["problem"])
        self.assertIn("button-name (critical", rf[1]["problem"])
        self.assertNotIn("region", rf[1]["problem"])
        rspecs = [{"id": "S1", "criteria": ["C1"], "filesOwned": ["api/x.ts"], "testFiles": []}, {"id": "S2", "criteria": [], "filesOwned": ["app/orders/Table.tsx"], "testFiles": []}]
        self.assertEqual([g["spec"]["id"] for g in h.route_failures([rf[0]], rspecs)], ["S2"])
        self.assertIn("was not compared with how it looked before", h.qc_failures(reg_contract, {**reg_qc, "baseline": []})[0]["problem"])

        stack = {"languages": ["typescript"], "frameworks": ["nextjs", "prisma"], "packageManager": "pnpm", "adr": "docs/adr/0001-stack.md"}
        self.assertIn("Stack: typescript, nextjs, prisma (pnpm); why it was chosen: docs/adr/0001-stack.md", "\n".join(h.project_note("implementer", {"agents": "GEMINI.md"}, stack)))
        self.assertIn("Stack: typescript", "\n".join(h.project_note("checker", {}, stack)))
        self.assertEqual(h.project_note("qc", {"agents": "GEMINI.md"}, stack), [])
        # Defensive handling when an orchestrator passes stack or docs as a plain/JSON string
        self.assertIn("Stack: Node.js 26 ESM + node:sqlite.", "\n".join(h.project_note("planner", None, "Node.js 26 ESM + node:sqlite")))
        self.assertIn("Stack: typescript, nextjs", "\n".join(h.project_note("planner", "invalid-docs", '{"languages": ["typescript"], "frameworks": ["nextjs"]}')))
        bp = " ".join(h.design_problems({"criteria": [], "design": {"baseline": [{"screen": "Orders", "route": "", "before": []}]}}))
        self.assertIn('"Orders" has no route', bp)
        self.assertIn("no before screenshot", bp)

    def test_repo_skills_and_run_record_metadata(self):
        available = {
            "tdd": "/home/.gemini/config/skills/tdd/SKILL.md",
            "next-conventions": "/repo/.agents/skills/next-conventions/SKILL.md",
            "db-conventions": "/repo/.gemini/skills/db-conventions/SKILL.md",
            "vitest": "/repo/.agents/skills/vitest/SKILL.md",
        }
        self.assertEqual([s["name"] for s in h.repo_skills_for(available, "/repo", ["vitest"])], ["next-conventions", "db-conventions"])
        self.assertEqual([s["name"] for s in h.conditional_for("implementer", available, ["tdd"], "/repo")], ["vitest", "next-conventions", "db-conventions"])
        self.assertEqual(h.conditional_for("checker", available, [], "/repo"), [])
        self.assertEqual(
            [s["name"] for s in h.conditional_for("planner", {**available, "domain-modeling": "/x"}, ["codebase-design"], "/repo")],
            ["domain-modeling", "next-conventions", "db-conventions", "vitest"],
        )

        contract = {"criteria": [{"id": "C1", "text": "one"}], "checks": [{"name": "test", "command": "t"}]}
        state = {
            "specs": [],
            "risk": {"risk": "high", "surfaces": ["security"], "raisedBy": ["the specs own auth files"]},
            "merge": {"decision": "person", "reasons": ["auth: src/auth/x.ts"]},
            "questions": [{"question": "Soft delete?", "why": "w", "criteria": ["C1"]}],
            "flaky": [{"name": "test", "command": "t"}],
            "tddUnproven": ["S2"],
            "check": {"results": [{"name": "test", "exitCode": 1, "rerunExitCode": 0}]},
        }
        r = h.run_record({"id": "r1", "title": "t", "agents": 3, "maxRepairRounds": 2}, contract, state, {"outcome": "passed", "phase": "Review", "levels": 1, "build": {}, "repairs": []})
        self.assertEqual(r["risk"], {"level": "high", "surfaces": ["security"], "raisedBy": ["the specs own auth files"]})
        self.assertEqual(r["merge"], {"decision": "person", "reasons": ["auth: src/auth/x.ts"]})
        self.assertEqual(r["questions"], [{"question": "Soft delete?", "criteria": ["C1"]}])
        self.assertEqual(r["flaky"], ["test"])
        self.assertEqual(r["tddUnproven"], ["S2"])
        self.assertEqual(r["check"]["state"], "ok")
        self.assertNotIn("repo", r)
        r_local = h.run_record(
            {"id": "r2", "title": "I3: Add auth", "agents": 1, "maxRepairRounds": 2, "repo": "/tmp/demo-app/", "issueKey": "I3", "issueNumber": 42},
            contract,
            state,
            {"outcome": "running", "phase": "Build", "levels": 1, "build": {}, "repairs": []},
        )
        self.assertEqual(r_local["repo"], "/tmp/demo-app")
        self.assertEqual(r_local["issueKey"], "I3")
        self.assertEqual(r_local["issueNumber"], 42)

    def test_coding_standards_helpers(self):
        self.assertEqual(h.standards_problems(CONTRACT), [])
        self.assertEqual(h.standards_problems(WITH_STANDARDS), [])
        bad = "\n".join(h.standards_problems({
            **CONTRACT,
            "standards": {
                "rules": [
                    {"id": "R1", "text": "t", "severity": "blocking", "enforced": "review"},
                    {"id": "S2", "text": "", "severity": "urgent", "enforced": "review"},
                    {"id": "S2", "text": "t", "severity": "minor", "enforced": "vibes"},
                    {"id": "S4", "text": "t", "severity": "minor", "enforced": "tool", "check": "lint"},
                ]
            },
        }))
        self.assertIn("R1 needs an id S1", bad)
        self.assertIn("S2 has no text", bad)
        self.assertIn("S2 must be blocking or minor", bad)
        self.assertIn("S2 is given twice", bad)
        self.assertIn("must be enforced by tool or review", bad)
        self.assertIn('S4 is kept by a tool, but its check "lint" is not one of the contract\'s checks', bad)
        self.assertIn("no rules", h.standards_problems({**CONTRACT, "standards": {"rules": []}})[0])

        self.assertEqual(h.standards_text(None, "reviewer"), "")
        impl = h.standards_text(STANDARDS, "implementer")
        self.assertIn('S1 (blocking, kept by the check "lint")', impl)
        self.assertIn("S3 (minor): Names say", impl)
        rev = h.standards_text(STANDARDS, "reviewer")
        self.assertIn("give each rule below one entry in `standards`", rev)
        self.assertRegex(rev, r"- S2 \(blocking\)[\s\S]*Kept by the checks, not by you[\s\S]*- S1")

        rev_res = {
            "standards": [
                {"id": "S1", "status": "fail", "file": "a.js", "line": 1, "evidence": "reviewer may not fail a tool rule"},
                {"id": "S2", "status": "fail", "file": "./src/a.js", "line": 12, "evidence": "catch {} drops the error"},
                {"id": "S3", "status": "fail", "file": "src/a.js", "line": 3, "evidence": "x"},
            ]
        }
        sf = h.standards_failures(STANDARDS, rev_res, {"id": "P2"})
        self.assertEqual(len(sf), 1)
        self.assertEqual(sf[0]["kind"], "standard")
        self.assertEqual(sf[0]["id"], "S2")
        self.assertEqual(sf[0]["file"], "src/a.js")
        self.assertEqual(sf[0]["spec"], "P2")
        self.assertIn("S2 is broken: Errors are handled", sf[0]["problem"])
        self.assertIn("catch {} drops the error", sf[0]["problem"])

        met = {"criteria": [{"id": "C1", "status": "met", "evidence": "e"}, {"id": "C2", "status": "met", "evidence": "e"}], "findings": []}
        broken = {"id": "S2", "status": "fail", "file": "src/b.js", "line": 4, "evidence": "swallows"}
        s1 = make_spec(id="S1", criteria=["C1"], filesOwned=["src/a.js"], testFiles=["t/a.test.js"])
        s2 = make_spec(id="S2x", criteria=["C2"], filesOwned=["src/b.js"], testFiles=["t/b.test.js"])
        chk = {"results": [{"name": "test", "exitCode": 0}, {"name": "lint", "exitCode": 0}], "changedFiles": []}
        failures = h.evaluate(WITH_STANDARDS, chk, {**met, "standards": [broken]}, [{"spec": s2, "review": {"criteria": [{"id": "C2", "status": "met", "evidence": "e"}], "findings": [], "standards": [broken]}}], None)
        self.assertEqual(len([f for f in failures if f["kind"] == "standard"]), 1)
        self.assertEqual([g["spec"]["id"] for g in h.route_failures(failures, [s1, s2])], ["S2x"])
        minor_only = h.evaluate(WITH_STANDARDS, chk, {**met, "standards": [{"id": "S3", "status": "fail", "file": "src/a.js", "line": 1, "evidence": "x"}]}, [], None)
        self.assertEqual(minor_only, [])

        rep_chk = {"results": [{"name": "lint", "exitCode": 1, "rerunExitCode": 1}]}
        r = h.standards_report(STANDARDS, rep_chk, [{"standards": [{"id": "S2", "status": "pass", "evidence": "all errors rethrown"}]}, {"standards": [{"id": "S2", "status": "fail", "file": "b.js", "line": 2, "evidence": "swallowed"}]}])
        self.assertEqual([[x["id"], x["status"]] for x in r], [["S1", "fail"], ["S2", "fail"], ["S3", "not_judged"]])
        self.assertIn("lint exited 1, 1 on its rerun", r[0]["evidence"])
        self.assertIn("b.js:2 swallowed", r[1]["evidence"])
        green = h.standards_report(STANDARDS, {"results": [{"name": "lint", "exitCode": 0}]}, [{"standards": [{"id": "S2", "status": "pass", "evidence": "e"}, {"id": "S3", "status": "not_applicable", "evidence": "no new names"}]}])
        self.assertEqual([x["status"] for x in green], ["pass", "pass", "not_applicable"])
        self.assertEqual(h.standards_report(STANDARDS, None, [])[0]["status"], "not_judged")
        self.assertEqual(h.standards_report(None, rep_chk, []), [])

    def test_model_profiles_catalog_and_resolution(self):
        catalog_path = Path(__file__).resolve().parent.parent / "factory" / "catalog" / "model-profiles.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        self.assertEqual(sorted(catalog["models"].keys()), sorted(h.MODEL_TIERS.keys()))
        for model_id, meta in catalog["models"].items():
            self.assertEqual(meta["tier"], h.MODEL_TIERS[model_id], f"Tier for {model_id} drifted from factory.py")
        self.assertEqual(sorted(catalog["profiles"].keys()), sorted(h.MODEL_PROFILES.keys()))
        for name, definition in catalog["profiles"].items():
            self.assertEqual(definition["models"], h.MODEL_PROFILES[name], f"Profile {name} drifted from factory.py")

        self.assertEqual(h.model_profile_problems(None), [])
        for name in ("balanced", "fast", "flagship", "orchestrator", "inherit"):
            self.assertEqual(h.model_profile_problems(name), [])
        self.assertEqual(len(h.model_profile_problems("unknown")), 1)

        fast_with_override = h.resolve_models_for_profile("fast", {"qa": {"model": "gemini-4-carbon-high"}})
        self.assertEqual(h.model_for("checker", fast_with_override), {"model": "gemini-4-hydrogen-low"})
        self.assertEqual(h.model_for("planner", fast_with_override), {"model": "gemini-4-carbon-high"})
        self.assertEqual(h.model_for("qa", fast_with_override), {"model": "gemini-4-carbon-high"})

        flagship = h.resolve_models_for_profile("flagship")
        self.assertEqual(h.model_for("implementer", flagship), {"model": "gemini-4-neon-high"})
        self.assertEqual(h.model_for("checker", flagship), {"model": "gemini-4-carbon-low"})
        self.assertEqual(h.model_for("qc", flagship), {"model": "gemini-4-carbon-high"})

        orchestrator = h.resolve_models_for_profile("orchestrator")
        self.assertEqual(h.model_for("planner", orchestrator), {"model": "gemini-pro-orchestrator-neon"})
        self.assertEqual(h.model_for("reviewer", orchestrator), {"model": "gemini-pro-orchestrator-neon"})
        self.assertEqual(h.model_for("implementer", orchestrator), {"model": "gemini-4-carbon-high"})

        inherited = h.resolve_models_for_profile("inherit")
        self.assertEqual(h.model_for("planner", inherited), {})
        self.assertEqual(h.model_for("reviewer", inherited), {})


if __name__ == "__main__":
    unittest.main()
