import asyncio
import json
import re
from typing import Any, Callable, Dict, List, Optional

meta = {
    "name": "ui-refine-loop",
    "description": (
        "Check → fix loop on one UI target: each round a fresh design reviewer and a fresh detector "
        "(isolated, as Impeccable requires), a fresh checker that ranks typed problems, and a fresh fixer "
        "that chains the matching Impeccable commands; a fresh finish reviewer grades every fix at the end"
    ),
    "whenToUse": (
        "Launched by the standalone /ui-refine-loop skill via run_workflow after it has read the target code, "
        "run the grill, built the worktree, started the dev server and taken round-0 shots. Not for direct ad-hoc use."
    ),
    "phases": [
        {"title": "Check", "detail": "design reviewer ‖ detector (isolated), then a checker: ranked, typed P0–P3 problems, visual score /40, before vs now"},
        {"title": "Fix", "detail": "fresh fixer: routes each problem type to an Impeccable command, chains them (polish last), keeps checks green or reverts, one commit, AFTER shots"},
        {"title": "Finish", "detail": "fresh finish reviewer: grades every claimed fix fixed / partial / not-fixed against round-0 vs final shots"},
    ],
}

# Problem type -> the Impeccable command that fixes it. The fixer makes the
# final call; this is the default route (references/routing.md).
ROUTES: Dict[str, str] = {
    "cluttered": "distill",
    "bland": "bolder",
    "too-loud": "quieter",
    "dull-color": "colorize",
    "spacing-hierarchy": "layout",
    "typography": "typeset",
    "responsive": "adapt",
    "performance": "optimize",
    "first-run-empty": "onboard",
    "confusing-copy": "clarify",
    "edge-cases": "harden",
    "accessibility": "harden",
    "needs-motion": "animate",
    "personality": "delight",
    "drift": "extract",
    "polish": "polish",
}
TYPES: List[str] = list(ROUTES.keys())
SEV: List[str] = ["P0", "P1", "P2", "P3"]


# Distinct routes in severity order, polish always last.
def chain_for(problems: List[Dict[str, Any]]) -> List[str]:
    seen: List[str] = []
    ordered = sorted(problems, key=lambda p: SEV.index(p["severity"]) if p.get("severity") in SEV else len(SEV))
    for p in ordered:
        c = ROUTES.get(p.get("type") or "", "polish")
        if c != "polish" and c not in seen:
            seen.append(c)
    return [*seen, "polish"]


PROBLEM = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "stable key <area>-<problem>, reused across rounds for the same issue"},
        "severity": {"type": "string", "enum": SEV},
        "type": {"type": "string", "enum": TYPES},
        "title": {"type": "string"},
        "location": {"type": "string", "description": "file:line (repo-relative)"},
        "evidence": {"type": "string", "description": "screenshot path + what is visible (theme, viewport, section), or the detector rule"},
        "fix": {"type": "string", "description": "what done looks like, inside the existing visual world"},
    },
    "required": ["id", "severity", "type", "title", "location", "evidence", "fix"],
}


def dims_schema(names: List[str]) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {n: {"type": "number"} for n in names},
        "required": names,
    }


