"""Factory workflow for Gemini Antigravity (`run_workflow`).

Runs a coding contract through a coordinated team of agents:
- Planner (gemini-4-neon-xhigh) turns the contract into specs; code validates them
- Implementer (gemini-4-carbon-medium, or gemini-4-neon-high on rebuild) builds each spec test-first (TDD)
- QA (gemini-4-carbon-medium) verifies tests against the spec, closes serious gaps, runs security pass
- Checker (gemini-4-hydrogen-low) runs checks, flaky reruns, culprit isolation, TDD base runs, migrations
- Reviewer (gemini-4-neon-high, gemini-4-carbon-medium at low risk, gemini-4-neon-xhigh at high risk) judges the whole change against the contract
- Spec Reviewer (gemini-4-carbon-medium, or gemini-4-neon-high at high risk) reviews one spec line-by-line when split
- QC (gemini-4-hydrogen-medium) runs the product and checks each criterion, mockups, baseline, and a11y

Orchestrated strictly by code via Antigravity's `run_workflow` tool.
"""

import json
import os
import re
import subprocess
import tempfile
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

META = {
    "name": "factory",
    "description": (
        "Run a coding contract through a planner, one test-first implementer and one QA agent per spec, "
        "a checker, fresh reviewers and a QC agent that uses the product; a spec that fails QA, review "
        "or QC goes back to Build, a bounded number of times"
    ),
    "whenToUse": "Called by the factory skill after the contract is written. Not meant to be started without its args.",
    "phases": [
        {"title": "Spec", "detail": "planner turns the contract into specs; code validates them"},
        {
            "title": "Build",
            "detail": (
                "per spec: the implementer writes the tests first, then the code; then QA. "
                "A spec QA sends back is rebuilt and checked again"
            ),
        },
        {"title": "Check", "detail": "checker runs the contract checks and lists changed files"},
        {
            "title": "Review",
            "detail": (
                "only once every check passes: reviewers chosen by the run's risk (one for the whole change, "
                "plus one per spec when the work was split above low risk) and a QC agent that runs the product; "
                "the specs a failure concerns go back to Build, and a passing run is marked for a person when it "
                "touches what one must see"
            ),
        },
    ],
}

# ---------------------------------------------------------------------------
# Pure helpers. No agents, no I/O: these are the rules that code enforces so
# that no agent has to be trusted to follow them.
# ---------------------------------------------------------------------------


def norm_path(p: Any) -> str:
    s = str(p or "").strip()
    if s.startswith("./"):
        s = s[2:]
    return s.rstrip("/")


def is_blank(v: Any) -> bool:
    return v is None or str(v).strip() == ""


