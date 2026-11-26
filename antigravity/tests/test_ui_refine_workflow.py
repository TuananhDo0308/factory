"""End-to-end mocked workflow tests for ui-refine-loop/workflow/ui-refine-loop.py."""

import ast
import asyncio
import json
import re
import types
import unittest
from pathlib import Path


def load_ui_refine_module():
    path = Path(__file__).resolve().parent.parent / "ui-refine-loop" / "workflow" / "ui-refine-loop.py"
    source = path.read_text(encoding="utf-8")
    code = compile(source, str(path), "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    mod = types.ModuleType("ui_refine_workflow")
    mod.__file__ = str(path)
    res = eval(code, mod.__dict__)
    if asyncio.iscoroutine(res):
        asyncio.run(res)
    return mod, source


mod, SOURCE = load_ui_refine_module()

IMP = {
    "layout": "node",
    "skillDir": "/imp",
    "reference": "/imp/reference",
    "detect": "node /imp/scripts/detect.mjs --json",
    "context": "node /imp/scripts/context.mjs",
    "version": "4.0.4",
}

BASE = {
    "slug": "reports",
    "target": "/reports",
    "scope": ["src/reports/"],
    "prompt": "calmer",
    "worktree": "/wt",
    "runDir": "/wt.run",
    "skillDir": "/skill",
    "checks": ["npm run typecheck"],
    "shootCmd": "node shoot.mjs --base http://localhost:1 --route /reports",
    "baseUrl": "http://localhost:1",
    "route": "/reports",
    "beforeShots": [
        "/wt.run/shots/round-0-main-desktop-light.png",
        "/wt.run/shots/round-0-main-desktop-dark.png",
        "/wt.run/shots/round-0-main-desktop-light-s1.png",
    ],
    "impeccable": IMP,
}


def prob(severity, ptype="polish", pid=None):
    return {
        "id": pid or f"{ptype}-{severity}",
        "severity": severity,
        "type": ptype,
        "title": pid or f"{ptype}-{severity}",
        "location": "a.tsx:1",
        "evidence": "e",
        "fix": "f",
    }


def chk(problems=None, **extra):
    return {"problems": problems if problems is not None else [], "vsBefore": "better", "summary": "s", **extra}


def committed(fixed=None):
    def _fn(n):
        return {
            "status": "committed",
            "commit": f"c{n}",
            "commands": ["layout", "polish"],
            "fixed": fixed or [],
            "skipped": [],
            "outOfScope": [],
            "checks": "green",
            "afterShots": [
                f"/wt.run/shots/round-{n}-main-desktop-light.png",
                f"/wt.run/shots/round-{n}-main-desktop-light-s1.png",
                f"/wt.run/shots/cmp-round-{n}-main-desktop-light.png",
            ],
        }
    return _fn


def reverted(_n=None):
    return {
        "status": "reverted",
        "commit": "",
        "commands": [],
        "fixed": [],
        "skipped": [],
        "outOfScope": [],
        "checks": "tsc red",
        "afterShots": [],
    }


def list_after(text, marker):
    start = text.index("[", text.index(marker))
    return json.loads(text[start:])


async def run_loop(args, checks, fixer, design=None, detect=None, finish=None):
    calls = []

    async def agent_fn(prompt="", schema=None, role="", **_kw):
        calls.append({"label": role, "prompt": prompt})
        if role == "finish":
            return finish if finish is not None else {
                "grades": [{"id": "x", "grade": "fixed", "evidence": "e"}],
                "regressions": [],
                "disposition": "ready for review",
            }
        n = int(re.search(r"r(\d+)$", role).group(1))
        if role.startswith("design"):
            return design(n) if design else {"dims": {}, "designTotal": 10 + n, "problems": []}
        if role.startswith("detector"):
            return detect(n) if detect else {"dims": {}, "auditTotal": 10, "detectorCount": 3, "detectorRan": True, "problems": []}
        if role.startswith("check"):
            return checks[n - 1] if n - 1 < len(checks) and checks[n - 1] is not None else (
                None if (n - 1 < len(checks) and checks[n - 1] is None) else checks[-1]
            )
        return fixer(n)

    async def parallel_fn(items, fn):
        return await asyncio.gather(*(fn(it) for it in items))

    out = await mod.run_ui_refine(args, agent_fn, parallel_fn, lambda _p: None, lambda *_a: None)
    labels = [c["label"] for c in calls]
    return {
        "out": out,
        "calls": calls,
        "labels": labels,
        "prompt": lambda lbl: next(c["prompt"] for c in calls if c["label"] == lbl),
        "starting": lambda prefix: [l for l in labels if l.startswith(prefix)],
    }


class TestUiRefineWorkflow(unittest.TestCase):
    def test_five_fix_rounds_by_default_then_closing_check(self):
        r = asyncio.run(run_loop(BASE, [chk([prob("P1", "cluttered")])], committed()))
        self.assertEqual(r["out"]["stopReason"], "ran all 5 rounds")
        self.assertEqual(len(r["starting"]("fixer")), 5)
        self.assertEqual(len(r["starting"]("check ")), 6)
        self.assertEqual(r["labels"][:4], ["design r1", "detector r1", "check r1", "fixer r1"])
        self.assertEqual(r["out"]["finalLabel"], "round-5")

    def test_two_consecutive_checks_without_p0_or_p1_stop_loop(self):
        r = asyncio.run(run_loop(BASE, [chk([prob("P1", "too-loud")]), chk([prob("P2", "typography")]), chk([prob("P3")])], committed()))
        self.assertEqual(r["out"]["stopReason"], "two consecutive checks found no P0/P1")
        self.assertEqual(r["starting"]("fixer"), ["fixer r1", "fixer r2"])
        self.assertEqual(len(r["starting"]("check ")), 3)

    def test_p1_resets_clean_streak(self):
        r = asyncio.run(run_loop({**BASE, "rounds": 3}, [chk([prob("P2")]), chk([prob("P1")]), chk([prob("P2")]), chk([prob("P1")])], committed()))
        self.assertEqual(r["out"]["stopReason"], "ran all 3 rounds")

    def test_check_with_no_problems_starts_no_fixer_and_no_finish_review(self):
        r = asyncio.run(run_loop(BASE, [chk([])], committed()))
        self.assertEqual(len(r["starting"]("fixer")), 0)
        self.assertEqual(r["out"]["stopReason"], "two consecutive checks found no P0/P1")
        self.assertEqual(r["out"]["disposition"], "no fixes landed")
        self.assertNotIn("finish", r["labels"])

    def test_two_reverted_rounds_in_row_stop_loop_commit_resets(self):
        r = asyncio.run(run_loop(BASE, [chk([prob("P0", "responsive")])], lambda n: committed()(n) if n == 2 else reverted(n)))
        self.assertEqual(r["out"]["stopReason"], "two fix rounds in a row went red and were reverted")
        self.assertEqual(r["labels"][-1], "fixer r4")

    def test_dead_agent_stops_loop_and_is_named(self):
        one = [chk([prob("P1")])]
        self.assertEqual(asyncio.run(run_loop(BASE, one, committed(), design=lambda _n: None))["out"]["stopReason"], "design reviewer r1 died")
        self.assertEqual(asyncio.run(run_loop(BASE, one, committed(), detect=lambda _n: None))["out"]["stopReason"], "detector r1 died")
        self.assertEqual(asyncio.run(run_loop(BASE, [None], committed()))["out"]["stopReason"], "checker r1 died")
        self.assertEqual(asyncio.run(run_loop(BASE, one, lambda _n: None))["out"]["stopReason"], "fixer r1 died")

    def test_every_problem_type_routed_as_routing_md(self):
        table = (Path(__file__).resolve().parent.parent / "ui-refine-loop" / "references" / "routing.md").read_text(encoding="utf-8")
        routes = dict(re.findall(r"^\| `([a-z-]+)` \|.*\| `([a-z]+)` \|$", table, re.MULTILINE))
        self.assertEqual(len(routes), 16)
        r = asyncio.run(run_loop({**BASE, "rounds": 1}, [chk([prob("P2", t) for t in routes]), chk([])], committed()))
        routed = list_after(r["prompt"]("fixer r1"), "Problems from check")
        self.assertEqual(len(routed), 8)
        all_routed = []
        keys = list(routes.keys())
        for chunk in (keys[:8], keys[8:]):
            run2 = asyncio.run(run_loop({**BASE, "rounds": 1}, [chk([prob("P2", t) for t in chunk]), chk([])], committed()))
            all_routed.extend(list_after(run2["prompt"]("fixer r1"), "Problems from check"))
        self.assertEqual({q["type"]: q["route"] for q in all_routed}, routes)

    def test_suggested_chain_ordered_without_repeats_polish_last(self):
        problems = [prob("P3", "polish"), prob("P2", "typography"), prob("P0", "cluttered"), prob("P1", "spacing-hierarchy"), prob("P2", "cluttered", "dup")]
        r = asyncio.run(run_loop({**BASE, "rounds": 1}, [chk(problems), chk([])], committed()))
        self.assertRegex(r["prompt"]("fixer r1"), r"polish always last\): distill → layout → typeset → polish\n")
        self.assertIn("/skill/references/routing.md", r["prompt"]("fixer r1"))

    def test_detector_and_design_reviewer_isolation(self):
        r = asyncio.run(run_loop({**BASE, "rounds": 1}, [chk([prob("P1")]), chk([])], committed()))
        self.assertNotRegex(r["prompt"]("detector r1"), r"\.png")
        self.assertNotRegex(r["prompt"]("design r1"), r"auditTotal|detectorCount")
        self.assertIn("node /imp/scripts/detect.mjs --json", r["prompt"]("detector r1"))
        self.assertIn('"auditTotal": 10', r["prompt"]("check r1"))
        self.assertIn('"designTotal": 11', r["prompt"]("check r1"))

    def test_check_1_vs_later_checks_shots(self):
        r = asyncio.run(run_loop({**BASE, "rounds": 1}, [chk([prob("P1")]), chk([])], committed()))
        first = r["prompt"]("design r1")
        self.assertIn("current = round-0", first)
        self.assertIn("round-0-main-desktop-dark.png", first)
        self.assertIn("Round-0 section crops: /wt.run/shots/round-0-main-desktop-light-s1.png", first)
        second = r["prompt"]("design r2")
        self.assertIn("Round-0 (before) shots: /wt.run/shots/round-0-main-desktop-light.png", second)
        self.assertIn("Current shots (light and dark, desktop 1440 and mobile 390): /wt.run/shots/round-1-main-desktop-light.png", second)
        self.assertIn("Current section crops: /wt.run/shots/round-1-main-desktop-light-s1.png", second)
        self.assertIn("Before | after sheets (read these first): /wt.run/shots/cmp-round-1-main-desktop-light.png", second)
        self.assertIn("--label round-1 --compare round-0", r["prompt"]("fixer r1"))

    def test_score_is_design_plus_audit_and_first_check_baseline(self):
        r = asyncio.run(run_loop({**BASE, "rounds": 2}, [chk([prob("P1")]), chk([prob("P1")], vsBefore="worse"), chk([prob("P1")])], committed()))
        self.assertEqual(r["out"]["scoreLine"], "C1 21/40 → C2 22/40 (worse) → C3 23/40 (better)")
        self.assertEqual([r["out"]["before"], r["out"]["after"]], [21, 23])
        self.assertEqual(r["out"]["rounds"][0]["vsBefore"], "baseline")
        self.assertRegex(r["out"]["ledger"][0], r"^C1 · visual 21/40 \(design 11/20 · audit 10/20 · detector 3\) · baseline · P0×0 P1×1 P2×0 P3×0 · committed c1 \[layout → polish\]")

    def test_finish_reviewer_grades_every_claimed_fix_once(self):
        fin = {"grades": [{"id": "a", "grade": "partial", "evidence": "e"}, {"id": "b", "grade": "fixed", "evidence": "e"}], "regressions": ["dark footer"], "disposition": "a stays open"}
        r = asyncio.run(run_loop(
            {**BASE, "rounds": 2},
            [chk([prob("P1", "cluttered", "a"), prob("P2", "typography", "b")]), chk([prob("P1", "cluttered", "a")]), chk([])],
            committed(["a", "b"]),
            finish=fin,
        ))
        self.assertEqual(r["labels"][-1], "finish")
        self.assertEqual([[c["id"], c["round"]] for c in list_after(r["prompt"]("finish"), "Claimed fixes")], [["b", 1], ["a", 2]])
        self.assertIn("/skill/references/finish-reviewer-brief.md", r["prompt"]("finish"))
        self.assertEqual([g["grade"] for g in r["out"]["grades"]], ["partial", "fixed"])
        self.assertEqual(r["out"]["regressions"], ["dark footer"])

    def test_reverted_round_claims_nothing_and_keeps_earlier_shots(self):
        r = asyncio.run(run_loop({**BASE, "rounds": 2}, [chk([prob("P1", "cluttered", "a")])], lambda n: committed(["a"])(n) if n == 1 else reverted(n)))
        self.assertEqual(r["out"]["finalLabel"], "round-1")
        self.assertEqual([c["id"] for c in list_after(r["prompt"]("finish"), "Claimed fixes")], ["a"])

    def test_fixer_gets_commit_subject_and_checks(self):
        r = asyncio.run(run_loop({**BASE, "rounds": 1}, [chk([prob("P1")]), chk([])], committed()))
        self.assertIn('Commit message: "[ui] reports: round 1', r["prompt"]("fixer r1"))
        self.assertIn("Checks that must stay green: npm run typecheck.", r["prompt"]("fixer r1"))

    def test_without_impeccable_uses_rubric_and_degraded(self):
        no_imp = {k: v for k, v in BASE.items() if k != "impeccable"}
        r = asyncio.run(run_loop({**no_imp, "rounds": 1, "warnings": ["Impeccable NOT FOUND"]}, [chk([prob("P1")]), chk([])], committed()))
        self.assertIn("/skill/references/rubric.md", r["calls"][0]["prompt"])
        self.assertIn("/skill/references/taste.md", r["calls"][0]["prompt"])
        self.assertEqual(r["out"]["method"], "rubric")
        self.assertTrue(r["out"]["degraded"])
        self.assertEqual(r["out"]["warnings"], ["Impeccable NOT FOUND"])

        r2 = asyncio.run(run_loop({**BASE, "rounds": 1}, [chk([])], committed()))
        self.assertIsNone(r2["out"]["degraded"])
        self.assertIn("impeccable v4.0.4 (node layout)", r2["calls"][0]["prompt"])

        with self.assertRaisesRegex(ValueError, "needs args.impeccable"):
            asyncio.run(run_loop({**BASE, "critic": "impeccable", "impeccable": "/imp/scripts/impeccable"}, [], committed()))

    def test_missing_arg_refused_and_json_string_accepted(self):
        bad = {**BASE, "shootCmd": None}
        with self.assertRaisesRegex(ValueError, "args.shootCmd"):
            asyncio.run(run_loop(bad, [], committed()))
        r = asyncio.run(run_loop(json.dumps({**BASE, "rounds": 1}), [chk([])], committed()))
        self.assertEqual(r["out"]["stopReason"], "two consecutive checks found no P0/P1")

    def test_every_brief_referenced_exists(self):
        ref_dir = Path(__file__).resolve().parent.parent / "ui-refine-loop" / "references"
        for name in ("checker-brief.md", "fixer-brief.md", "routing.md", "finish-reviewer-brief.md", "rubric.md", "taste.md"):
            self.assertIn(name, SOURCE)
            self.assertGreater(len((ref_dir / name).read_text(encoding="utf-8")), 0)


if __name__ == "__main__":
    unittest.main()