DESIGN = {
    "type": "object",
    "properties": {
        "dims": dims_schema(["specificity", "hierarchy", "typography", "color", "composition"]),
        "designTotal": {"type": "number", "description": "sum of dims, out of 20"},
        "problems": {"type": "array", "items": PROBLEM},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "openQuestions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["dims", "designTotal", "problems"],
}

DETECT = {
    "type": "object",
    "properties": {
        "dims": dims_schema(["accessibility", "performance", "responsive", "theming", "integrity"]),
        "auditTotal": {"type": "number", "description": "sum of dims, out of 20"},
        "detectorCount": {"type": "number", "description": "verified detector hits (false positives dropped)"},
        "detectorRan": {"type": "boolean"},
        "problems": {"type": "array", "items": PROBLEM},
    },
    "required": ["dims", "auditTotal", "detectorCount", "detectorRan", "problems"],
}

CHECK = {
    "type": "object",
    "properties": {
        "problems": {"type": "array", "items": PROBLEM, "description": "merged and ranked, P0 first; at most 8"},
        "vsBefore": {"type": "string", "enum": ["baseline", "better", "same", "worse"], "description": "baseline on the first check"},
        "vsBeforeNote": {"type": "string", "description": "one line: what changed against round-0, by section"},
        "summary": {"type": "string", "description": "two sentences: overall state and the single biggest remaining problem"},
        "openQuestions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["problems", "vsBefore", "summary"],
}

FIX = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["committed", "reverted", "nothing-to-do"]},
        "commit": {"type": "string", "description": "short sha, or empty"},
        "commands": {"type": "array", "items": {"type": "string"}, "description": "Impeccable commands run, in order (polish last)"},
        "fixed": {"type": "array", "items": {"type": "string"}, "description": "problem ids fixed"},
        "skipped": {
            "type": "array",
            "items": {"type": "object", "properties": {"id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["id", "reason"]},
        },
        "outOfScope": {
            "type": "array",
            "items": {"type": "object", "properties": {"file": {"type": "string"}, "why": {"type": "string"}}, "required": ["file", "why"]},
        },
        "checks": {"type": "string", "description": "check command results, one line"},
        "afterShots": {"type": "array", "items": {"type": "string"}, "description": "every path the screenshot command printed"},
        "openQuestions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["status", "commit", "commands", "fixed", "skipped", "outOfScope", "checks", "afterShots"],
}

FINISH = {
    "type": "object",
    "properties": {
        "grades": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "grade": {"type": "string", "enum": ["fixed", "partial", "not-fixed"]}, "evidence": {"type": "string"}},
                "required": ["id", "grade", "evidence"],
            },
        },
        "regressions": {"type": "array", "items": {"type": "string"}, "description": "at most 3, introduced by the fixes"},
        "disposition": {"type": "string", "description": "one line: ready for review, or what stays open"},
    },
    "required": ["grades", "regressions", "disposition"],
}

REQUIRED_ARGS = [
    "slug", "target", "scope", "prompt", "worktree", "runDir",
    "skillDir", "checks", "shootCmd", "baseUrl", "route", "beforeShots",
]


def is_sheet(f: str) -> bool:
    return bool(re.search(r"(^|/)cmp-[^/]*\.png$", f))


def is_crop(f: str) -> bool:
    return bool(re.search(r"-s\d+\.png$", f))


def shot_block(current: List[str], before: List[str], extra_shots: Optional[List[str]], n: Any) -> str:
    lines = [
        f"Round-0 (before) shots: {', '.join(f for f in before if not is_crop(f))}",
        f"Round-0 section crops: {', '.join(f for f in before if is_crop(f)) or '(none)'}",
    ]
    if current != before:
        lines.extend([
            f"Current shots (light and dark, desktop 1440 and mobile 390): {', '.join(f for f in current if not is_sheet(f) and not is_crop(f))}",
            f"Current section crops: {', '.join(f for f in current if is_crop(f)) or '(none)'}",
            f"Before | after sheets (read these first): {', '.join(f for f in current if is_sheet(f)) or '(none — compare the pairs above)'}",
        ])
    else:
        lines.append(f"Check {n} is on the untouched surface: current = round-0.")
    if extra_shots:
        lines.append(f"The user's screenshots: {', '.join(extra_shots)}")
    return "\n".join(lines)


def ledger_text(ledger: List[str]) -> str:
    return "\n".join(ledger) if ledger else "(first check — no ledger yet)"


def counts(ps: List[Dict[str, Any]]) -> str:
    return " ".join(f"{s}×{sum(1 for p in ps if p.get('severity') == s)}" for s in SEV)