def git_changed_files(repo: str, base: str) -> Optional[List[str]]:
    """Read changed + untracked repository paths directly from git so a checker
    LLM typo can never cause a false ownership/protected-file block.

    Returns None when ``repo`` is not a real git working tree or ``base`` does
    not resolve to a commit (e.g. stubbed unit tests), so callers fall back to
    the checker's reported ``changedFiles``.
    """
    if is_blank(repo) or is_blank(base) or not os.path.isdir(str(repo)):
        return None
    try:
        verify = subprocess.run(
            ["git", "-C", str(repo), "cat-file", "-e", f"{base}^{{commit}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if verify.returncode != 0:
            return None
        diff = subprocess.run(
            ["git", "-C", str(repo), "diff", "--name-only", str(base)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        untracked = subprocess.run(
            ["git", "-C", str(repo), "ls-files", "--others", "--exclude-standard"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if diff.returncode != 0 or untracked.returncode != 0:
            return None
    except Exception:
        return None
    seen: Set[str] = set()
    out: List[str] = []
    for line in diff.stdout.splitlines() + untracked.stdout.splitlines():
        p = norm_path(line)
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def has_code(spec: Dict[str, Any]) -> bool:
    return isinstance(spec.get("filesOwned"), list) and len(spec["filesOwned"]) > 0


def has_tests(spec: Dict[str, Any]) -> bool:
    return isinstance(spec.get("testFiles"), list) and len(spec["testFiles"]) > 0


def spec_files(spec: Dict[str, Any]) -> List[str]:
    files = list(spec.get("filesOwned") or []) + list(spec.get("testFiles") or [])
    return [norm_path(f) for f in files]


# --- Models -----------------------------------------------------------------
# Gemini Antigravity model for each role (kept in sync with
# `factory/catalog/model-profiles.json` and live `agy models`). The planner is
# where a mistake costs the most, since every agent after it builds on its
# specs, so it gets `gemini-4-neon-xhigh`; the whole-change reviewer and
# rebuilds get `gemini-4-neon-high`. Implementers, QA and spec reviewers run on
# `gemini-4-carbon-medium` for speed and balance; QC runs on
# `gemini-4-hydrogen-medium` and the checker on `gemini-4-hydrogen-low`.
# `args.modelProfile` selects a preset (`balanced`, `fast`, `flagship`,
# `orchestrator`, `inherit`) and `args.models` can replace any role with any
# Gemini 4 / Orchestrator / Gemini 3.8 model ID or legacy tier alias (`pro`,
# `flash`, `flash_lite`, `inherit`). When a `run_workflow` runner only accepts
# the 4 tier enums, `spawn()` maps each model via `workflow_model_tier()`.
MODEL_TIERS: Dict[str, str] = {
    # Gemini 4 Neon (flagship reasoning -> pro tier)
    "gemini-4-neon-xhigh": "pro",
    "gemini-4-neon-high": "pro",
    "gemini-4-neon-medium": "pro",
    "gemini-4-neon-low": "pro",
    # Gemini 4 Carbon (balanced daily driver -> flash tier)
    "gemini-4-carbon-high": "flash",
    "gemini-4-carbon-medium": "flash",
    "gemini-4-carbon-low": "flash",
    # Gemini 4 Argon (leaving soon -> flash tier)
    "gemini-4-argon-high": "flash",
    "gemini-4-argon-medium": "flash",
    "gemini-4-argon-low": "flash",
    # Gemini 4 Hydrogen (fast / lightweight -> flash_lite tier)
    "gemini-4-hydrogen-xhigh": "flash_lite",
    "gemini-4-hydrogen-high": "flash_lite",
    "gemini-4-hydrogen-medium": "flash_lite",
    "gemini-4-hydrogen-low": "flash_lite",
    # Gemini Pro Orchestrator (orchestration & planning -> pro tier)
    "gemini-pro-orchestrator-neon": "pro",
    "gemini-pro-orchestrator": "pro",
    "gemini-pro-orchestrator-argon": "pro",
    # Gemini 3.8 Flash (leaving soon -> flash tier)
    "gemini-3.8-flash-high": "flash",
    "gemini-3.8-flash-medium": "flash",
    "gemini-3.8-flash-low": "flash",
    # Legacy run_workflow tier aliases
    "pro": "pro",
    "flash": "flash",
    "flash_lite": "flash_lite",
    "inherit": "inherit",
}
MODEL_NAMES: List[str] = list(MODEL_TIERS.keys())

MODELS: Dict[str, Dict[str, str]] = {
    "planner": {"model": "gemini-4-neon-xhigh"},
    "implementer": {"model": "gemini-4-carbon-medium"},
    "qa": {"model": "gemini-4-carbon-medium"},
    "rebuild": {"model": "gemini-4-neon-high"},
    "checker": {"model": "gemini-4-hydrogen-low"},
    "reviewer": {"model": "gemini-4-neon-high"},
    "specReviewer": {"model": "gemini-4-carbon-medium"},
    "qc": {"model": "gemini-4-hydrogen-medium"},
}

# Named model profiles (kept in sync with `factory/catalog/model-profiles.json`).
MODEL_PROFILES: Dict[str, Dict[str, Dict[str, str]]] = {
    "balanced": MODELS,
    "fast": {
        "planner": {"model": "gemini-4-carbon-high"},
        "implementer": {"model": "gemini-4-carbon-medium"},
        "qa": {"model": "gemini-4-hydrogen-medium"},
        "rebuild": {"model": "gemini-4-carbon-high"},
        "checker": {"model": "gemini-4-hydrogen-low"},
        "reviewer": {"model": "gemini-4-carbon-medium"},
        "specReviewer": {"model": "gemini-4-hydrogen-medium"},
        "qc": {"model": "gemini-4-hydrogen-medium"},
    },
    "flagship": {
        "planner": {"model": "gemini-4-neon-xhigh"},
        "implementer": {"model": "gemini-4-neon-high"},
        "qa": {"model": "gemini-4-neon-high"},
        "rebuild": {"model": "gemini-4-neon-xhigh"},
        "checker": {"model": "gemini-4-carbon-low"},
        "reviewer": {"model": "gemini-4-neon-xhigh"},
        "specReviewer": {"model": "gemini-4-neon-high"},
        "qc": {"model": "gemini-4-carbon-high"},
    },
    "orchestrator": {
        "planner": {"model": "gemini-pro-orchestrator-neon"},
        "implementer": {"model": "gemini-4-carbon-high"},
        "qa": {"model": "gemini-4-carbon-medium"},
        "rebuild": {"model": "gemini-pro-orchestrator-neon"},
        "checker": {"model": "gemini-4-hydrogen-low"},
        "reviewer": {"model": "gemini-pro-orchestrator-neon"},
        "specReviewer": {"model": "gemini-4-carbon-high"},
        "qc": {"model": "gemini-4-hydrogen-medium"},
    },
    "inherit": {
        "planner": {"model": "inherit"},
        "implementer": {"model": "inherit"},
        "qa": {"model": "inherit"},
        "rebuild": {"model": "inherit"},
        "checker": {"model": "inherit"},
        "reviewer": {"model": "inherit"},
        "specReviewer": {"model": "inherit"},
        "qc": {"model": "inherit"},
    },
}


def workflow_model_tier(model_name: Optional[str]) -> Optional[str]:
    """Map a concrete Gemini model ID or tier alias to its `run_workflow` tier (`pro`/`flash`/`flash_lite`), or `None` for `inherit`."""
    if not model_name or not isinstance(model_name, str):
        return None
    name = model_name.strip()
    if not name or name == "inherit":
        return None
    tier = MODEL_TIERS.get(name)
    if tier:
        return None if tier == "inherit" else tier
    lower = name.lower()
    if "neon" in lower or "orchestrator" in lower or lower == "pro":
        return "pro"
    if "hydrogen" in lower or "lite" in lower:
        return "flash_lite"
    if "carbon" in lower or "argon" in lower or "flash" in lower:
        return "flash"
    return None


MODEL_REJECTION_RE = re.compile(
    r"(?:invalid|unknown|unsupported|unrecognized|must be one of|not a valid|enum).{0,40}(?:model|tier)"
    r"|(?:model|tier).{0,40}(?:invalid|unknown|unsupported|unrecognized|must be one of|not a valid|enum)",
    re.IGNORECASE | re.DOTALL,
)


def is_model_rejection_error(exc: BaseException) -> bool:
    """Return True when a runner error indicates `agent(model=...)` rejected a concrete model ID."""
    return bool(MODEL_REJECTION_RE.search(str(exc or "")))


def model_profile_problems(profile: Any) -> List[str]:
    """Return human-readable problems with `args.modelProfile`; empty means usable."""
    if profile is None or profile == "":
        return []
    if not isinstance(profile, str) or profile not in MODEL_PROFILES:
        return [f'"modelProfile" must be one of {", ".join(MODEL_PROFILES.keys())}.']
    return []


def resolve_models_for_profile(
    profile: Any,
    overrides: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Merge an optional `args.modelProfile` underneath explicit `args.models` overrides."""
    if not profile or profile == "balanced" or not isinstance(profile, str) or profile not in MODEL_PROFILES:
        return overrides
    base = MODEL_PROFILES[profile]
    ovr = overrides if isinstance(overrides, dict) else {}
    out: Dict[str, Any] = {}
    roles_order = list(base.keys())
    for r in ovr:
        if r not in roles_order:
            roles_order.append(r)
    for role in roles_order:
        out[role] = {**(base.get(role) or {}), **(ovr.get(role) if isinstance(ovr.get(role), dict) else {})}
    return out


def model_problems(overrides: Any) -> List[str]:
    """Return human-readable problems with `args.models`; empty means usable."""
    if overrides is None:
        return []
    if not isinstance(overrides, dict):
        return ['"models" must be an object of roles.']
    problems: List[str] = []
    for role, entry in overrides.items():
        if role not in MODELS:
            problems.append(f'"models" names {role}, which is not a role ({", ".join(MODELS.keys())}).')
            continue
        if not isinstance(entry, dict):
            problems.append(f'"models.{role}" must be an object with "model".')
            continue
        if "model" in entry and entry["model"] not in MODEL_NAMES:
            problems.append(f'"models.{role}.model" must be one of {", ".join(MODEL_NAMES)}.')
    return problems


def model_for(role: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    """Return agent() options for one role: `{"model": ...}` or `{}` for `"inherit"`."""
    entry = dict(MODELS.get(role) or {})
    if isinstance(overrides, dict) and isinstance(overrides.get(role), dict):
        entry.update(overrides[role])
    opts: Dict[str, str] = {}
    if entry.get("model") and entry["model"] != "inherit":
        opts["model"] = entry["model"]
    return opts


# --- Skills -----------------------------------------------------------------
SKILLS: Dict[str, Any] = {
    "kinds": ["feature", "bug", "ux", "refactor", "tech-debt", "tests", "docs"],
    "implementer": {
        "feature": ["tdd", "codebase-design"],
        "bug": ["diagnosing-bugs", "tdd"],
        "ux": ["tdd"],
        "refactor": ["codebase-design", "tdd"],
        "tech-debt": ["codebase-design", "tdd"],
        "tests": ["tdd"],
        "docs": [],
    },
    "always": {
        "planner": ["codebase-design"],
        "implementer": ["verification-before-completion", "mp-code-review"],
        "qa": [
            "tdd",
            "diagnosing-bugs",
            "verification-before-completion",
            "testing-strategy",
            "mp-code-review",
            "pr-security-review",
        ],
        "reviewer": ["mp-code-review", "codebase-design"],
        "specReviewer": ["mp-code-review", "codebase-design"],
    },
    "conditional": {
        "planner": {
            "domain-modeling": (
                "when the ticket names a domain concept the code does not have yet, "
                "or uses a word the code means differently; settle the term in the specs, not in files"
            ),
        },
        "implementer": {
            "vitest": "when the tests run on Vitest (the repository's package.json or config says so)",
            "playwright-best-practices": (
                "when the test for a criterion has to drive a browser, or the repository tests with Playwright"
            ),
            "testing-strategy": "when the spec leaves open which cases are worth a test",
            "domain-modeling": (
                "when the change names a domain concept the codebase does not have yet; "
                "sharpen the term, and write it only into files you own"
            ),
        },
        "qa": {
            "vitest": "when the tests run on Vitest (the repository's package.json or config says so)",
            "playwright-best-practices": (
                "when a gap can only be shown through a browser, or the repository tests with Playwright"
            ),
        },
        "qc": {},
    },
    "surfaces": {
        "security": {
            "reviewer": ["pr-security-review"],
            "specReviewer": ["pr-security-review"],
        },
    },
    "interactive": [
        "grill-me",
        "grilling",
        "grill-with-docs",
        "wizard",
        "teach",
        "to-questionnaire",
        "wait-what",
        "ask-matt",
        "setup-matt-pocock-skills",
    ],
}


def required_skills() -> List[str]:
    """Every skill the registry can hand out that the session must have installed."""
    all_items: List[str] = []
    for row in SKILLS["implementer"].values():
        all_items.extend(row)
    for row in SKILLS["always"].values():
        all_items.extend(row)
    for surf in SKILLS["surfaces"].values():
        for row in surf.values():
            all_items.extend(row)
    return sorted(set(all_items))


def optional_skills() -> List[str]:
    """Skills only of the conditional tier: offered when installed, never required."""
    req = set(required_skills())
    cond: Set[str] = set()
    for row in SKILLS["conditional"].values():
        cond.update(row.keys())
    return sorted(cond - req)


def repo_skills_for(
    available: Optional[Dict[str, Any]],
    repo: Optional[str],
    loaded: Optional[List[str]] = None,
) -> List[Dict[str, str]]:
    """Return project-local skills under `<repo>/.agents/skills/` or `<repo>/.gemini/skills/`."""
    repo_base = str(repo or "").rstrip("/")
    if not repo_base:
        return []
    roots = (f"{repo_base}/.agents/skills/", f"{repo_base}/.gemini/skills/")
    loaded_set = set(loaded or [])
    out: List[Dict[str, str]] = []
    for name, path in (available or {}).items():
        p = str(path or "")
        if any(p.startswith(r) for r in roots) and name not in loaded_set:
            out.append({
                "name": name,
                "when": (
                    "a skill of this project: read its description, and load it when it covers "
                    "the code, library or pattern you work on"
                ),
            })
    return out


def conditional_for(
    role: str,
    available: Optional[Dict[str, Any]],
    loaded: Optional[List[str]] = None,
    repo: Optional[str] = None,
) -> List[Dict[str, str]]:
    have = available if isinstance(available, dict) else {}
    loaded_list = list(loaded or [])
    loaded_set = set(loaded_list)
    listed = [
        {"name": name, "when": when}
        for name, when in SKILLS["conditional"].get(role, {}).items()
        if not is_blank(have.get(name)) and name not in loaded_set
    ]
    own = [] if role == "checker" else repo_skills_for(have, repo, [*loaded_list, *[item["name"] for item in listed]])
    return [*listed, *own]


def missing_skills(available: Optional[Dict[str, Any]]) -> List[str]:
    have = available if isinstance(available, dict) else {}
    return [n for n in required_skills() if is_blank(have.get(n))]


def missing_project_skills(project: Optional[Dict[str, Any]], available: Optional[Dict[str, Any]]) -> List[str]:
    have = available if isinstance(available, dict) else {}
    seen: List[str] = []
    for vals in (project or {}).values():
        if isinstance(vals, list):
            for n in vals:
                if n not in seen:
                    seen.append(n)
    return [n for n in seen if is_blank(have.get(n))]


def skills_for(
    role: str,
    spec: Optional[Dict[str, Any]] = None,
    surfaces: Optional[List[str]] = None,
    project: Optional[Dict[str, Any]] = None,
) -> List[str]:
    extra: List[str] = []
    for s in surfaces or []:
        extra.extend((SKILLS["surfaces"].get(s) or {}).get(role, []))
    proj_role = "reviewer" if role == "specReviewer" else role
    stack = list((project or {}).get(proj_role) or [])
    own: List[str] = []
    if role == "implementer" and spec:
        spec_skills = spec.get("skills")
        if isinstance(spec_skills, list) and len(spec_skills) > 0:
            own = list(spec_skills)
        else:
            own = list(SKILLS["implementer"].get(spec.get("kind"), []))
    combined = [*own, *(SKILLS["always"].get(role) or []), *extra, *stack]
    deduped: List[str] = []
    for name in combined:
        if name not in deduped:
            deduped.append(name)
    return deduped


def validate_specs(
    specs: Any,
    contract: Dict[str, Any],
    available: Optional[List[str]] = None,
    guarded: Optional[Callable[[str], bool]] = None,
) -> List[str]:
    """Return a list of human-readable problems; empty means the specs are usable."""
    problems: List[str] = []
    if not isinstance(specs, list) or len(specs) == 0:
        return ["No specs were returned."]

    ids: Set[str] = set()
    for s in specs:
        sid = s.get("id")
        if is_blank(sid):
            problems.append("A spec has no id.")
            continue
        if sid in ids:
            problems.append(f"Spec id {sid} is used more than once.")
        ids.add(sid)
        for field in ("title", "goal", "tests"):
            if is_blank(s.get(field)):
                problems.append(f'Spec {sid}: "{field}" is empty.')
        if not has_code(s) and not has_tests(s):
            problems.append(f"Spec {sid}: owns no files.")
        if has_code(s):
            if is_blank(s.get("changes")):
                problems.append(f'Spec {sid}: "changes" is empty.')
            if not isinstance(s.get("doneWhen"), list) or len(s["doneWhen"]) == 0:
                problems.append(f'Spec {sid}: has no "doneWhen" checklist.')
        if not isinstance(s.get("criteria"), list) or len(s["criteria"]) == 0:
            problems.append(f"Spec {sid}: is responsible for no criterion.")
        if s.get("kind") not in SKILLS["kinds"]:
            problems.append(f'Spec {sid}: "kind" must be one of {", ".join(SKILLS["kinds"])}.')
        for name in s.get("skills") or []:
            if name in SKILLS["interactive"]:
                problems.append(f"Spec {sid}: skill {name} waits on a person, and nobody answers during a run.")
            elif available is not None and name not in available:
                problems.append(f"Spec {sid}: skill {name} is not installed for this run.")

    known = {c["id"] for c in contract.get("criteria") or []}
    covered: Set[str] = set()
    for s in specs:
        sid = s.get("id")
        for c in s.get("criteria") or []:
            if c not in known:
                problems.append(f"Spec {sid}: names criterion {c}, which is not in the contract.")
            covered.add(c)
    for c in contract.get("criteria") or []:
        if c["id"] not in covered:
            problems.append(f"Criterion {c['id']} is not covered by any spec.")

    owner: Dict[str, str] = {}
    for s in specs:
        sid = s.get("id")
        kinds: Dict[str, str] = {}
        for kind, files in (("filesOwned", s.get("filesOwned")), ("testFiles", s.get("testFiles"))):
            for raw in files or []:
                f = norm_path(raw)
                if not f:
                    problems.append(f"Spec {sid}: has an empty file path.")
                    continue
                if f in kinds and kinds[f] != kind:
                    problems.append(
                        f"Spec {sid}: file {f} is listed in both filesOwned and testFiles; "
                        "a file is either source or test."
                    )
                kinds[f] = kind
                if f in owner and owner[f] != sid:
                    problems.append(f"File {f} is owned by both {owner[f]} and {sid}; a file may have one owner only.")
                owner[f] = sid
                if guarded and guarded(f):
                    problems.append(
                        f"Spec {sid}: owns {f}, which is protected: the checks a run is judged by may not change in it. "
                        'Reach the criterion without it, or the caller must allow it with "allowProtected".'
                    )

    for s in specs:
        sid = s.get("id")
        for d in s.get("dependsOn") or []:
            if d == sid:
                problems.append(f"Spec {sid}: depends on itself.")
            elif d not in ids:
                problems.append(f"Spec {sid}: depends on {d}, which does not exist.")

    if len(problems) == 0 and build_levels(specs) is None:
        problems.append('The "dependsOn" links form a cycle, so there is no order in which the specs can be built.')
    return problems


def build_levels(specs: List[Dict[str, Any]]) -> Optional[List[List[Dict[str, Any]]]]:
    """Group specs into dependency levels; return None on a cycle."""
    done: Set[str] = set()
    remaining = list(specs)
    levels: List[List[Dict[str, Any]]] = []
    while remaining:
        ready = [s for s in remaining if all(d in done for d in (s.get("dependsOn") or []))]
        if not ready:
            return None
        levels.append(ready)
        for s in ready:
            done.add(s["id"])
        remaining = [s for s in remaining if s["id"] not in done]
    return levels


def owned_files(specs: List[Dict[str, Any]]) -> Set[str]:
    result: Set[str] = set()
    for s in specs:
        result.update(spec_files(s))
    return result


def repo_path(p: Any, repo: Optional[str] = None) -> str:
    root = str(repo or "").rstrip("/")
    f = norm_path(p)
    if root and f.startswith(f"{root}/"):
        return f[len(root) + 1 :]
    return f


def files_outside_assignment(
    files_changed: Optional[List[str]],
    allowed: Optional[List[str]],
    repo: Optional[str] = None,
) -> List[str]:
    mine = {repo_path(p, repo) for p in (allowed or [])}
    out: List[str] = []
    for raw in files_changed or []:
        f = repo_path(raw, repo)
        if f and f not in mine:
            out.append(f)
    return out


def tests_changed(
    files_changed: Optional[List[str]],
    spec: Dict[str, Any],
    repo: Optional[str] = None,
) -> List[str]:
    tests = {repo_path(p, repo) for p in (spec.get("testFiles") or [])}
    out: List[str] = []
    for raw in files_changed or []:
        f = repo_path(raw, repo)
        if f in tests and f not in out:
            out.append(f)
    return out


GENERATED = [
    "**/__pycache__",
    "*.pyc",
    "**/.pytest_cache",
    "**/.mypy_cache",
    "**/.ruff_cache",
    "**/.DS_Store",
]

# Factory workspace artifacts (BA briefs, decisions, plans, mockups, run logs,
# init fingerprints) written by BA/clarify/init steps. They are not source code
# and not check configuration, so they must never block a run as stray or
# protected files.
FACTORY_ARTIFACTS = [
    ".factory/product.md",
    ".factory/decisions.md",
    ".factory/plans",
    ".factory/runs",
    ".factory/design",
    ".factory/init.json",
]


def matches_ignore(file: Any, entry: Any) -> bool:
    e = norm_path(entry)
    f = str(file or "")
    if not e:
        return False
    if e.startswith("**/"):
        return e[3:] in f.split("/")
    if e.startswith("*."):
        return f.endswith(e[1:])
    return f == e or f.startswith(f"{e}/")


def matches_glob(file: Any, pattern: Any) -> bool:
    """Case-insensitive glob: `**` crosses dirs, `*` stays inside one segment, bare name matches any depth."""
    f = norm_path(file)
    p = norm_path(pattern)
    if not f or not p:
        return False
    if "/" not in p:
        p = f"**/{p}"
    parts: List[str] = []
    for part in p.split("**/"):
        subparts: List[str] = []
        for s in part.split("**"):
            subparts.append("[^/]*".join(re.escape(x) for x in s.split("*")))
        parts.append(".*".join(subparts))
    regex_str = "(?:.*/)?".join(parts)
    return re.fullmatch(regex_str, f, re.IGNORECASE) is not None


PROTECTED = [
    ".github/**",
    ".gitlab-ci.yml",
    ".circleci/**",
    "Jenkinsfile",
    "azure-pipelines.yml",
    "vitest.config.*",
    "vitest.workspace.*",
    "jest.config.*",
    "playwright.config.*",
    "karma.conf.*",
    "cypress.config.*",
    "pytest.ini",
    "tox.ini",
    "noxfile.py",
    "mypy.ini",
    ".flake8",
    "ruff.toml",
    ".ruff.toml",
    ".eslintrc*",
    "eslint.config.*",
    ".prettierrc*",
    "prettier.config.*",
    "biome.json",
    "biome.jsonc",
    "tsconfig*.json",
    "factory/checks.sh",
    ".factory/project.json",
    "CODING_STANDARDS.md",
]


def allows_all_protected(allowed: Any) -> bool:
    """Return True when the caller explicitly allows changing any protected file."""
    if allowed is True:
        return True
    if isinstance(allowed, str):
        return norm_path(allowed) in ("*", "**")
    if isinstance(allowed, list):
        return any(x is True or (isinstance(x, str) and norm_path(x) in ("*", "**")) for x in allowed)
    return False


def _normalize_allowed_patterns(allowed: Any) -> List[str]:
    if isinstance(allowed, str):
        p = norm_path(allowed)
        return [p] if p else []
    if isinstance(allowed, list):
        return [norm_path(x) for x in allowed if isinstance(x, str) and norm_path(x)]
    return []


def protected_list(extra: Optional[List[str]] = None, allowed: Any = None) -> List[str]:
    if allows_all_protected(allowed):
        return []
    allow = _normalize_allowed_patterns(allowed)
    out: List[str] = []
    for raw in [*PROTECTED, *(extra or [])]:
        p = norm_path(raw)
        if p and p not in allow:
            out.append(p)
    return out


def protected_files(
    files: Optional[List[str]],
    extra: Optional[List[str]] = None,
    allowed: Any = None,
) -> List[str]:
    if allows_all_protected(allowed):
        return []
    patterns = protected_list(extra, allowed)
    allow = _normalize_allowed_patterns(allowed)
    out: List[str] = []
    for raw in files or []:
        f = norm_path(raw)
        if not f:
            continue
        if any(a == f or matches_glob(f, a) for a in allow):
            continue
        if any(matches_glob(f, p) for p in patterns):
            out.append(f)
    return out


# --- Risk -------------------------------------------------------------------
SENSITIVE: Dict[str, List[str]] = {
    "auth": [
        "**/auth/**",
        "**/*auth*",
        "**/*login*",
        "**/*session*",
        "**/*permission*",
        "**/*rbac*",
        "**/*acl*",
        "**/*oauth*",
        "**/*jwt*",
        "**/*password*",
    ],
    "money": [
        "**/*payment*",
        "**/*billing*",
        "**/*invoice*",
        "**/*stripe*",
        "**/*checkout*",
        "**/*pricing*",
        "**/*subscription*",
    ],
    "migration": ["**/migrations/**", "**/migrate/**", "**/*.sql", "**/schema.prisma", "**/alembic/**"],
    "dependency": [
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lockb",
        "requirements*.txt",
        "pyproject.toml",
        "poetry.lock",
        "uv.lock",
        "Pipfile",
        "Pipfile.lock",
        "go.mod",
        "go.sum",
        "Cargo.toml",
        "Cargo.lock",
        "Gemfile",
        "Gemfile.lock",
        "composer.json",
        "composer.lock",
    ],
    "ci": [
        ".github/**",
        ".gitlab-ci.yml",
        ".circleci/**",
        "Jenkinsfile",
        "Dockerfile",
        "**/Dockerfile",
        "docker-compose*.yml",
        "compose*.yml",
        "vercel.json",
        "netlify.toml",
        "fly.toml",
        "**/*.tf",
        "Procfile",
        "app.yaml",
    ],
}
UI_FILES = [
    "*.tsx",
    "*.jsx",
    "*.vue",
    "*.svelte",
    "*.astro",
    "*.css",
    "*.scss",
    "*.sass",
    "*.less",
    "*.html",
    "*.erb",
    "*.blade.php",
]
RISKS = ["low", "medium", "high"]
SURFACES = ["ui", "security", "data"]


def sensitive_kinds(files: Optional[List[str]]) -> List[str]:
    clean = [norm_path(f) for f in (files or [])]
    clean = [f for f in clean if f]
    return [k for k, patterns in SENSITIVE.items() if any(matches_glob(f, p) for f in clean for p in patterns)]


ROUTING: Dict[str, Dict[str, Any]] = {
    "low": {"specReviews": False, "models": {"reviewer": {"model": "gemini-4-carbon-medium"}}},
    "medium": {"specReviews": True, "models": {}},
    "high": {
        "specReviews": True,
        "models": {"reviewer": {"model": "gemini-4-neon-xhigh"}, "specReviewer": {"model": "gemini-4-neon-high"}},
    },
}


def assess_risk(
    rated: Optional[str],
    surfaces: Optional[List[str]],
    specs: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    files = [f for s in (specs or []) for f in (s.get("filesOwned") or [])]
    kinds = sensitive_kinds(files)
    risk = rated if rated in RISKS else "medium"
    surface_set = {x for x in (surfaces or []) if x in SURFACES}
    raised_by: List[str] = []

    def raise_to(to: str, why: str) -> None:
        nonlocal risk
        if RISKS.index(to) > RISKS.index(risk):
            risk = to
            raised_by.append(why)

    if "auth" in kinds or "money" in kinds:
        surface_set.add("security")
        sec_kinds = [k for k in kinds if k in ("auth", "money")]
        raise_to("high", f"the specs own {' and '.join(sec_kinds)} files")
    if "migration" in kinds:
        surface_set.add("data")
        raise_to("high", "the specs own a migration")
    if "dependency" in kinds or "ci" in kinds:
        dep_kinds = [k for k in kinds if k in ("dependency", "ci")]
        raise_to("medium", f"the specs own {' and '.join(dep_kinds)} files")
    if any(matches_glob(norm_path(f), p) for f in files for p in UI_FILES):
        surface_set.add("ui")
    return {
        "risk": risk,
        "surfaces": [x for x in SURFACES if x in surface_set],
        "raisedBy": raised_by,
    }


def routed_models(risk: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Dict[str, Any]]:
    routed = (ROUTING.get(risk) or ROUTING["medium"])["models"]
    ovr = overrides or {}
    roles_order = list(routed.keys())
    for r in ovr:
        if r not in roles_order:
            roles_order.append(r)
    out: Dict[str, Dict[str, Any]] = {}
    for role in roles_order:
        out[role] = {**(routed.get(role) or {}), **(ovr.get(role) or {})}
    return out


ESCALATE = ["auth", "money", "migration", "dependency", "ci", "high-risk", "ui", "tests-rewritten"]


def escalation(
    changed_files: Optional[List[str]],
    assessed: Optional[Dict[str, Any]],
    tests_changed_in_rebuild: Optional[List[Any]],
    escalate: Optional[List[str]] = None,
) -> Dict[str, Any]:
    on = set(escalate if isinstance(escalate, list) else ESCALATE)
    reasons: List[str] = []
    files = [norm_path(f) for f in (changed_files or [])]
    files = [f for f in files if f]
    for k in sensitive_kinds(files):
        if k not in on:
            continue
        which = [f for f in files if any(matches_glob(f, p) for p in SENSITIVE[k])]
        reasons.append(f"{k}: {', '.join(which)}")
    if "high-risk" in on and assessed and assessed.get("risk") == "high":
        raised = assessed.get("raisedBy") or []
        suffix = f" ({'; '.join(raised)})" if raised else ""
        reasons.append(f"high-risk: rated high{suffix}")
    if "ui" in on and assessed and "ui" in (assessed.get("surfaces") or []):
        reasons.append("ui: a user will see this change; the person who asked for it should try it")
    if "tests-rewritten" in on and len(tests_changed_in_rebuild or []) > 0:
        tests: List[str] = []
        for t in tests_changed_in_rebuild or []:
            items = [t] if isinstance(t, str) else (t.get("files") or [])
            for item in items:
                if item not in tests:
                    tests.append(item)
        reasons.append(f"tests-rewritten: test files changed after the first build ({', '.join(tests)})")
    return {"decision": "person" if reasons else "auto", "reasons": reasons}


def files_outside_ownership(
    changed_files: Optional[List[str]],
    specs: List[Dict[str, Any]],
    ignore_files: Optional[List[str]] = None,
) -> List[str]:
    owned = owned_files(specs)
    ignore = [*GENERATED, *FACTORY_ARTIFACTS, *(ignore_files or [])]
    out: List[str] = []
    for raw in changed_files or []:
        f = norm_path(raw)
        if f and f not in owned and not any(matches_ignore(f, e) for e in ignore):
            out.append(f)
    return out


def result_for(results: Optional[List[Dict[str, Any]]], check: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    items = results or []
    squash = lambda s: re.sub(r"\s+", " ", str(s or "")).strip()
    for r in items:
        if r.get("name") == check.get("name"):
            return r
    for r in items:
        if squash(r.get("name")) == squash(check.get("name")):
            return r
    for r in items:
        if squash(r.get("command")) == squash(check.get("command")):
            return r
    return None


def check_failures(
    contract: Dict[str, Any],
    check: Dict[str, Any],
    repo: Optional[str] = None,
) -> List[Dict[str, Any]]:
    failures: List[Dict[str, Any]] = []
    for c in contract.get("checks") or []:
        r = result_for(check.get("results"), c)
        if not r:
            failures.append({
                "kind": "check",
                "name": c["name"],
                "problem": f'Check "{c["name"]}" ({c["command"]}) was not run.',
            })
        elif r.get("exitCode") != 0 and r.get("rerunExitCode") == 0:
            continue
        elif r.get("exitCode") != 0:
            f: Dict[str, Any] = {
                "kind": "check",
                "name": c["name"],
                "problem": f'Check "{c["name"]}" ({c["command"]}) exited with {r.get("exitCode")}.',
                "outputTail": r.get("outputTail"),
            }
            culprits = [repo_path(p, repo) for p in (r.get("culprits") or [])]
            culprits = [p for p in culprits if p]
            if culprits:
                f["culprits"] = culprits
                f["problem"] += (
                    f" Its failing tests pass alone; they fail after {', '.join(culprits)}, "
                    "which leaves state behind."
                )
                if not is_blank(r.get("culpritEvidence")):
                    f["culpritEvidence"] = r["culpritEvidence"]
            failures.append(f)
    return failures


def flaky_checks(contract: Dict[str, Any], check: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for c in contract.get("checks") or []:
        r = result_for(check.get("results"), c)
        if r and r.get("exitCode") != 0 and r.get("rerunExitCode") == 0:
            out.append({"name": c["name"], "command": c["command"], "outputTail": r.get("outputTail")})
    return out


TDD_KINDS = ["feature", "bug", "ux"]


def tdd_targets(specs: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    return [s for s in (specs or []) if s.get("kind") in TDD_KINDS and len(s.get("testFiles") or []) > 0]


BASE_RUN_SKIP_RE = re.compile(r"^(?:n/?a|not\s+run|skipped|none|-)$", re.IGNORECASE)
BASE_RUN_CRASH_RE = re.compile(
    r"(?:ERR_MODULE_NOT_FOUND|Cannot find module|MODULE_NOT_FOUND|ImportError|ModuleNotFoundError|"
    r"ERR_ASSERTION|AssertionError|SyntaxError|ReferenceError|Traceback \(most recent call last\)|"
    r"(?:^|\n)\s*[✖✘]\s|(?:^|\n)\s*FAIL\s)",
    re.MULTILINE,
)


def tdd_failures(
    targets: List[Dict[str, Any]],
    base_runs: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    runs = {r["spec"]: r for r in (base_runs or []) if "spec" in r}
    failures: List[Dict[str, Any]] = []
    unproven: List[str] = []
    for s in targets:
        r = runs.get(s["id"])
        if not r:
            unproven.append(s["id"])
        elif r.get("exitCode") == 0:
            tail = str(r.get("outputTail") or "").strip()
            if tail and BASE_RUN_SKIP_RE.match(tail):
                unproven.append(s["id"])
                continue
            if tail and BASE_RUN_CRASH_RE.search(tail):
                # Checker accidentally captured cleanup's `$? == 0` after a real base-test failure.
                continue
            files = r.get("files") or s.get("testFiles") or []
            failures.append({
                "kind": "tdd",
                "spec": s["id"],
                "problem": (
                    f"The tests of {s['id']} ({', '.join(files)}) pass on the base code, without the change: "
                    "they do not test what the change adds. Write tests that fail without it, for each criterion."
                ),
            })
    return {"failures": failures, "unproven": unproven}


def migration_failures(contract: Dict[str, Any], check: Dict[str, Any]) -> List[Dict[str, Any]]:
    m = contract.get("migration")
    files = [
        norm_path(f)
        for f in (check.get("changedFiles") or [])
        if any(matches_glob(norm_path(f), p) for p in SENSITIVE["migration"])
    ]
    if not m or not files:
        return []
    ran = check.get("migration")
    if not ran or not ran.get("ran"):
        return [{
            "kind": "check",
            "name": "migration",
            "culprits": files,
            "problem": (
                f"The change adds or edits a migration ({', '.join(files)}), "
                "but it was not run up, down and up again."
            ),
        }]
    out: List[Dict[str, Any]] = []
    for st in ran.get("steps") or []:
        if st.get("exitCode") != 0:
            out.append({
                "kind": "check",
                "name": "migration",
                "culprits": files,
                "outputTail": st.get("outputTail"),
                "problem": f"Migration step `{st.get('command')}` exited with {st.get('exitCode')}.",
            })
    return out


def qc_failures(contract: Dict[str, Any], qc: Dict[str, Any]) -> List[Dict[str, Any]]:
    failures: List[Dict[str, Any]] = []
    judged = {c["id"]: c for c in (qc.get("criteria") or []) if "id" in c}
    for c in contract.get("criteria") or []:
        j = judged.get(c["id"])
        if not j:
            failures.append({"kind": "qc", "id": c["id"], "problem": f"Criterion {c['id']} was not judged by QC."})
        elif j.get("status") not in ("pass", "not_observable"):
            failures.append({
                "kind": "qc",
                "id": c["id"],
                "problem": (
                    f"Criterion {c['id']} fails when the product is used. "
                    f"Scenario: {j.get('scenario')} Expected: {j.get('expected')} Observed: {j.get('observed')}"
                ),
            })

    design = contract.get("design") or {}
    baseline = qc.get("baseline") or []
    for b in design.get("baseline") or []:
        j = next((x for x in baseline if x.get("screen") == b.get("screen")), None)
        if not j:
            failures.append({
                "kind": "regression",
                "screen": b.get("screen"),
                "problem": f'Screen "{b.get("screen")}" ({b.get("route")}) was not compared with how it looked before the change.',
            })
        elif j.get("status") == "regressed":
            diffs = "; ".join(j.get("differences") or []) or "no difference named"
            before = ", ".join(b.get("before") or [])
            failures.append({
                "kind": "regression",
                "screen": b.get("screen"),
                "problem": (
                    f'Screen "{b.get("screen")}" ({b.get("route")}) changed in ways the ticket does not ask for: '
                    f"{diffs}. Before: {before}; after: {j.get('after')}"
                ),
            })

    for a in qc.get("a11y") or []:
        sc = next((x for x in (design.get("screens") or []) if x.get("screen") == a.get("screen")), None)
        if not sc:
            continue
        bad = [v for v in (a.get("violations") or []) if v.get("impact") in ("serious", "critical")]
        if bad:
            desc = "; ".join(
                f"{v.get('id')} ({v.get('impact')}, {v.get('nodes')} element(s))"
                f"{': ' + v['help'] if v.get('help') else ''}"
                for v in bad
            )
            for cid in sc.get("criteria") or []:
                failures.append({
                    "kind": "qc",
                    "id": cid,
                    "problem": f'Screen "{sc.get("screen")}" has {len(bad)} serious accessibility problem(s): {desc}.',
                })

    compared = {sc["screen"]: sc for sc in (qc.get("screens") or []) if "screen" in sc}
    for sc in design.get("screens") or []:
        j = compared.get(sc.get("screen"))
        first = (sc.get("criteria") or [None])[0]
        if not j:
            failures.append({
                "kind": "qc",
                "id": first,
                "problem": f'Screen "{sc.get("screen")}" was not compared with its mockup {sc.get("mockup")}.',
            })
        elif j.get("status") != "match":
            diffs = "; ".join(j.get("differences") or []) or "no difference named"
            for cid in sc.get("criteria") or []:
                failures.append({
                    "kind": "qc",
                    "id": cid,
                    "problem": (
                        f'Screen "{sc.get("screen")}" does not match its mockup {sc.get("mockup")}: '
                        f"{diffs}. Screenshot: {j.get('screenshot')}"
                    ),
                })
    return failures


def evaluate(
    contract: Dict[str, Any],
    check: Dict[str, Any],
    review: Dict[str, Any],
    spec_reviews: Optional[List[Dict[str, Any]]] = None,
    qc: Optional[Dict[str, Any]] = None,
    repo: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Decide pass or fail from raw facts; empty list means passing."""
    failures = check_failures(contract, check, repo)

    judged = {c["id"]: c for c in (review.get("criteria") or []) if "id" in c}
    for c in contract.get("criteria") or []:
        j = judged.get(c["id"])
        if not j:
            failures.append({
                "kind": "criterion",
                "id": c["id"],
                "problem": f"Criterion {c['id']} was not judged by the reviewer.",
            })
        elif j.get("status") != "met":
            failures.append({
                "kind": "criterion",
                "id": c["id"],
                "problem": f"Criterion {c['id']} is {j.get('status')}: {j.get('evidence')}",
            })

    for f in review.get("findings") or []:
        if f.get("severity") == "blocking":
            failures.append({
                "kind": "finding",
                "file": norm_path(f.get("file")),
                "line": f.get("line"),
                "problem": f.get("problem"),
            })

    broken_at: Set[str] = set()

    def add_standard(f: Dict[str, Any]) -> None:
        key = f"{f.get('id')}|{f.get('file')}|{f.get('line')}"
        if key not in broken_at:
            broken_at.add(key)
            failures.append(f)

    for sf in standards_failures(contract.get("standards"), review, None):
        add_standard(sf)

    for item in spec_reviews or []:
        spec = item["spec"]
        spec_review = item["review"]
        spec_judged = {c["id"]: c for c in (spec_review.get("criteria") or []) if "id" in c}
        for cid in spec.get("criteria") or []:
            j = spec_judged.get(cid)
            if not j:
                failures.append({
                    "kind": "criterion",
                    "id": cid,
                    "spec": spec["id"],
                    "problem": f"Criterion {cid} was not judged by the reviewer of {spec['id']}.",
                })
            elif j.get("status") != "met":
                failures.append({
                    "kind": "criterion",
                    "id": cid,
                    "spec": spec["id"],
                    "problem": f"Criterion {cid} is {j.get('status')} in {spec['id']}: {j.get('evidence')}",
                })
        for f in spec_review.get("findings") or []:
            if f.get("severity") == "blocking":
                failures.append({
                    "kind": "finding",
                    "file": norm_path(f.get("file")),
                    "line": f.get("line"),
                    "spec": spec["id"],
                    "problem": f.get("problem"),
                })
        for sf in standards_failures(contract.get("standards"), spec_review, spec):
            add_standard(sf)

    if qc:
        failures.extend(qc_failures(contract, qc))
    return failures


def open_questions(plan: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not plan or not isinstance(plan.get("questions"), list):
        return []
    out: List[Dict[str, Any]] = []
    for raw in plan["questions"]:
        q = {"question": raw, "why": "", "criteria": []} if isinstance(raw, str) else raw
        if not q or is_blank(q.get("question")):
            continue
        out.append({
            "question": str(q["question"]).strip(),
            "why": "" if is_blank(q.get("why")) else str(q["why"]).strip(),
            "criteria": list(q["criteria"]) if isinstance(q.get("criteria"), list) else [],
        })
    return out


def questions_text(questions: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for i, q in enumerate(questions):
        crit = f" ({', '.join(q['criteria'])})" if q.get("criteria") else ""
        why = f" - {q['why']}" if q.get("why") else ""
        parts.append(f"Q{i + 1}: {q['question']}{crit}{why}")
    return " ".join(parts)


def route_failures(
    failures: List[Dict[str, Any]],
    specs: List[Dict[str, Any]],
    repo: Optional[str] = None,
) -> List[Dict[str, Any]]:
    by_spec: Dict[str, List[Dict[str, Any]]] = {s["id"]: [] for s in specs}
    owner: Dict[str, str] = {}
    for s in specs:
        for f in spec_files(s):
            owner[f] = s["id"]

    for f in failures:
        ids: List[str] = []
        kind = f.get("kind")
        if kind in ("finding", "standard") and norm_path(f.get("file")) in owner:
            ids = [owner[norm_path(f.get("file"))]]
        elif f.get("spec") and f["spec"] in by_spec:
            ids = [f["spec"]]
        elif kind in ("criterion", "qc"):
            ids = [s["id"] for s in specs if f.get("id") in (s.get("criteria") or [])]
        elif kind == "regression":
            ids = [
                s["id"]
                for s in specs
                if any(matches_glob(file, p) for file in (s.get("filesOwned") or []) for p in UI_FILES)
            ]
        elif kind == "check":
            culprit_owners = {
                owner[repo_path(c, repo)]
                for c in (f.get("culprits") or [])
                if repo_path(c, repo) in owner
            }
            if culprit_owners:
                ids = [s["id"] for s in specs if s["id"] in culprit_owners]
            else:
                out_tail = str(f.get("outputTail") or "")
                ids = [s["id"] for s in specs if any(file in out_tail for file in spec_files(s))]
        if not ids:
            ids = [s["id"] for s in specs]
        for sid in ids:
            by_spec[sid].append(f)

    return [{"spec": s, "failures": by_spec[s["id"]]} for s in specs if by_spec[s["id"]]]


PROBLEM_CHARS = 300


def failure_entries(groups: Optional[List[Dict[str, Any]]], at: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries: Dict[int, Dict[str, Any]] = {}
    order: List[int] = []
    for g in groups or []:
        spec_id = g["spec"]["id"]
        for f in g.get("failures") or []:
            fid = id(f)
            if fid not in entries:
                problem = str(f.get("problem") or "").strip()
                e: Dict[str, Any] = {
                    "stage": at["stage"],
                    "round": at["round"],
                    "kind": f.get("kind"),
                    "specs": [],
                }
                if not is_blank(f.get("file")):
                    e["file"] = norm_path(f["file"])
                line = f.get("line")
                if line is not None and line != "":
                    e["line"] = line
                if f.get("kind") in ("criterion", "qc"):
                    e["criterion"] = f.get("id")
                if f.get("kind") == "check":
                    e["check"] = f.get("name")
                if f.get("kind") == "standard":
                    e["rule"] = f.get("id")
                e["problem"] = f"{problem[: PROBLEM_CHARS - 1]}…" if len(problem) > PROBLEM_CHARS else problem
                e["sentBack"] = bool(at.get("sentBack"))
                entries[fid] = e
                order.append(fid)
            if spec_id not in entries[fid]["specs"]:
                entries[fid]["specs"].append(spec_id)
    return [entries[k] for k in order]


def review_line(review: Dict[str, Any]) -> Dict[str, str]:
    criteria = review.get("criteria") or []
    met = sum(1 for c in criteria if c.get("status") == "met")
    blocking = sum(1 for f in (review.get("findings") or []) if f.get("severity") == "blocking")
    suffix = f", {blocking} blocking finding(s)" if blocking > 0 else ""
    return {
        "text": f"{met}/{len(criteria)} criteria met{suffix}",
        "state": "ok" if met == len(criteria) and blocking == 0 else "fail",
    }


def qa_line(report: Optional[Dict[str, Any]]) -> str:
    if not report:
        return ""
    gaps = report.get("gaps") or []
    written = sum(1 for g in gaps if g.get("written"))
    failing = len(report.get("failures") or [])
    suffix = f", {failing} sent back" if failing > 0 else ""
    return f"QA: {len(gaps)} gap(s), {written} test(s) added{suffix}"


def qc_line(qc: Dict[str, Any]) -> Dict[str, str]:
    if qc.get("status") == "blocked":
        reason = str(qc.get("blockedReason") or "could not run the product").strip()
        return {
            "text": f"Blocked: {reason[:160]}",
            "state": "fail",
        }
    criteria = qc.get("criteria") or []
    count = lambda st: sum(1 for c in criteria if c.get("status") == st)
    passing = count("pass")
    not_obs = count("not_observable")
    failing = len(criteria) - passing - not_obs
    obs_text = f", {not_obs} not observable" if not_obs > 0 else ""
    fail_text = f", {failing} fail" if failing > 0 else ""
    return {
        "text": f"{passing}/{len(criteria)} criteria pass when used{obs_text}{fail_text}",
        "state": "ok" if failing == 0 and len(criteria) > 0 else "fail",
    }


def run_record(
    run: Dict[str, Any],
    contract: Dict[str, Any],
    state: Dict[str, Any],
    progress: Dict[str, Any],
) -> Dict[str, Any]:
    specs = state.get("specs") or []
    failed = {
        f["id"]
        for f in (state.get("failures") or [])
        if f.get("kind") in ("criterion", "qc") and "id" in f
    }
    qc_list = state.get("qc") or []
    qc = qc_list[-1] if qc_list else None
    results = (state.get("check") or {}).get("results") or []

    spec_rows: List[Dict[str, Any]] = []
    for s in specs:
        build = (progress.get("build") or {}).get(s["id"]) or {}
        built = next((b for b in (state.get("builds") or []) if b.get("spec") == s["id"]), None)
        qa_matches = [q for q in (state.get("qa") or []) if q.get("spec") == s["id"]]
        qa = qa_matches[-1] if qa_matches else None
        tdd = sum(1 for t in ((built or {}).get("tdd") or []) if len(t.get("tests") or []) > 0)
        spec_rows.append({
            "id": s["id"],
            "title": s.get("title"),
            "kind": s.get("kind"),
            "goal": s.get("goal"),
            "criteria": list(s.get("criteria") or []),
            "filesOwned": list(s.get("filesOwned") or []),
            "testFiles": list(s.get("testFiles") or []),
            "impl": build.get("impl") or "wait",
            "test": build.get("test") or "wait",
            "waitFor": ", ".join(s.get("dependsOn") or []),
            "implNote": f"Test-first: {tdd}/{len(s.get('criteria') or [])} criteria" if built and has_tests(s) else "",
            "testNote": qa_line(qa),
        })

    if state.get("check"):
        check_obj = {
            "text": " · ".join(f"{r.get('name')}: exit {r.get('exitCode')}" for r in results) or "no checks to run",
            "state": "ok" if all(r.get("exitCode") == 0 or r.get("rerunExitCode") == 0 for r in results) else "fail",
        }
    else:
        check_obj = {"text": " · ".join(c["command"] for c in (contract.get("checks") or []))}

    review_rows: List[Dict[str, Any]] = []
    if state.get("review"):
        review_rows.append({"tag": "whole change", **review_line(state["review"])})
        for r in state.get("specReviews") or []:
            review_rows.append({"tag": r["spec"], **review_line(r)})
        if qc:
            review_rows.append({"tag": "qc", **qc_line(qc)})

    risk_obj = state.get("risk")
    record_out: Dict[str, Any] = {
        "id": run["id"],
        "title": run["title"],
        "outcome": progress["outcome"],
        "workflowOutcome": progress["outcome"],
        "reason": state.get("reason", ""),
        "phase": progress["phase"],
        "agents": run["agents"],
        "repairRounds": state.get("repairRounds", 0),
        "maxRepairRounds": run["maxRepairRounds"],
        "specLine": f"{len(specs)} spec(s) · {progress['levels']} level(s)" if specs and progress.get("levels") else "",
        "specs": spec_rows,
        "check": check_obj,
        "review": review_rows,
        "repairs": progress.get("repairs") or [],
        "criteria": [
            {
                "id": c["id"],
                "text": c["text"],
                "status": ("not_met" if c["id"] in failed else "met") if state.get("review") else "",
            }
            for c in (contract.get("criteria") or [])
        ],
        "failureLog": state.get("failureLog") or [],
        "risk": (
            {"level": risk_obj["risk"], "surfaces": risk_obj["surfaces"], "raisedBy": risk_obj["raisedBy"]}
            if risk_obj
            else None
        ),
        "merge": state.get("merge") or None,
        "questions": [{"question": q["question"], "criteria": q["criteria"]} for q in (state.get("questions") or [])],
        "flaky": [f["name"] for f in (state.get("flaky") or [])],
        "tddUnproven": state.get("tddUnproven") or [],
    }
    if not is_blank(run.get("repo")):
        record_out["repo"] = str(run["repo"]).rstrip("/")
    if not is_blank(run.get("issueKey")):
        record_out["issueKey"] = str(run["issueKey"]).strip()
    if isinstance(run.get("issueNumber"), int) and not isinstance(run.get("issueNumber"), bool):
        record_out["issueNumber"] = run["issueNumber"]
    return record_out


# ---------------------------------------------------------------------------
# Text rendering for prompts
# ---------------------------------------------------------------------------


def bullets(items: Optional[List[Any]]) -> str:
    return "\n".join(f"- {i}" for i in (items or [])) or "- none"


def design_problems(contract: Optional[Dict[str, Any]]) -> List[str]:
    d = (contract or {}).get("design")
    if not d:
        return []
    problems: List[str] = []
    ids = {c["id"] for c in (contract or {}).get("criteria") or []}
    for i, sc in enumerate(d.get("screens") or []):
        name = f"screen {i + 1}" if is_blank(sc.get("screen")) else f'screen "{sc["screen"]}"'
        if is_blank(sc.get("mockup")):
            problems.append(f"design: {name} has no mockup.")
        elif re.match(r"^https?:", str(sc["mockup"]), re.IGNORECASE):
            problems.append(
                f"design: {name}'s mockup is a link ({sc['mockup']}); "
                "commit the image to the repository so agents can open it."
            )
        crits = sc.get("criteria")
        if not isinstance(crits, list) or len(crits) == 0:
            problems.append(f"design: {name} names no criterion.")
        for c in crits or []:
            if c not in ids:
                problems.append(f"design: {name} names {c}, which is not in the contract.")
    if len(d.get("screens") or []) > 0 and is_blank(d.get("doc")):
        problems.append("design: screens are given but no design doc (DESIGN.md).")
    for i, b in enumerate(d.get("baseline") or []):
        name = f"baseline screen {i + 1}" if is_blank(b.get("screen")) else f'baseline screen "{b["screen"]}"'
        if is_blank(b.get("route")):
            problems.append(f"design: {name} has no route.")
        before = b.get("before")
        if not isinstance(before, list) or len(before) == 0:
            problems.append(f"design: {name} has no before screenshot; take it on the base commit before the run.")
    return problems


def design_text(design: Optional[Dict[str, Any]], ids: Optional[List[str]] = None) -> str:
    if not design:
        return ""
    screens = [
        sc
        for sc in (design.get("screens") or [])
        if ids is None or any(c in ids for c in (sc.get("criteria") or []))
    ]
    lines: List[str] = []
    if not is_blank(design.get("doc")):
        tok = (
            ""
            if is_blank(design.get("tokens"))
            else f"; tokens: {design['tokens']} (use them; no colour, size or spacing written out by hand)"
        )
        lines.append(f"- Design rules: {design['doc']}{tok}")
    if not is_blank(design.get("uiStore")):
        lines.append(
            f"- Component catalogue: {design['uiStore']}/catalog.md (build from these components and copy "
            "its pattern files; where it lists duplicates, use the preferred one; a new component only when none fits)"
        )
        lines.append(
            f"- Today's screens, if they were captured: {design['uiStore']}/screens/ (index.json lists them by route); "
            "a screen the ticket changes in words starts from how it looks there"
        )
    if len(design.get("reuse") or []) > 0:
        lines.append(f"- Reuse: {', '.join(design['reuse'])}")
    for sc in screens:
        states = f"; states: {', '.join(sc['states'])}" if len(sc.get("states") or []) else ""
        lines.append(
            f'- Screen "{sc["screen"]}" for {", ".join(sc["criteria"])}: mockup {sc["mockup"]}{states}'
        )
    return "\n".join(lines)


# --- Coding standards -------------------------------------------------------
STANDARD_ENFORCED = ["tool", "review"]
STANDARD_SEVERITIES = ["blocking", "minor"]


def standards_problems(contract: Optional[Dict[str, Any]]) -> List[str]:
    st = (contract or {}).get("standards")
    if not st:
        return []
    problems: List[str] = []
    rules = st.get("rules")
    if not isinstance(rules, list) or len(rules) == 0:
        return ['standards: no rules; leave "standards" out, or give its rules.']
    checks = {c["name"] for c in ((contract or {}).get("checks") or [])}
    seen: Set[str] = set()
    for i, r in enumerate(rules):
        name = f"rule {i + 1}" if is_blank((r or {}).get("id")) else r["id"]
        if not r or not re.fullmatch(r"S\d+", str(r.get("id") or "")):
            problems.append(f"standards: {name} needs an id S1, S2, ...")
        elif r["id"] in seen:
            problems.append(f"standards: {r['id']} is given twice.")
        else:
            seen.add(r["id"])
        if not r or is_blank(r.get("text")):
            problems.append(f"standards: {name} has no text.")
        if not r or r.get("severity") not in STANDARD_SEVERITIES:
            problems.append(f"standards: {name} must be blocking or minor.")
        if not r or r.get("enforced") not in STANDARD_ENFORCED:
            problems.append(f"standards: {name} must be enforced by tool or review.")
        elif r.get("enforced") == "tool" and r.get("check") not in checks:
            chk_list = ", ".join(checks) if checks else "none"
            problems.append(
                f'standards: {name} is kept by a tool, but its check "{r.get("check") or ""}" '
                f"is not one of the contract's checks ({chk_list})."
            )
    return problems


def standards_text(standards: Optional[Dict[str, Any]], view: str) -> str:
    if not standards or not isinstance(standards.get("rules"), list) or len(standards["rules"]) == 0:
        return ""
    file_name = standards.get("file") or "the project's"
    def line(r: Dict[str, Any]) -> str:
        kept = f', kept by the check "{r.get("check")}"' if r.get("enforced") == "tool" else ""
        return f"- {r['id']} ({r['severity']}{kept}): {r['text']}"
    rules = standards["rules"]
    review_rules = [r for r in rules if r.get("enforced") == "review"]
    tool_rules = [r for r in rules if r.get("enforced") == "tool"]
    if view == "implementer":
        return "\n".join([
            f"Coding standards ({file_name}; follow every one in the code and tests you write):",
            *[line(r) for r in rules],
        ])
    lines = [
        f"Coding standards to judge ({file_name}): give each rule below one entry in `standards`: "
        "`pass`, `fail` with the file and line of each place it is broken, or `not_applicable` when the "
        "code you review has nothing it applies to. A blocking rule that fails goes back to Build; "
        "a minor one is reported.",
        *([line(r) for r in review_rules] if review_rules else ["- none: every rule is kept by a tool"]),
    ]
    if tool_rules:
        lines.append("Kept by the checks, not by you (their result is above):")
        lines.extend(line(r) for r in tool_rules)
    return "\n".join(lines)


def standards_failures(
    standards: Optional[Dict[str, Any]],
    review: Optional[Dict[str, Any]],
    spec: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    rules = {
        r["id"]: r
        for r in ((standards or {}).get("rules") or [])
        if r.get("enforced") == "review"
    }
    out: List[Dict[str, Any]] = []
    for j in (review or {}).get("standards") or []:
        r = rules.get(j.get("id"))
        if not r or j.get("status") != "fail" or r.get("severity") != "blocking":
            continue
        item: Dict[str, Any] = {
            "kind": "standard",
            "id": r["id"],
            "file": norm_path(j.get("file") or ""),
            "line": j.get("line"),
            "problem": f"Coding standard {r['id']} is broken: {r['text']} {j.get('evidence') or ''}".strip(),
        }
        if spec:
            item["spec"] = spec["id"]
        out.append(item)
    return out


def standards_report(
    standards: Optional[Dict[str, Any]],
    check: Optional[Dict[str, Any]],
    reviews: Optional[List[Optional[Dict[str, Any]]]],
) -> List[Dict[str, Any]]:
    if not standards or not isinstance(standards.get("rules"), list):
        return []
    out: List[Dict[str, Any]] = []
    check_results = (check or {}).get("results") or []
    valid_reviews = [v for v in (reviews or []) if v]
    for r in standards["rules"]:
        base = {
            "id": r["id"],
            "text": r["text"],
            "severity": r["severity"],
            "enforced": r["enforced"],
        }
        if r.get("enforced") == "tool":
            res = next((x for x in check_results if x.get("name") == r.get("check")), None)
            if not res:
                out.append({**base, "status": "not_judged", "evidence": f'check "{r.get("check")}" did not run'})
                continue
            ok = res.get("exitCode") == 0 or res.get("rerunExitCode") == 0
            rerun = (
                f", {res['rerunExitCode']} on its rerun"
                if res.get("rerunExitCode") is not None
                else ""
            )
            out.append({
                **base,
                "status": "pass" if ok else "fail",
                "evidence": f"{r.get('check')} exited {res.get('exitCode')}{rerun}",
            })
            continue

        judged = [j for v in valid_reviews for j in (v.get("standards") or []) if j.get("id") == r["id"]]
        fails = [j for j in judged if j.get("status") == "fail"]
        if fails:
            ev = "; ".join(
                f"{j.get('file') or '?'}{':' + str(j['line']) if j.get('line') else ''} {j.get('evidence') or ''}".strip()
                for j in fails
            )
            out.append({**base, "status": "fail", "evidence": ev})
        elif any(j.get("status") == "pass" for j in judged):
            ev = next((j.get("evidence") for j in judged if j.get("status") == "pass" and j.get("evidence")), "")
            out.append({**base, "status": "pass", "evidence": ev})
        elif judged:
            out.append({**base, "status": "not_applicable", "evidence": judged[0].get("evidence") or ""})
        else:
            out.append({**base, "status": "not_judged", "evidence": "no reviewer judged it"})
    return out


def contract_text(contract: Dict[str, Any]) -> str:
    checks = contract.get("checks") or []
    lines = [
        f"Objective: {contract['objective']}",
        "",
        "Acceptance criteria:",
        *[f"- {c['id']}: {c['text']}" for c in (contract.get("criteria") or [])],
        "",
        "Out of scope:",
        bullets(contract.get("outOfScope")),
        "",
        "Checks:",
        "\n".join(f"- {c['name']}: {c['command']}" for c in checks)
        if checks
        else "- none (the project has no runnable check)",
    ]
    d_text = design_text(contract.get("design"), None)
    if d_text:
        lines.extend(["", "Design (what the product must look like):", d_text])
    return "\n".join(lines)


def qc_text(contract: Dict[str, Any]) -> str:
    run_info = (
        "Not given. Find out from the repository's README, docs and manifest "
        "(package.json scripts, Makefile, pyproject), as a new teammate would."
        if is_blank(contract.get("run"))
        else str(contract["run"]).strip()
    )
    lines = [
        f"Objective: {contract['objective']}",
        "",
        "Acceptance criteria:",
        *[f"- {c['id']}: {c['text']}" for c in (contract.get("criteria") or [])],
        "",
        "Out of scope:",
        bullets(contract.get("outOfScope")),
        "",
        "How to run the product:",
        run_info,
    ]
    design = contract.get("design") or {}
    screens = design.get("screens") or []
    if screens:
        lines.extend([
            "",
            "Screens to compare with their approved mockups "
            "(one entry each in `screens`, and an accessibility scan of each in `a11y`):",
            *[
                f'- "{sc["screen"]}" ({", ".join(sc["criteria"])}): {sc["mockup"]}'
                f'{"; states: " + ", ".join(sc["states"]) if len(sc.get("states") or []) else ""}'
                for sc in screens
            ],
        ])
    baseline = design.get("baseline") or []
    if baseline:
        lines.extend([
            "",
            "Screens this change must not break, with how they looked before it (one entry each in `baseline`):",
            *[
                f'- "{b["screen"]}" at {b["route"]}: before {", ".join(b.get("before") or [])}'
                f'{"; the change intends: " + b["expect"] if b.get("expect") else ""}'
                for b in baseline
            ],
        ])
    return "\n".join(lines)


# --- Browser ----------------------------------------------------------------
def needs_browser(contract: Optional[Dict[str, Any]], surfaces: Optional[List[str]]) -> bool:
    d = (contract or {}).get("design") or {}
    return "ui" in (surfaces or []) or len(d.get("screens") or []) > 0 or len(d.get("baseline") or []) > 0


def browser_problem(
    browser: Optional[str],
    contract: Optional[Dict[str, Any]],
    surfaces: Optional[List[str]],
    qc_on: bool,
) -> str:
    if not is_blank(browser) and not re.fullmatch(r"[A-Za-z0-9_-]+", str(browser).strip()):
        return f'"browser" must be the name of an MCP server (letters, digits, - and _), not "{browser}".'
    if not qc_on or not needs_browser(contract, surfaces) or not is_blank(browser):
        return ""
    return (
        "The change has a screen, and QC uses screens by clicking through a browser MCP server, "
        "which this run was not given. Configure Playwright MCP in "
        ".agents/plugins/factory-browser/mcp_config.json or ~/.gemini/config/mcp_config.json "
        '(with `agy mcp add` or factory-init), restart the session so its tools load, and pass its server name as "browser".'
    )


def browser_note(browser: Optional[str]) -> str:
    if is_blank(browser):
        return ""
    server = str(browser).strip()
    if server == "http":
        return (
            "Browser mode: `http` (no Playwright MCP configured in this session — explicitly authorized for this run). "
            "Do NOT return `status: blocked` merely because browser MCP tools are absent. "
            "Start the real HTTP server as the contract's `run` says, verify every rendered HTML/CSS/JS asset, DOM markup, "
            "and API endpoint through live HTTP requests (using node fetch or curl), judge each criterion from what you "
            "actually observed over HTTP (noting any purely visual/pointer checks in `openIssues`), return `status: done`, "
            "and leave no files behind in the repository."
        )
    t = lambda name: f"`browser_{name}`"
    return "\n".join([
        (
            f'Browser: use the Playwright MCP tools provided by the configured MCP server "{server}" '
            "(injected directly into your toolset) for every criterion and screen seen in a browser."
        ),
        (
            f"- Open a page with {t('navigate')} and read it with {t('snapshot')} before every action: "
            "the snapshot is what you act on, by the element's role and name."
        ),
        (
            f"- Act one step at a time with {t('click')}, {t('type')}, {t('fill_form')}, "
            f"{t('select_option')} and {t('press_key')}, and take a new snapshot after each to see what it did. "
            f"Wait for a change with {t('wait_for')}, not a fixed sleep."
        ),
        (
            f"- Set the width with {t('resize')}, save screenshots with {t('take_screenshot')} under an absolute "
            f"path in your scratch directory (a relative name lands in the repository), and read "
            f"{t('console_messages')} once per screen: an error there goes in `openIssues`."
        ),
        (
            f"- Write no browser script: no Playwright or Puppeteer file, no `npx playwright`, no "
            f"{t('run_code_unsafe')}, except the one accessibility scan your brief describes. Close the browser with "
            f"{t('close')} before you return."
        ),
        "- If these browser MCP tools are not available in your toolset, return `blocked` and say so: do not fall back to a script.",
    ])


def issue_text(issue: Optional[Dict[str, Any]]) -> str:
    if not issue or (is_blank(issue.get("title")) and is_blank(issue.get("body"))):
        return ""

    def one(label: str, i: Dict[str, Any]) -> str:
        body = "(no description)" if is_blank(i.get("body")) else str(i["body"]).strip()
        return f"{label} #{i['number']}: {i.get('title') or ''}\n{body}"

    subs = [s for s in (issue.get("subIssues") or []) if s] if isinstance(issue.get("subIssues"), list) else []
    lines = [
        f"The contract above was written from GitHub issue #{issue['number']}. The issue and its sub-issues "
        "follow as background. The sub-issues are a developer's notes on how the work divides and where it touches "
        "the code: use them to understand the task and as a starting point for your split, not as specs or criteria. "
        "You decide the specs; one spec per sub-issue is fine when the files allow it, but merge, split or regroup "
        "them when file ownership or dependencies call for it. Only the contract's criteria are judged. Where a note "
        "disagrees with the code, the code is right; where it disagrees with the contract, the contract is right, "
        "and say so in `risks`.",
        "",
        one("Issue", issue),
    ]
    if subs:
        for s in subs:
            lines.extend(["", one("Sub-issue", s)])
    else:
        lines.extend(["", "It has no sub-issues."])
    return "\n".join(lines)


def spec_text(spec: Dict[str, Any], contract: Dict[str, Any], view: str) -> str:
    criteria = {c["id"]: c["text"] for c in (contract.get("criteria") or [])}
    part = lambda title, body: ["", f"{title}\n{body}"]
    if view == "implementer":
        files = [
            *part("Source files you own (change nothing else):", bullets(spec.get("filesOwned"))),
            *part("Test files you own (write the tests here, before the code):", bullets(spec.get("testFiles"))),
        ]
    elif view == "qa":
        files = [
            *part("Test files of this spec (the only files you may change or create):", bullets(spec.get("testFiles"))),
            *part("Source files of this spec (read them, never change them):", bullets(spec.get("filesOwned"))),
        ]
    else:
        files = [
            *part("Source files:", bullets(spec.get("filesOwned"))),
            *part("Test files:", bullets(spec.get("testFiles"))),
        ]
    crit_ids = spec.get("criteria") or []
    d_text = design_text(contract.get("design"), crit_ids)
    lines = [
        f"Spec {spec['id']}: {spec['title']}",
        *part("Goal:", spec["goal"]),
        *part("Criteria:", "\n".join(f"- {cid}: {criteria.get(cid, '')}" for cid in crit_ids)),
        *files,
    ]
    if d_text:
        lines.extend(part("Design (follow it; the mockups are the approved look):", d_text))
    if view == "implementer":
        st_text = standards_text(contract.get("standards"), "implementer")
        if st_text:
            lines.extend(["", st_text])
    lines.extend([
        *part("Context:", spec.get("context") or "none"),
        *part("Interfaces:", spec.get("interfaces") or "none"),
    ])
    if view != "qa":
        lines.extend(part("Changes:", spec.get("changes") or "none"))
    lines.extend([
        *part("Tests:", spec["tests"]),
        *part("Out of scope:", spec.get("outOfScope") or "none"),
    ])
    if view != "qa":
        lines.extend(part("Done when:", bullets(spec.get("doneWhen"))))
    return "\n".join(lines)


def scratch_dir(root: str, label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(label or "agent").lower()).strip("-")
    return f"{root}/{slug or 'agent'}"


def scratch_note(directory: str) -> str:
    return "\n".join([
        f"Scratch directory: {directory}",
        (
            "Put every temporary file you need (stubs, configs, copies, scratch repositories) in that directory, "
            "creating it if needed, and nowhere else: other agents of this run work at the same time, and a shared "
            "scratch area lets them delete or write through each other's files. Never create a link there to "
            "anything in the repository, its installed dependencies included: a write through such a link lands in "
            "the repository."
        ),
    ])


def skills_note(
    names: Optional[List[str]],
    paths: Optional[Dict[str, str]],
    fixed_point_text: str = "",
    extra: Optional[List[Dict[str, str]]] = None,
) -> str:
    maybe = extra or []
    if not names and not maybe:
        return ""
    lines: List[str] = []
    if names:
        lines.append(
            f"Skills: before you start, read each of these skill files with `read_file`, in this order: "
            f"{', '.join(names)}:"
        )
        for n in names:
            lines.append(f"- {n}: {(paths or {}).get(n) or 'not resolved'}")
    if maybe:
        lines.append("Read these too with `read_file`, each only when its rule applies:")
        for m in maybe:
            lines.append(f"- {m['name']}, {m['when']}: {(paths or {}).get(m['name']) or 'not resolved'}")
    lines.append(
        "You run unattended, inside a team. Where a skill says to ask or confirm with the user, "
        "decide from your assignment instead: the spec and its interfaces are what was agreed. "
        "Where a skill conflicts with your role brief (what you may change, what you return, "
        "whether you start other agents), the brief wins."
    )
    if fixed_point_text:
        lines.append(fixed_point_text)
    return "\n".join(lines)


def fixed_point(spec_source: str, base: str = "") -> str:
    return (
        f"For a skill that reviews a diff against a base branch or fixed point "
        f"(mp-code-review, pr-security-review): the base is the commit {base}, there is no pull request "
        f"and nothing to fetch, and the change is not committed, so read it with `git diff {base}` and the "
        f"untracked files in `git status --short`, not with `git diff <base>...HEAD` or `origin/<base>`. "
        f"Its spec is {spec_source}; there is no issue tracker. Its findings become your findings, judged "
        f"and reported in your own return format."
    )


def project_note(
    role: str,
    docs: Optional[Any],
    stack: Optional[Any] = None,
) -> List[str]:
    if role == "qc":
        return []
    st: List[str] = []
    if isinstance(stack, str):
        raw_stack = stack.strip()
        if raw_stack.startswith("{"):
            try:
                parsed_stack = json.loads(raw_stack)
                if isinstance(parsed_stack, dict):
                    stack = parsed_stack
            except Exception:
                pass
    if isinstance(stack, dict) and len(stack.get("languages") or []) > 0:
        tech = ", ".join([*(stack.get("languages") or []), *(stack.get("frameworks") or [])])
        pm = f" ({stack['packageManager']})" if stack.get("packageManager") else ""
        adr = f"; why it was chosen: {stack['adr']}" if stack.get("adr") else ""
        st.append(
            f"Stack: {tech}{pm}{adr}. Follow its conventions and the project's own patterns; "
            "add no other framework or library for something these already do."
        )
    elif isinstance(stack, str) and not is_blank(stack):
        st.append(
            f"Stack: {stack.strip()}. Follow its conventions and the project's own patterns; "
            "add no other framework or library for something these already do."
        )
    if not isinstance(docs, dict) or is_blank(docs.get("agents")):
        return ["", *st] if st else []
    extras = [
        ("product", "what the product is and for whom"),
        ("decisions", "decisions people already made; follow them"),
        ("glossary", "the words the product uses"),
    ]
    more = [
        f"- {docs[k]}: {why}"
        for k, why in extras
        if (not is_blank(docs.get(k)) if role in ("planner", "reviewer") else k == "decisions" and not is_blank(docs.get(k)))
    ]
    return [
        "",
        (
            f"Project instructions: read {docs['agents']} before anything else and follow it; "
            "where it conflicts with your role brief on what you may change or return, the brief wins."
        ),
        *st,
        *more,
    ]


def header(
    role: str,
    roles: Dict[str, str],
    repo: str,
    base: str,
    project_docs: Optional[Dict[str, Any]] = None,
    project_stack: Optional[Dict[str, Any]] = None,
) -> str:
    return "\n".join([
        f"Read your role brief first: {roles[role]}",
        "",
        f"Repository: {repo}",
        f"Base commit: {base}",
        "Work only inside that repository.",
        *project_note(role, project_docs, project_stack),
    ])


def parts_text(specs: List[Dict[str, Any]]) -> str:
    return "\n\n".join(
        "\n".join([
            f"{s['id']}: {s['title']}",
            "Source files:",
            bullets(s.get("filesOwned")),
            "Test files:",
            bullets(s.get("testFiles")),
            f"Interfaces: {s.get('interfaces') or 'none'}",
        ])
        for s in specs
    )


MAX_ISOLATION_RUNS = 12


def isolation_text(specs: Optional[List[Dict[str, Any]]]) -> str:
    with_tests = [s for s in (specs or []) if has_tests(s)]
    if not with_tests:
        return ""
    return "\n".join([
        (
            f"If a test command fails, look for a test file that breaks the others, as your brief says, "
            f"in at most {MAX_ISOLATION_RUNS} extra runs per command. The suspects are the test files of this run, per spec:"
        ),
        *[f"- {s['id']}: {', '.join(norm_path(f) for f in s['testFiles'])}" for s in with_tests],
    ])


# ---------------------------------------------------------------------------
# Schemas: what each agent must hand back
# ---------------------------------------------------------------------------

STRINGS = {"type": "array", "items": {"type": "string"}}

COMMANDS = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {"command": {"type": "string"}, "result": {"type": "string"}},
        "required": ["command", "result"],
    },
}

SPEC_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "S1, S2, ..."},
        "title": {"type": "string"},
        "goal": {"type": "string"},
        "kind": {
            "type": "string",
            "enum": ["feature", "bug", "ux", "refactor", "tech-debt", "tests", "docs"],
            "description": "What kind of work this spec is; it decides the skills its implementer loads",
        },
        "skills": {
            **STRINGS,
            "description": "Installed skills that replace those of the kind for this spec; empty to use the kind's",
        },
        "criteria": {**STRINGS, "description": "Criterion ids this spec is responsible for"},
        "dependsOn": {**STRINGS, "description": "Ids of specs that must be finished first; empty if none"},
        "filesOwned": {
            **STRINGS,
            "description": "Repository-relative paths of every source file the implementer may change or create; empty for a spec that only adds tests",
        },
        "testFiles": {
            **STRINGS,
            "description": "Repository-relative paths of every test file the implementer writes first and the QA agent may add to; empty if this spec needs no test",
        },
        "context": {"type": "string"},
        "interfaces": {"type": "string"},
        "changes": {"type": "string"},
        "tests": {"type": "string"},
        "outOfScope": {"type": "string"},
        "doneWhen": STRINGS,
    },
    "required": [
        "id",
        "title",
        "goal",
        "kind",
        "skills",
        "criteria",
        "dependsOn",
        "filesOwned",
        "testFiles",
        "context",
        "interfaces",
        "changes",
        "tests",
        "outOfScope",
        "doneWhen",
    ],
}

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "overview": {"type": "string"},
        "specs": {"type": "array", "items": SPEC_SCHEMA},
        "risks": STRINGS,
        "risk": {"type": "string", "enum": ["low", "medium", "high"]},
        "surfaces": {"type": "array", "items": {"type": "string", "enum": ["ui", "security", "data"]}},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "why": {"type": "string"}, "criteria": STRINGS},
                "required": ["question", "why", "criteria"],
            },
        },
    },
    "required": ["overview", "specs", "risks", "risk", "surfaces", "questions"],
}

BUILD_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "blocked"]},
        "blockedReason": {"type": "string", "description": "Why the spec could not be carried out; empty when done"},
        "filesChanged": STRINGS,
        "tdd": {
            "type": "array",
            "description": "One entry per criterion of the spec",
            "items": {
                "type": "object",
                "properties": {
                    "criterion": {"type": "string"},
                    "tests": {**STRINGS, "description": "Names of the tests written for this criterion before its code"},
                    "red": {
                        "type": "string",
                        "description": "The failure each test showed before the code existed, or why the criterion has no test",
                    },
                },
                "required": ["criterion", "tests", "red"],
            },
        },
        "doneWhen": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"item": {"type": "string"}, "done": {"type": "boolean"}},
                "required": ["item", "done"],
            },
        },
        "checksRun": COMMANDS,
        "openIssues": STRINGS,
    },
    "required": ["status", "blockedReason", "filesChanged", "tdd", "doneWhen", "checksRun", "openIssues"],
}

