# Factory

Multi-agent coding factory suites for **Gemini Antigravity** and **Claude Code**, plus the **Software Factory** tracking web application.

## Repository Layout

```text
factory/
├── antigravity/       Self-contained Gemini Antigravity skill suite (Python run_workflow, GEMINI.md, tests)
├── claude/            Self-contained Claude Code skill suite (JS Workflow tool, CLAUDE.md, tests)
└── software-factory/  Software Factory web app & internal CLI (`sf`) — Next.js + SQLite/Prisma (in design)
```

Each runtime folder (`antigravity/` and `claude/`) is completely self-contained so it can be installed or symlinked independently without cross-folder dependencies:

- **Gemini Antigravity**: see [`antigravity/README.md`](antigravity/README.md) and [`antigravity/GEMINI.md`](antigravity/GEMINI.md). Symlink skills from `antigravity/<skill>` into `~/.gemini/config/skills/`.
- **Claude Code**: see [`claude/README.md`](claude/README.md) and [`claude/CLAUDE.md`](claude/CLAUDE.md). Symlink skills from `claude/<skill>` into `~/.claude/skills/`.
- **Software Factory**: see [`software-factory/README.md`](software-factory/README.md).

## Running Tests

### Antigravity suite
```sh
cd antigravity
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs tests/*.test.ts
```

### Claude Code suite
```sh
cd claude
node --test tests/*.test.mjs tests/*.test.ts
```