async def run_ui_refine(
    input_raw: Any,
    agent_fn: Callable[..., Any],
    parallel_fn: Optional[Callable[[List[Any], Callable[[Any], Any]], Any]] = None,
    phase_fn: Optional[Callable[[str], Any]] = None,
    log_fn: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    if isinstance(input_raw, str):
        try:
            inp: Any = json.loads(input_raw)
        except Exception:
            inp = input_raw
    else:
        inp = input_raw

    for k in REQUIRED_ARGS:
        if not isinstance(inp, dict) or inp.get(k) is None:
            raise ValueError(f"ui-refine-loop needs args.{k} — see the skill instructions")

    if parallel_fn is None:
        async def _default_parallel(items: List[Any], fn: Callable[[Any], Any]) -> List[Any]:
            return list(await asyncio.gather(*(fn(item) for item in items)))
        parallel_fn = _default_parallel
    if phase_fn is None:
        phase_fn = lambda _p: None
    if log_fn is None:
        log_fn = lambda *a: print(*a)

    imp = inp.get("impeccable") if isinstance(inp.get("impeccable"), dict) else None
    method = inp.get("critic") if inp.get("critic") is not None else ("impeccable" if imp else "rubric")
    if method == "impeccable" and not (imp and imp.get("detect") and imp.get("skillDir")):
        raise ValueError('ui-refine-loop: critic "impeccable" needs args.impeccable = { skillDir, detect, … } from refine-setup.sh detect')

    total_rounds = inp.get("rounds") if inp.get("rounds") is not None else 5
    taste = inp.get("tasteFile") if inp.get("tasteFile") is not None else f"{inp['skillDir']}/references/taste.md"
    ref = f"{inp['skillDir']}/references"
    degraded = "Impeccable not installed: scored with the built-in rubric, not Impeccable" if method == "rubric" else None

    if method == "impeccable" and imp is not None:
        imp_ver = imp.get("version") if imp.get("version") is not None else "?"
        imp_ref = imp.get("reference") if imp.get("reference") is not None else f"{imp['skillDir']}/reference"
        method_line = f"Method: impeccable v{imp_ver} ({imp.get('layout')} layout). Skill folder: {imp['skillDir']}. Playbooks: {imp_ref}/. Detector: `{imp['detect']} <paths>`."
    else:
        method_line = f"Method: rubric. {degraded}. Use {ref}/rubric.md in place of Impeccable's playbooks and detector."

    def common() -> str:
        ctx = inp.get("context") if inp.get("context") is not None else "no PRODUCT.md / DESIGN.md; the incumbent implementation is the design authority."
        return "\n".join([
            f"Target: {inp['target']} (route {inp['route']} at {inp['baseUrl']}).",
            f"Scope (repo-relative): {', '.join(inp['scope'])}.",
            f"Worktree: {inp['worktree']} — run every command there and edit files only under that path. The main checkout is another session's; never touch it.",
            f"Run dir (shots, auth, logs): {inp['runDir']}.",
            method_line,
            f"Taste and direction file (read first; cite its ids): {taste}.",
            f"Design context: {ctx}",
            f'The brief, verbatim: """{inp["prompt"]}"""',
        ])

    async def safe_agent(prompt: str, schema: Dict[str, Any], role: str) -> Optional[Dict[str, Any]]:
        try:
            return await agent_fn(prompt=prompt, schema=schema, role=role)
        except Exception as exc:
            log_fn(f"{role} failed: {exc}")
            return None

    ledger: List[str] = list(inp.get("priorLedger") or [])
    rounds: List[Dict[str, Any]] = []
    claims: List[Dict[str, Any]] = []
    open_questions: List[str] = []
    before_shots: List[str] = list(inp["beforeShots"])
    extra_shots: Optional[List[str]] = inp.get("extraShots")
    shots: List[str] = before_shots
    final_label = "round-0"
    clean_streak = 0
    fix_fails = 0
    stop_reason = f"ran all {total_rounds} rounds"

    for n in range(1, total_rounds + 2):
        phase_fn("Check")
        shots_now = shot_block(shots, before_shots, extra_shots, n)

        async def run_check_side(side: str) -> Optional[Dict[str, Any]]:
            if side == "design":
                prompt = "\n\n".join([
                    f'You are the check-{n} design reviewer. Read {ref}/checker-brief.md, section "Design reviewer", and follow it exactly.',
                    common(),
                    shots_now,
                    f"Extra states only (a dialog open, a tab switched): `{inp['shootCmd']} --label review-r{n} --sections none`",
                ])
                return await safe_agent(prompt, DESIGN, f"design r{n}")
            prompt = "\n\n".join([
                f'You are the check-{n} detector. Read {ref}/checker-brief.md, section "Detector", and follow it exactly.',
                common(),
            ])
            return await safe_agent(prompt, DETECT, f"detector r{n}")

        design, detect = await parallel_fn(["design", "detector"], run_check_side)
        if not design:
            stop_reason = f"design reviewer r{n} died"
            break
        if not detect:
            stop_reason = f"detector r{n} died"
            break

        checker_prompt = "\n\n".join([
            f'You are the check-{n} checker. Read {ref}/checker-brief.md, section "Checker", and follow it exactly.',
            common(),
            shots_now,
            f"Design review (assessment A):\n{json.dumps(design, indent=2)}",
            f"Detector and audit (assessment B):\n{json.dumps(detect, indent=2)}",
            f"Ledger of earlier checks:\n{ledger_text(ledger)}",
        ])
        checker = await safe_agent(checker_prompt, CHECK, f"check r{n}")
        if not checker:
            stop_reason = f"checker r{n} died"
            break
        open_questions.extend(design.get("openQuestions") or [])
        open_questions.extend(checker.get("openQuestions") or [])

        problems = (checker.get("problems") or [])[:8]
        raw_visual = round((design["designTotal"] + detect["auditTotal"]) * 10) / 10
        visual: Any = int(raw_visual) if raw_visual.is_integer() else raw_visual
        blocking = [p for p in problems if p.get("severity") in ("P0", "P1")]
        vs_before = "baseline" if n == 1 else checker["vsBefore"]
        round_rec: Dict[str, Any] = {
            "n": n,
            "visual": visual,
            "design": design["designTotal"],
            "audit": detect["auditTotal"],
            "detectorCount": detect["detectorCount"],
            "detectorRan": detect["detectorRan"],
            "vsBefore": vs_before,
            "vsBeforeNote": checker.get("vsBeforeNote") or "",
            "counts": counts(problems),
            "problems": problems,
            "summary": checker["summary"],
        }
        rounds.append(round_rec)
        head = f"C{n} · visual {visual}/40 (design {design['designTotal']}/20 · audit {detect['auditTotal']}/20 · detector {detect['detectorCount']}) · {vs_before}"

        clean_streak = clean_streak + 1 if len(blocking) == 0 else 0
        if clean_streak >= 2:
            ledger.append(f"{head} · clean (2nd in a row) · {round_rec['counts']}")
            stop_reason = "two consecutive checks found no P0/P1"
            break
        if n == total_rounds + 1:
            ledger.append(f"{head} · closing check · {round_rec['counts']}")
            break
        if len(problems) == 0:
            ledger.append(f"{head} · clean, nothing to fix; next check confirms")
            continue

        phase_fn("Fix")
        plan = chain_for(problems)
        routed = [{**p, "route": ROUTES.get(p.get("type") or "", "polish")} for p in problems]
        commit_msg = f"[ui] {inp['slug']}: round {n} — <what changed>"
        checks_str = " && ".join(inp["checks"]) if inp.get("checks") else "(none detected — say so in checks)"
        fixer_prompt = "\n\n".join([
            f"You are the round-{n} fixer. Read {ref}/fixer-brief.md and {ref}/routing.md, and follow them exactly.",
            common(),
            f"Checks that must stay green: {checks_str}.",
            f'Commit message: "{commit_msg}".',
            f"AFTER shots: `{inp['shootCmd']} --label round-{n} --compare round-0` — return every path it prints.",
            f"Suggested chain (routing.md defaults; you choose the final chain, polish always last): {' → '.join(plan)}",
            f"Problems from check {n}, ranked, each with its default route (fix P0 → P1 → P2; P3 only in files you already touch):\n{json.dumps(routed, indent=2)}",
        ])
        fixer = await safe_agent(fixer_prompt, FIX, f"fixer r{n}")
        if not fixer:
            stop_reason = f"fixer r{n} died"
            break
        open_questions.extend(fixer.get("openQuestions") or [])
        round_rec["fix"] = fixer

        oos_list = fixer.get("outOfScope") or []
        oos_text = "; ".join(f"{o['file']} ({o['why']})" for o in oos_list)
        oos = f" · out-of-scope: {oos_text}" if oos_list else ""
        fixed_str = ", ".join(fixer.get("fixed") or []) or "—"
        skipped_str = ", ".join(s["id"] for s in (fixer.get("skipped") or [])) or "—"
        cmds_str = " → ".join(fixer.get("commands") or [])
        ledger.append(
            f"{head} · {round_rec['counts']} · {fixer['status']} {fixer.get('commit') or ''} [{cmds_str}]"
            f"\n  fixed: {fixed_str} · skipped: {skipped_str}{oos}"
        )
        log_fn(ledger[-1].split("\n")[0])

        if fixer["status"] == "reverted":
            fix_fails += 1
            if fix_fails >= 2:
                stop_reason = "two fix rounds in a row went red and were reverted"
                break
            continue
        fix_fails = 0
        if fixer["status"] == "committed":
            for pid in fixer.get("fixed") or []:
                p = next((x for x in problems if x.get("id") == pid), None)
                if p:
                    claims = [c for c in claims if c.get("id") != pid]
                    claims.append({**p, "round": n})
            if fixer.get("afterShots"):
                shots = list(fixer["afterShots"])
                final_label = f"round-{n}"

    finish = None
    if claims and final_label != "round-0":
        phase_fn("Finish")
        finish_prompt = "\n\n".join([
            f"You are the finish reviewer. Read {ref}/finish-reviewer-brief.md and follow it exactly.",
            common(),
            shot_block(shots, before_shots, extra_shots, "final"),
            f"Claimed fixes to grade (one grade each):\n{json.dumps(claims, indent=2)}",
        ])
        finish = await safe_agent(finish_prompt, FINISH, "finish")

    first = rounds[0] if rounds else None
    last = rounds[-1] if rounds else None
    score_parts: List[str] = []
    for r in rounds:
        suffix = f" ({r['vsBefore']})" if r["n"] > 1 else ""
        score_parts.append(f"C{r['n']} {r['visual']}/40{suffix}")
    score_line = " → ".join(score_parts)

    return {
        "method": method,
        "degraded": degraded,
        "warnings": inp.get("warnings") if inp.get("warnings") is not None else [],
        "stopReason": stop_reason,
        "scoreLine": score_line,
        "before": first["visual"] if first else None,
        "after": last["visual"] if last else None,
        "ledger": ledger,
        "rounds": rounds,
        "finalLabel": final_label,
        "finalShots": shots,
        "grades": finish["grades"] if finish else [],
        "regressions": finish["regressions"] if finish else [],
        "disposition": finish["disposition"] if finish else ("finish reviewer died — fixes ungraded" if claims else "no fixes landed"),
        "openQuestions": open_questions,
    }


if "args" in globals() and "agent" in globals():
    _res = await run_ui_refine(
        args,
        agent_fn=agent,
        parallel_fn=globals().get("parallel"),
        phase_fn=globals().get("phase"),
        log_fn=globals().get("log"),
    )
    print(json.dumps(_res, indent=2))