REBUILD_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "blocked"]},
        "blockedReason": {"type": "string", "description": "Why the failures could not be acted on; empty when done"},
        "filesChanged": STRINGS,
        "fixes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "failure": {"type": "string", "description": "The failure from the report, in a few words"},
                    "action": {
                        "type": "string",
                        "description": "What was changed, or why nothing was; for a changed test, why the test was wrong against the spec",
                    },
                },
                "required": ["failure", "action"],
            },
        },
        "checksRun": COMMANDS,
        "openIssues": STRINGS,
    },
    "required": ["status", "blockedReason", "filesChanged", "fixes", "checksRun", "openIssues"],
}

QA_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "blocked"]},
        "blockedReason": {"type": "string", "description": "Why the tests could not be checked; empty when done"},
        "filesChanged": {**STRINGS, "description": "Every test file changed or created; empty if none"},
        "ledger": {
            "type": "array",
            "description": "One entry per criterion of the spec",
            "items": {
                "type": "object",
                "properties": {
                    "criterion": {"type": "string"},
                    "tests": {
                        **STRINGS,
                        "description": "file:line of each test that asserts this criterion and can fail; empty if none",
                    },
                },
                "required": ["criterion", "tests"],
            },
        },
        "gaps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                    "problem": {"type": "string", "description": "The untested case or faulty test, with the exact witness value"},
                    "written": {
                        "type": "boolean",
                        "description": "True when this session closed it in the spec's test files: a test added, or a missing restore added",
                    },
                },
                "required": ["severity", "problem", "written"],
            },
        },
        "failures": {
            "type": "array",
            "description": (
                "What the code or its tests must answer for: a new test that fails against the code, "
                "a high gap that cannot be tested without changing the code, or a test that contradicts the spec"
            ),
            "items": {
                "type": "object",
                "properties": {"file": {"type": "string"}, "line": {"type": "integer"}, "problem": {"type": "string"}},
                "required": ["file", "line", "problem"],
            },
        },
        "checksRun": COMMANDS,
        "openIssues": STRINGS,
    },
    "required": ["status", "blockedReason", "filesChanged", "ledger", "gaps", "failures", "checksRun", "openIssues"],
}

CHECK_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "command": {"type": "string"},
                    "exitCode": {"type": "integer"},
                    "outputTail": {"type": "string", "description": "Last lines of the command output, copied verbatim"},
                    "culprits": {
                        **STRINGS,
                        "description": (
                            "Only for a failing test command whose failing tests pass alone: the repository-relative "
                            "test file(s) that make them fail when run before them, each confirmed by a run"
                        ),
                    },
                    "culpritEvidence": {
                        "type": "string",
                        "description": "The isolation runs you made and their results, including when no culprit was found",
                    },
                    "rerunExitCode": {
                        "type": "integer",
                        "description": "Only when the command failed: the exit code of running it once more, exactly as written",
                    },
                },
                "required": ["name", "command", "exitCode", "outputTail"],
            },
        },
        "changedFiles": {**STRINGS, "description": "Repository-relative paths changed or created since the base commit"},
        "baseRuns": {
            "type": "array",
            "description": "Only when asked: each listed spec's test files run against the base code",
            "items": {
                "type": "object",
                "properties": {
                    "spec": {"type": "string"},
                    "files": STRINGS,
                    "command": {"type": "string"},
                    "exitCode": {"type": "integer"},
                    "outputTail": {"type": "string"},
                },
                "required": ["spec", "files", "command", "exitCode", "outputTail"],
            },
        },
        "migration": {
            "type": "object",
            "description": "Only when asked and a changed file is a migration: up, down and up again",
            "properties": {
                "ran": {"type": "boolean"},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "command": {"type": "string"},
                            "exitCode": {"type": "integer"},
                            "outputTail": {"type": "string"},
                        },
                        "required": ["command", "exitCode", "outputTail"],
                    },
                },
            },
            "required": ["ran", "steps"],
        },
    },
    "required": ["results", "changedFiles"],
}

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "criteria": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "status": {"type": "string", "enum": ["met", "not_met", "unknown"]},
                    "evidence": {"type": "string"},
                },
                "required": ["id", "status", "evidence"],
            },
        },
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["blocking", "minor"]},
                    "file": {"type": "string"},
                    "line": {"type": "integer"},
                    "problem": {"type": "string"},
                },
                "required": ["severity", "file", "line", "problem"],
            },
        },
        "standards": {
            "type": "array",
            "description": "One entry per coding standard you were given to judge; empty when you were given none",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "The rule, S1..Sn"},
                    "status": {"type": "string", "enum": ["pass", "fail", "not_applicable"]},
                    "file": {"type": "string", "description": "For a fail: the file that breaks it; otherwise empty"},
                    "line": {"type": "integer", "description": "For a fail: the line; otherwise 0"},
                    "evidence": {
                        "type": "string",
                        "description": "For a fail: what breaks the rule and what it requires instead, written to stand alone; for a pass: where you looked",
                    },
                },
                "required": ["id", "status", "file", "line", "evidence"],
            },
        },
        "notReviewed": STRINGS,
    },
    "required": ["criteria", "findings", "standards", "notReviewed"],
}

QC_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "blocked"]},
        "blockedReason": {
            "type": "string",
            "description": "Why the product could not be run for a reason the change did not cause, and what is needed; empty when done",
        },
        "startedWith": {"type": "string", "description": "How the product was built and started, as commands"},
        "criteria": {
            "type": "array",
            "description": "Every criterion of the contract exactly once",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "status": {"type": "string", "enum": ["pass", "fail", "not_observable"]},
                    "scenario": {
                        "type": "string",
                        "description": "What was done, through which entry point, with the exact inputs; for not_observable, why no use of the product can show it",
                    },
                    "expected": {"type": "string", "description": "What the criterion says should be seen, written before running it"},
                    "observed": {"type": "string", "description": "What was seen, quoted from the output, response or page"},
                    "steps": {
                        **STRINGS,
                        "description": (
                            "Every action taken on the product for this criterion, in order: in a browser, the tool and "
                            'its target by role and name (navigate /login; type "a@b.co" into textbox "Email"; click button '
                            '"Sign in"; snapshot: heading "Dashboard" shown); on a CLI or HTTP, the command. Empty only for not_observable'
                        ),
                    },
                },
                "required": ["id", "status", "scenario", "expected", "observed", "steps"],
            },
        },
        "screens": {
            "type": "array",
            "description": "One entry per screen the contract gives a mockup for; empty when it gives none",
            "items": {
                "type": "object",
                "properties": {
                    "screen": {"type": "string"},
                    "screenshot": {"type": "string", "description": "Path of the screenshot taken, in the scratch directory"},
                    "status": {"type": "string", "enum": ["match", "differs"]},
                    "differences": STRINGS,
                },
                "required": ["screen", "screenshot", "status", "differences"],
            },
        },
        "baseline": {
            "type": "array",
            "description": "One entry per screen the change must not break; empty when none are listed",
            "items": {
                "type": "object",
                "properties": {
                    "screen": {"type": "string"},
                    "after": {"type": "string", "description": "Path of the screenshot taken now"},
                    "status": {"type": "string", "enum": ["same", "intended", "regressed"]},
                    "differences": STRINGS,
                },
                "required": ["screen", "after", "status", "differences"],
            },
        },
        "a11y": {
            "type": "array",
            "description": "Accessibility scan of each screen with a mockup; empty when no scanner could run",
            "items": {
                "type": "object",
                "properties": {
                    "screen": {"type": "string"},
                    "tool": {"type": "string"},
                    "violations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "impact": {"type": "string", "enum": ["minor", "moderate", "serious", "critical"]},
                                "nodes": {"type": "integer"},
                                "help": {"type": "string"},
                            },
                            "required": ["id", "impact", "nodes", "help"],
                        },
                    },
                },
                "required": ["screen", "tool", "violations"],
            },
        },
        "filesChanged": {**STRINGS, "description": "Repository files changed or created and not removed again; must be empty"},
        "commandsRun": COMMANDS,
        "openIssues": STRINGS,
    },
    "required": [
        "status",
        "blockedReason",
        "startedWith",
        "criteria",
        "screens",
        "baseline",
        "a11y",
        "filesChanged",
        "commandsRun",
        "openIssues",
    ],
}


def write_progress(file_path: str, record_data: Dict[str, Any], log_fn: Optional[Callable[..., Any]] = None) -> None:
    """Write `window.FACTORY_LIVE = <json>` directly and atomically without spawning an agent."""
    try:
        parent = os.path.dirname(os.path.abspath(file_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        content = f"window.FACTORY_LIVE = {json.dumps(record_data)}\n"
        fd, tmp_path = tempfile.mkstemp(prefix=".live-", suffix=".tmp", dir=parent or ".")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
            os.replace(tmp_path, file_path)
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise
    except Exception as exc:
        if log_fn:
            log_fn(f"Could not write dashboard progress {file_path}: {exc}")


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

JOBS = {
    "implementer": {"list": "builds", "who": "implementer"},
    "qa": {"list": "qa", "who": "QA"},
    "rebuild": {"list": "rebuilds", "who": "implementer"},
}


async def run_factory(
    input_args: Any,
    agent_fn: Callable[..., Any],
    parallel_fn: Optional[Callable[..., Any]] = None,
    phase_fn: Optional[Callable[[str], Any]] = None,
    log_fn: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    if isinstance(input_args, str):
        try:
            input_args = json.loads(input_args)
        except Exception:
            input_args = {}
    if not isinstance(input_args, dict):
        input_args = {}

    phase_cb = phase_fn or (lambda _name: None)
    log_cb = log_fn or (lambda *a: None)

    async def run_parallel(items: List[Any], fn: Callable[[Any], Any]) -> List[Any]:
        if parallel_fn:
            return await parallel_fn(items, fn)
        res = []
        for item in items:
            res.append(await fn(item))
        return res

    contract = input_args.get("contract")
    raw_max_rebuilds = input_args.get("maxRebuilds")
    max_rebuilds = raw_max_rebuilds if isinstance(raw_max_rebuilds, int) and not isinstance(raw_max_rebuilds, bool) else 4
    raw_max_spec_revs = input_args.get("maxSpecRevisions")
    max_spec_revisions = (
        raw_max_spec_revs
        if isinstance(raw_max_spec_revs, int) and not isinstance(raw_max_spec_revs, bool)
        else 2
    )
    questions_only = input_args.get("questionsOnly") is True
    qc_on = input_args.get("qc") is not False and not questions_only

    repo = str(input_args.get("repo") or "").rstrip("/")
    base = str(input_args.get("base") or "")
    roles = input_args.get("roles") or {}
    available_skills = input_args.get("skills") or {}
    project_skills = input_args.get("projectSkills")
    project_docs = input_args.get("projectDocs")
    project_stack = input_args.get("projectStack")
    scratch = (
        f"{repo}-factory-scratch"
        if is_blank(input_args.get("scratch"))
        else str(input_args.get("scratch")).rstrip("/")
    )

    state: Dict[str, Any] = {
        "outcome": "blocked",
        "reason": "",
        "overview": "",
        "risks": [],
        "questions": [],
        "risk": None,
        "merge": None,
        "flaky": [],
        "tddUnproven": [],
        "specs": [],
        "builds": [],
        "qa": [],
        "rebuilds": [],
        "sentBack": {},
        "testsChangedInRebuild": [],
        "check": None,
        "review": None,
        "specReviews": [],
        "qc": [],
        "standards": [],
        "failures": [],
        "failureLog": [],
        "repairRounds": 0,
    }

    dash = input_args.get("dashboard")
    if not (isinstance(dash, dict) and not is_blank(dash.get("file"))):
        dash = None
    run_id = (
        dash["id"]
        if dash and not is_blank(dash.get("id"))
        else (str(input_args.get("runId")).strip() if not is_blank(input_args.get("runId")) else f"run-{base[:7] or 'dev'}")
    )
    progress: Dict[str, Any] = {"phase": "Spec", "outcome": "running", "levels": 0, "build": {}, "repairs": []}
    started = 0
    run_started_mono = time.monotonic()
    bad_profile = model_profile_problems(input_args.get("modelProfile"))
    bad_models = model_problems(input_args.get("models"))
    base_models: Optional[Dict[str, Any]] = (
        resolve_models_for_profile(input_args.get("modelProfile"), input_args.get("models"))
        if not bad_profile and not bad_models
        else input_args.get("models")
    )
    active_models: Optional[Dict[str, Any]] = base_models
    active_surfaces: List[str] = list(input_args.get("surfaces") or [])

    def record(phase_title: str, outcome: str) -> None:
        progress["phase"] = phase_title
        progress["outcome"] = outcome
        if not dash:
            return
        has_valid_contract = (
            isinstance(contract, dict)
            and isinstance(contract.get("criteria"), list)
            and isinstance(contract.get("checks"), list)
        )
        if not has_valid_contract:
            return
        issue_arg = input_args.get("issue")
        issue_obj = issue_arg if isinstance(issue_arg, dict) else {}
        raw_issue_num = issue_obj.get("number")
        issue_number = raw_issue_num if isinstance(raw_issue_num, int) and not isinstance(raw_issue_num, bool) else None
        raw_issue_key = (
            dash.get("issueKey")
            or issue_obj.get("issueKey")
            or issue_obj.get("key")
            or ""
        )
        run_meta: Dict[str, Any] = {
            "id": run_id,
            "title": ((contract or {}).get("objective") or "") if is_blank(dash.get("title")) else dash["title"],
            "agents": started,
            "maxRepairRounds": max_rebuilds,
        }
        if not is_blank(repo):
            run_meta["repo"] = repo
        if not is_blank(raw_issue_key):
            run_meta["issueKey"] = str(raw_issue_key).strip()
        if issue_number is not None:
            run_meta["issueNumber"] = issue_number
        snapshot = run_record(run_meta, contract, state, progress)
        snapshot["seconds"] = max(1, round(time.monotonic() - run_started_mono))
        write_progress(dash["file"], snapshot, log_cb)

    def stop(outcome: str, reason: str) -> Dict[str, Any]:
        state["outcome"] = outcome
        state["reason"] = reason
        log_cb(f"{outcome}: {reason}")
        if (
            isinstance(contract, dict)
            and isinstance(contract.get("criteria"), list)
            and isinstance(contract.get("checks"), list)
        ):
            record(progress["phase"], outcome)
        return state

    runner_tier_only = False

    async def spawn(prompt: str, label: str, schema: Dict[str, Any], model_opts: Optional[Dict[str, str]] = None) -> Any:
        nonlocal started, runner_tier_only
        started += 1
        full_prompt = f"{prompt}\n\n{scratch_note(scratch_dir(scratch, label))}"
        kwargs: Dict[str, Any] = {
            "prompt": full_prompt,
            "schema": schema,
            "role": label,
        }
        requested = model_opts.get("model") if model_opts else None
        if requested:
            chosen = workflow_model_tier(requested) if runner_tier_only else requested
            if chosen:
                kwargs["model"] = chosen
        try:
            return await agent_fn(**kwargs)
        except Exception as exc:
            fallback = workflow_model_tier(requested) if requested and not runner_tier_only else None
            if fallback and fallback != requested and is_model_rejection_error(exc):
                runner_tier_only = True
                log_cb(
                    f'Agent {label}: runner rejected model "{requested}" ({exc}); '
                    f'retrying with tier "{fallback}" for this run.'
                )
                try:
                    return await agent_fn(**{**kwargs, "model": fallback})
                except Exception as retry_exc:
                    log_cb(f"Agent {label} failed: {retry_exc}")
                    return None
            log_cb(f"Agent {label} failed: {exc}")
            return None

    def settle(job: Dict[str, Any], result: Optional[Dict[str, Any]], tag: Optional[Dict[str, Any]] = None) -> str:
        kind = JOBS[job["role"]]
        r = result or {
            "status": "blocked",
            "blockedReason": f"The {kind['who']} did not return a result.",
            "filesChanged": [],
            "openIssues": [],
        }
        state[kind["list"]].append({"spec": job["spec"]["id"], **(tag or {}), **r})
        who = f"{job['spec']['id']} {kind['who']}"
        if r.get("status") != "done":
            return f"{who}: {r.get('blockedReason') or 'no reason given'}"
        outside = files_outside_assignment(r.get("filesChanged"), job["allowed"], repo)
        if outside:
            return f"{who}: changed files it may not change ({', '.join(outside)})"
        return ""

    if bad_profile:
        return stop("blocked", f'The "modelProfile" arg is not usable: {" ".join(bad_profile)}')
    if bad_models:
        return stop("blocked", f'The "models" arg is not usable: {" ".join(bad_models)}')

    # --- Input validation ---------------------------------------------------
    missing: List[str] = []
    if is_blank(input_args.get("repo")):
        missing.append("repo")
    if is_blank(input_args.get("base")):
        missing.append("base")
    needed_roles = ["planner"] if questions_only else [
        "planner",
        "implementer",
        "qa",
        "checker",
        "reviewer",
        "specReviewer",
        *(["qc"] if qc_on else []),
    ]
    for role in needed_roles:
        if not isinstance(roles, dict) or is_blank(roles.get(role)):
            missing.append(f"roles.{role}")
    if not isinstance(contract, dict) or is_blank(contract.get("objective")):
        missing.append("contract.objective")
    if not isinstance(contract, dict) or not isinstance(contract.get("criteria"), list) or len(contract["criteria"]) == 0:
        missing.append("contract.criteria")
    if not isinstance(contract, dict) or not isinstance(contract.get("checks"), list):
        missing.append("contract.checks")
    if missing:
        return stop("blocked", f"Missing workflow args: {', '.join(missing)}")

    if questions_only and isinstance(input_args.get("specs"), list) and len(input_args["specs"]) > 0:
        return stop("blocked", '"questionsOnly" runs the planner; it cannot be given "specs".')
    bad_design = design_problems(contract)
    if bad_design:
        return stop("blocked", f"The contract's design is not usable: {' '.join(bad_design)}")
    bad_standards = standards_problems(contract)
    if bad_standards:
        return stop("blocked", f"The contract's coding standards are not usable: {' '.join(bad_standards)}")
    no_browser = browser_problem(input_args.get("browser"), contract, input_args.get("surfaces"), qc_on)
    if no_browser:
        return stop("blocked", no_browser)
    absent_stack = [] if questions_only else missing_project_skills(project_skills, available_skills)
    if absent_stack:
        return stop(
            "blocked",
            f"The project's stack skills are not installed or were not passed in \"skills\": {', '.join(absent_stack)}. "
            "Install them with scripts/stack-skills.mjs and pass the output of skills-ready.sh.",
        )
    absent_skills = [] if questions_only else missing_skills(available_skills)
    if absent_skills:
        return stop(
            "blocked",
            f"Skills the team needs are not installed or were not passed in \"skills\": {', '.join(absent_skills)}. "
            'Run scripts/skills-ready.sh, install what it reports missing, and pass its output as "skills".',
        )

    installed = list((available_skills or {}).keys())
    allow_protected = input_args.get("allowProtected")
    guarded = lambda f: len(protected_files([f], input_args.get("protectedPaths"), allow_protected)) > 0

    def hdr(role: str) -> str:
        return header(role, roles, repo, base, project_docs, project_stack)

    def plan_specs(previous: Any = None, problems: Optional[List[str]] = None):
        lines = [
            hdr("planner"),
            "",
            "Turn this contract into one or more specs.",
            "",
            contract_text(contract),
        ]
        i_text = issue_text(input_args.get("issue"))
        if i_text:
            lines.extend(["", i_text])
        p_skills = skills_for("planner", None, None, project_skills)
        lines.extend([
            "",
            f'Skills installed for this run, which a spec may name in "skills" instead of those of its kind: '
            f"{', '.join(installed) or 'none'}",
            skills_note(p_skills, available_skills, "", conditional_for("planner", available_skills, p_skills, repo)),
        ])
        if questions_only:
            lines.extend([
                "",
                "This is a readiness check, not a build: nothing will be built from these specs. "
                "What matters is `questions`: every decision the contract, the issue and the repository leave to you. "
                "Plan as you would for a build, so you meet the same gaps, then return them.",
            ])
        if problems:
            lines.extend([
                "",
                "Your previous specs were rejected by an automatic check. Fix exactly these problems and return the full corrected set:",
                bullets(problems),
                "",
                "Previous specs:",
                json.dumps(previous, indent=2),
            ])
        label = "planner (revision)" if problems else "planner"
        return spawn("\n".join(lines), label, PLAN_SCHEMA, model_for("planner", active_models))

    def build_spec(spec: Dict[str, Any]):
        task_line = (
            "Build this spec test-first. It is your whole assignment. For each criterion, write its test, "
            "run it and see it fail for the right reason, then write the code that makes it pass."
            if has_tests(spec)
            else 'Build this spec. It is your whole assignment. It has no test files; its "Tests" section says why.'
        )
        i_skills = skills_for("implementer", spec, None, project_skills)
        lines = [
            hdr("implementer"),
            "",
            task_line,
            "",
            spec_text(spec, contract, "implementer"),
            "",
            skills_note(i_skills, available_skills, "", conditional_for("implementer", available_skills, i_skills, repo)),
        ]
        return spawn("\n".join(lines), f"build {spec['id']}", BUILD_SCHEMA, model_for("implementer", active_models))

    def qa_spec(spec: Dict[str, Any], pass_num: int):
        intro = (
            f"Check this spec again. QA or review sent it back to Build {pass_num} time(s), "
            "and a new session of its implementer has acted on the failures. You are a new QA session: "
            "check the tests and the code as they are now, from the start."
            if pass_num > 0
            else "Check this spec. Its implementer wrote the tests first and then the code, and has finished."
        )
        instr = (
            "Judge the tests against what the spec requires, close the serious gaps with new tests, "
            "run the security and code review, and report what the code or its tests must answer for."
            if has_tests(spec)
            else "It has no test files, so you can add no tests: judge what is tested against the spec, "
            "run the security and code review, and report what the code must answer for."
        )
        q_skills = skills_for("qa", spec, None, project_skills)
        label = f"qa {pass_num} {spec['id']}" if pass_num > 0 else f"qa {spec['id']}"
        lines = [
            hdr("qa"),
            "",
            intro,
            instr,
            "",
            spec_text(spec, contract, "qa"),
            "",
            skills_note(q_skills, available_skills, "", conditional_for("qa", available_skills, q_skills, repo)),
            "",
            f"See this spec's part of the change with `git diff {base} -- <file>` for each file above; "
            "a new file is untracked, so read it directly.",
            "Implementers of other specs may still be working in the same repository. "
            "Run this spec's test files, not the whole suite: a failure in another spec's half-built files is not yours to report.",
        ]
        return spawn("\n".join(lines), label, QA_SCHEMA, model_for("qa", active_models))

    def rebuild_spec(
        spec: Dict[str, Any],
        failures: List[Dict[str, Any]],
        source: str,
        specs: List[Dict[str, Any]],
        n: int,
    ):
        others = [s for s in specs if s.get("id") != spec.get("id")]
        i_skills = skills_for("implementer", spec, None, project_skills)
        lines = [
            hdr("implementer"),
            "",
            f"The spec below was sent back to Build (time {n} of at most {max_rebuilds}) because {source} found failures. "
            "You are a new session of its implementer: the code and tests on disk were written by an earlier one. "
            "Act on the failures below that concern your files. QA checks the spec again when you are done.",
            "",
            "Failures:",
            "",
            json.dumps(failures, indent=2),
            "",
            "Your spec:",
            "",
            spec_text(spec, contract, "implementer"),
        ]
        if others:
            lines.extend([
                "",
                "The other parts of the change, built by other implementers, some of whom may be acting on their own "
                "failures at the same time. Read them for their interfaces; change none of their files:",
                "",
                parts_text(others),
            ])
        lines.extend([
            "",
            f"See the change so far with `git diff {base}` and `git status --short` (new files are untracked).",
            "",
            skills_note(i_skills, available_skills, "", conditional_for("implementer", available_skills, i_skills, repo)),
        ])
        return spawn("\n".join(lines), f"rebuild {n} {spec['id']}", REBUILD_SCHEMA, model_for("rebuild", active_models))

    def run_checks(specs: List[Dict[str, Any]], round_num: int, tdd: List[Dict[str, Any]]):
        isolation = isolation_text(specs)
        checks = contract.get("checks") or []
        lines = [
            hdr("checker"),
            "",
            "Run each of these commands from the repository root, exactly as written, and report what happened. "
            "Report each result with the name in quotes, copied exactly:",
            "\n".join(f'- name "{c["name"]}", command: {c["command"]}' for c in checks) if checks else "- (no commands)",
            "",
            "When a command fails, run it once more exactly as written and report that exit code too, in `rerunExitCode`: "
            "a test that fails only sometimes must not be taken for a broken change.",
            "",
        ]
        if isolation:
            lines.extend([isolation, ""])
        if not is_blank(contract.get("testFileCommand")) and tdd:
            lines.extend([
                f"Then show that the new tests fail without the change. In your scratch directory, "
                f"`git worktree add --detach <dir> {base}`, and if the repository has a `node_modules`, "
                "link it into that worktree. For each spec below, copy its test files from the repository into the "
                "worktree at the same paths, run the command with `{files}` replaced by those paths, from the worktree "
                "root, and report it in `baseRuns` with the spec id, the files, the command, the exit code and the "
                "output tail. Then `git worktree remove --force <dir>`. Change nothing in the repository itself.",
                f"Command: {contract['testFileCommand']}",
                *[f"- {s['id']}: {' '.join(s.get('testFiles') or [])}" for s in tdd],
                "",
            ])
        mig = contract.get("migration")
        if isinstance(mig, dict) and not is_blank(mig.get("up")) and not is_blank(mig.get("down")):
            lines.extend([
                "If any changed file is a database migration (under a migrations folder, a .sql file, schema.prisma), "
                f"run, from the repository root and against the test database only, in this order: `{mig['up']}`, "
                f"then `{mig['down']}`, then `{mig['up']}` again, and report them in `migration` (ran: true, one step each). "
                "When no changed file is a migration, report `migration` with ran: false and no steps.",
                "",
            ])
        lines.append(
            f"Then list every file changed or created since the base commit by running "
            f"`(git diff --name-only {base}; git ls-files --others --exclude-standard) | sort -u` "
            "and copying each line character-for-character verbatim into `changedFiles` "
            "(never retype, abbreviate, or merge filenames from memory)."
        )
        label = "checker" if round_num == 0 else f"checker (round {round_num})"
        return spawn("\n".join(lines), label, CHECK_SCHEMA, model_for("checker", active_models))

    def run_review(check: Dict[str, Any], specs: List[Dict[str, Any]], round_num: int):
        r_skills = skills_for("reviewer", None, active_surfaces, project_skills)
        lines = [
            hdr("reviewer"),
            "",
            "Review the whole change against this contract.",
            "",
            contract_text(contract),
            "",
            f"See the change with `git diff {base}` and `git status --short` (new files are untracked).",
            "",
            "Check results observed by an independent checker:",
            json.dumps(check.get("results"), indent=2),
        ]
        if len(specs) > 1:
            lines.extend([
                "",
                f"The work was split into {len(specs)} parts, each built by a different implementer that could not see "
                "the others' code. Each part is also being reviewed line by line by its own reviewer, so spend your "
                "attention on the places where the parts meet and on whether the change as a whole satisfies the contract. "
                "The parts and the interfaces they were told to share:",
                "",
                parts_text(specs),
            ])
        st_rev = standards_text(contract.get("standards"), "reviewer")
        if st_rev:
            lines.extend(["", st_rev])
        lines.extend([
            "",
            skills_note(
                r_skills,
                available_skills,
                fixed_point("the contract above", base),
                conditional_for("reviewer", available_skills, r_skills, repo),
            ),
        ])
        label = "reviewer" if round_num == 0 else f"reviewer (round {round_num})"
        return spawn("\n".join(lines), label, REVIEW_SCHEMA, model_for("reviewer", active_models))

    def run_spec_review(spec: Dict[str, Any], check: Dict[str, Any], round_num: int):
        sr_skills = skills_for("specReviewer", spec, active_surfaces, project_skills)
        lines = [
            hdr("specReviewer"),
            "",
            "Review this one part of a larger change. Judge only the criteria and files listed here.",
            "",
            spec_text(spec, contract, "reviewer"),
            "",
            f"See this part of the change with `git diff {base} -- <file>` for each file above; "
            "a new file is untracked, so read it directly.",
            "",
            "Check results for the whole change, observed by an independent checker:",
            json.dumps(check.get("results"), indent=2),
        ]
        st_rev = standards_text(contract.get("standards"), "reviewer")
        if st_rev:
            lines.extend(["", st_rev])
        lines.extend([
            "",
            skills_note(
                sr_skills,
                available_skills,
                fixed_point("the spec above", base),
                conditional_for("specReviewer", available_skills, sr_skills, repo),
            ),
        ])
        label = f"review {spec['id']}" if round_num == 0 else f"review {spec['id']} (round {round_num})"
        return spawn("\n".join(lines), label, REVIEW_SCHEMA, model_for("specReviewer", active_models))

    def run_qc(round_num: int):
        qc_skills = skills_for("qc", None, None, project_skills)
        lines = [
            hdr("qc"),
            "",
            "Use the product as it now stands in the repository, the way a user would, and judge each criterion by what it does.",
            "",
            qc_text(contract),
            "",
            "The contract's checks have passed on this change. Do not read the change itself (`git diff`, the files it touched): "
            "judge what the product does, not what its code says.",
            "Reviewers are reading the repository at the same time. Change nothing in it: no edits, commits, stashes or checkouts.",
        ]
        b_note = browser_note(input_args.get("browser"))
        if b_note:
            lines.extend(["", b_note])
        lines.extend([
            "",
            skills_note(qc_skills, available_skills, "", conditional_for("qc", available_skills, qc_skills, repo)),
        ])
        label = "qc" if round_num == 0 else f"qc (round {round_num})"
        return spawn("\n".join(lines), label, QC_SCHEMA, model_for("qc", active_models))

    # --- Spec ---------------------------------------------------------------
    phase_cb("Spec")
    record("Spec", "running")
    specs = input_args.get("specs")
    if isinstance(specs, list) and len(specs) > 0:
        problems = validate_specs(specs, contract, installed, guarded)
        state["specs"] = specs
        if problems:
            return stop("blocked", f"The supplied specs are not usable: {' '.join(problems)}")
        log_cb(f"Using {len(specs)} supplied spec(s); planner skipped.")
    else:
        def asked(p: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            state["questions"] = open_questions(p)
            state["overview"] = p.get("overview", "")
            state["risks"] = p.get("risks", [])
            if not state["questions"]:
                return None
            state["specs"] = p.get("specs", [])
            return stop(
                "blocked",
                f"The planner has {len(state['questions'])} open question(s) that the contract, the issue and the "
                f"repository do not answer: {questions_text(state['questions'])}",
            )

        plan = await plan_specs()
        if not plan:
            return stop("blocked", "The planner did not return a result.")
        first_ask = asked(plan)
        if first_ask:
            return first_ask
        if questions_only:
            state["specs"] = plan.get("specs", [])
            return stop("ready", "The planner has no open questions.")
        problems = validate_specs(plan.get("specs"), contract, installed, guarded)
        revisions = 0
        while problems and revisions < max_spec_revisions:
            revisions += 1
            log_cb(f"Specs rejected ({len(problems)} problem(s)); asking the planner to revise ({revisions}/{max_spec_revisions}).")
            revised = await plan_specs(plan.get("specs"), problems)
            if not revised:
                return stop("blocked", "The planner did not return a revised result.")
            plan = revised
            revised_ask = asked(plan)
            if revised_ask:
                return revised_ask
            problems = validate_specs(plan.get("specs"), contract, installed, guarded)
        specs = plan.get("specs", [])
        state["specs"] = specs
        state["overview"] = plan.get("overview", "")
        state["risks"] = plan.get("risks", [])
        state["rated"] = {"risk": plan.get("risk"), "surfaces": plan.get("surfaces")}
        if problems:
            return stop(
                "blocked",
                f"The specs are still not usable after {max_spec_revisions} revision(s): {' '.join(problems)}",
            )

    rated = state.get("rated") or {"risk": input_args.get("risk"), "surfaces": input_args.get("surfaces")}
    state["risk"] = assess_risk(rated.get("risk"), rated.get("surfaces"), specs)
    active_models = routed_models(state["risk"]["risk"], base_models)
    active_surfaces = state["risk"]["surfaces"]
    raised_note = f" (raised: {'; '.join(state['risk']['raisedBy'])})" if state["risk"]["raisedBy"] else ""
    log_cb(
        f"Risk {state['risk']['risk']}{raised_note}; "
        f"surfaces: {', '.join(state['risk']['surfaces']) or 'none'}."
    )
    if not qc_on and "ui" in state["risk"]["surfaces"]:
        log_cb("QC is off, but the change has a visible surface: nobody will use it before a person does.")
    no_browser_for_ui = browser_problem(input_args.get("browser"), contract, state["risk"]["surfaces"], qc_on)
    if no_browser_for_ui:
        return stop("blocked", no_browser_for_ui)

    levels = build_levels(specs)
    assert levels is not None
    progress["levels"] = len(levels)
    level_summary = " -> ".join("+".join(s["id"] for s in lvl) for lvl in levels)
    log_cb(f"{len(specs)} spec(s) in {len(levels)} build level(s): {level_summary}")
    untested = [s["id"] for s in specs if not has_tests(s)]
    if untested:
        log_cb(f"No test-first step for {', '.join(untested)}: the spec names no test files. QA still checks it.")

    # --- Build, with the loop back from QA ----------------------------------
    async def chain(
        spec: Dict[str, Any],
        failures: Optional[List[Dict[str, Any]]] = None,
        source: str = "",
    ) -> Dict[str, Any]:
        pending = failures or None
        from_source = source or ""
        while True:
            n = state["sentBack"].get(spec["id"], 0)
            progress["build"][spec["id"]] = {"impl": "run", "test": "wait"}
            if pending:
                fixed = await rebuild_spec(spec, pending, from_source, specs, n)
                problem = settle({"role": "rebuild", "spec": spec, "allowed": spec_files(spec)}, fixed, {"rebuild": n})
                changed = tests_changed(fixed.get("filesChanged") if fixed else None, spec, repo)
                if changed:
                    state["testsChangedInRebuild"].append({"rebuild": n, "spec": spec["id"], "files": changed})
                    log_cb(f"{spec['id']}, rebuild {n}: the implementer changed test file(s) {', '.join(changed)}.")
                if problem:
                    return {"stop": "failed", "reason": problem}
            else:
                built = await build_spec(spec)
                problem = settle({"role": "implementer", "spec": spec, "allowed": spec_files(spec)}, built, {})
                if problem:
                    return {"stop": "blocked", "reason": problem}

            progress["build"][spec["id"]] = {"impl": "ok", "test": "run"}
            record("Build", "running")

            checked = await qa_spec(spec, n)
            qa_problem = settle(
                {"role": "qa", "spec": spec, "allowed": spec.get("testFiles") or []},
                checked,
                {"rebuild": n} if n > 0 else {},
            )
            if qa_problem:
                return {"stop": "blocked", "reason": qa_problem}

            found = [
                {
                    "kind": "qa",
                    "file": norm_path(f.get("file")),
                    "line": f.get("line"),
                    "spec": spec["id"],
                    "problem": f.get("problem"),
                }
                for f in ((checked or {}).get("failures") or [])
            ]
            if not found:
                progress["build"][spec["id"]] = {"impl": "ok", "test": "ok"}
                return {"ok": True}

            state["failureLog"].extend(
                failure_entries([{"spec": spec, "failures": found}], {"stage": "qa", "round": n, "sentBack": n < max_rebuilds})
            )
            if n >= max_rebuilds:
                progress["build"][spec["id"]] = {"impl": "ok", "test": "fail"}
                return {
                    "stop": "failed",
                    "reason": f"{spec['id']}: QA still sends back {len(found)} failure(s) after {n} rebuild(s).",
                }
            state["sentBack"][spec["id"]] = n + 1
            log_cb(f"{spec['id']}: QA sent back {len(found)} failure(s); back to Build ({n + 1}/{max_rebuilds}).")
            progress["repairs"] = [
                *progress["repairs"],
                {
                    "tag": f"{spec['id']} from QA",
                    "text": f"{len(found)} failure(s), back to Build ({n + 1}/{max_rebuilds})",
                    "state": "ok",
                },
            ]
            pending = found
            from_source = "its QA agent"

    async def run_chains(jobs: List[Dict[str, Any]]) -> Optional[Dict[str, str]]:
        results = await run_parallel(
            jobs,
            lambda j: chain(j["spec"], j.get("failures"), j.get("source", "")),
        )
        stops = []
        for i, j in enumerate(jobs):
            r = results[i] if i < len(results) and results[i] else {
                "stop": "blocked",
                "reason": f"{j['spec']['id']}: its build did not finish.",
            }
            if r.get("stop"):
                stops.append(r)
        if not stops:
            return None
        return {
            "outcome": "blocked" if any(r["stop"] == "blocked" for r in stops) else "failed",
            "reason": " | ".join(r["reason"] for r in stops),
        }

    phase_cb("Build")
    for level in levels:
        for spec in level:
            progress["build"][spec["id"]] = {"impl": "run", "test": "wait"}
        record("Build", "running")
        stopped = await run_chains([{"spec": spec} for spec in level])
        if stopped:
            return stop(stopped["outcome"], f"The build could not be completed. {stopped['reason']}")

    # --- Check and review; failures go back to Build ------------------------
    round_num = 0
    rebuilt: Optional[Set[str]] = None
    while True:
        phase_cb("Check")
        record("Check", "running")
        tdd = tdd_targets([s for s in specs if s["id"] in rebuilt] if rebuilt is not None else specs)
        check = await run_checks(specs, round_num, tdd)
        if not check:
            return stop("blocked", "The checker did not return a result.")
        actual_files = git_changed_files(repo, base)
        if actual_files is not None:
            reported_files = [norm_path(f) for f in (check.get("changedFiles") or []) if norm_path(f)]
            if set(reported_files) != set(actual_files):
                log_cb(
                    f"Checker changedFiles ({len(reported_files)}) differed from git ({len(actual_files)}); "
                    "using git diff/ls-files directly."
                )
            check = {**check, "changedFiles": actual_files}
        state["check"] = check

        stray = files_outside_ownership(check.get("changedFiles"), specs, input_args.get("ignoreFiles"))
        owned = owned_files(specs)
        caches = [
            norm_path(f)
            for f in (check.get("changedFiles") or [])
            if norm_path(f) not in owned and any(matches_ignore(norm_path(f), e) for e in GENERATED)
        ]
        if caches:
            log_cb(f"Not counted as changes: {len(caches)} generated cache file(s) ({', '.join(caches)}).")
        if stray:
            return stop(
                "blocked",
                f"Files were changed that no spec owns: {', '.join(stray)}. "
                "Either the specs were incomplete or an agent went outside its assignment.",
            )
        touched = protected_files(
            check.get("changedFiles"),
            input_args.get("protectedPaths"),
            allow_protected,
        )
        if touched:
            return stop(
                "blocked",
                f"Protected files were changed: {', '.join(touched)}. "
                'They hold the checks the run is judged by; undo the change, or allow it with "allowProtected" if the task is about them.',
            )

        for fl in flaky_checks(contract, check):
            if not any(x["name"] == fl["name"] for x in state["flaky"]):
                state["flaky"].append(fl)
            log_cb(f"Flaky: check \"{fl['name']}\" failed, then passed when run again; not sent back, reported.")

        proof = (
            {"failures": [], "unproven": []}
            if is_blank(contract.get("testFileCommand"))
            else tdd_failures(tdd, check.get("baseRuns"))
        )
        for uid in proof["unproven"]:
            if uid not in state["tddUnproven"]:
                state["tddUnproven"].append(uid)

        red = [
            *check_failures(contract, check, repo),
            *migration_failures(contract, check),
            *proof["failures"],
        ]
        if red:
            log_cb(f"Gate: {len(red)} check(s) failed; no reviewer runs this round.")
            state["failures"] = red
            state["standards"] = standards_report(contract.get("standards"), check, [])
        else:
            phase_cb("Review")
            reviewed_specs = (
                specs
                if len(specs) > 1 and (ROUTING.get(state["risk"]["risk"]) or ROUTING["medium"])["specReviews"]
                else []
            )
            record("Review", "running")
            review_jobs: List[Tuple[str, Any]] = [
                ("whole", None),
                *[("spec", s) for s in reviewed_specs],
                *( [("qc", None)] if qc_on else [] ),
            ]

            async def _run_review_job(job: Tuple[str, Any]):
                kind, payload = job
                if kind == "whole":
                    return await run_review(check, specs, round_num)
                if kind == "spec":
                    return await run_spec_review(payload, check, round_num)
                return await run_qc(round_num)

            reviews = await run_parallel(review_jobs, _run_review_job)
            review = reviews[0] if reviews else None
            if not review:
                return stop("blocked", "The reviewer did not return a result.")
            spec_reviews = [
                {"spec": spec, "review": reviews[i + 1] if i + 1 < len(reviews) else None}
                for i, spec in enumerate(reviewed_specs)
            ]
            absent = [r["spec"]["id"] for r in spec_reviews if not r["review"]]
            if absent:
                return stop("blocked", f"The reviewer of {', '.join(absent)} did not return a result.")
            state["review"] = review
            state["specReviews"] = [{"spec": r["spec"]["id"], **r["review"]} for r in spec_reviews]

            qc = None
            if qc_on:
                qc_idx = len(reviewed_specs) + 1
                qc = reviews[qc_idx] if qc_idx < len(reviews) else None
                if not qc:
                    return stop("blocked", "The QC agent did not return a result.")
                state["qc"].append({"round": round_num, **qc})
                if qc.get("status") != "done":
                    return stop("blocked", f"QC could not run the product: {qc.get('blockedReason') or 'no reason given'}")
                leftover = [repo_path(f, repo) for f in (qc.get("filesChanged") or [])]
                leftover = [f for f in leftover if f]
                if leftover:
                    return stop(
                        "blocked",
                        f"QC changed files in the repository, which it may not do: {', '.join(leftover)}",
                    )

            state["failures"] = evaluate(contract, check, review, spec_reviews, qc, repo)
            state["standards"] = standards_report(
                contract.get("standards"),
                check,
                [review, *[r["review"] for r in spec_reviews]],
            )
            if not state["failures"]:
                state["merge"] = escalation(
                    check.get("changedFiles"),
                    state["risk"],
                    state["testsChangedInRebuild"],
                    input_args.get("escalate"),
                )
                merge_msg = (
                    "It may be merged without a person."
                    if state["merge"]["decision"] == "auto"
                    else f"A person must accept it before it is merged: {'; '.join(state['merge']['reasons'])}."
                )
                notes: List[str] = []
                if state["flaky"]:
                    notes.append(f"Flaky, fix the test: {', '.join(f['name'] for f in state['flaky'])}.")
                if state["tddUnproven"]:
                    notes.append(f"Not shown to fail on the base code (no base run): {', '.join(state['tddUnproven'])}.")
                qc_msg = " and QC saw it work" if qc_on else " (QC was turned off)"
                rnd_msg = f", after {round_num} return(s) to Build" if round_num > 0 else ""
                note_suffix = f" {' '.join(notes)}" if notes else ""
                return stop(
                    "passed",
                    f"All checks pass, every criterion is met{qc_msg}{rnd_msg}. {merge_msg}{note_suffix}",
                )

        groups = route_failures(state["failures"], specs, repo)
        spent = [g["spec"]["id"] for g in groups if state["sentBack"].get(g["spec"]["id"], 0) >= max_rebuilds]
        state["failureLog"].extend(
            failure_entries(groups, {"stage": "review", "round": round_num + 1, "sentBack": len(spent) == 0})
        )
        if spent:
            verb = "has" if len(spent) == 1 else "have"
            return stop(
                "failed",
                f"{len(state['failures'])} failure(s) remain, and {', '.join(spent)} {verb} already been sent back to Build {max_rebuilds} time(s).",
            )

        round_num += 1
        state["repairRounds"] = round_num
        for g in groups:
            sid = g["spec"]["id"]
            state["sentBack"][sid] = state["sentBack"].get(sid, 0) + 1
        rebuilt = {g["spec"]["id"] for g in groups}
        who = ", ".join(g["spec"]["id"] for g in groups)
        log_cb(f"{len(state['failures'])} failure(s) from check, review and QC; back to Build: {who}.")
        progress["repairs"] = [
            *progress["repairs"],
            {"tag": f"review {round_num}", "text": f"{len(state['failures'])} failure(s), back to Build: {who}", "state": "run"},
        ]
        phase_cb("Build")
        record("Build", "running")
        stopped = await run_chains([
            {"spec": g["spec"], "failures": g["failures"], "source": "the checker, the reviewers and QC"}
            for g in groups
        ])
        if stopped:
            return stop(stopped["outcome"], f"A spec sent back to Build could not be completed. {stopped['reason']}")
        progress["repairs"] = [
            {**r, "state": "ok"} if r.get("tag") == f"review {round_num}" else r
            for r in progress["repairs"]
        ]


if "args" in globals() and "agent" in globals():
    _result = await run_factory(
        args,
        agent_fn=agent,
        parallel_fn=globals().get("parallel"),
        phase_fn=globals().get("phase"),
        log_fn=globals().get("log", print),
    )
    print(json.dumps(_result, indent=2))
