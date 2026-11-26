# Third-party skills

The skills the Factory team's agents load, and the one `ba-ticket` designs prototypes with, copied from their own repositories. `factory/scripts/install-skills.sh` copies them into `~/.claude/skills`.

| Skill | Source | Commit | License | Needed by Factory |
|---|---|---|---|---|
| `codebase-design` | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/engineering/codebase-design` | `5863806dd4e15c63174bee4e7515a4256792ecfa` | [MIT](licenses/mattpocock-skills.txt) | required |
| `diagnosing-bugs` | mattpocock/skills `skills/engineering/diagnosing-bugs` | same | same | required |
| `mp-code-review` | mattpocock/skills `skills/engineering/code-review` | same | same | required |
| `tdd` | mattpocock/skills `skills/engineering/tdd` | same | same | required |
| `domain-modeling` | mattpocock/skills `skills/engineering/domain-modeling` | same | same | optional |
| `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) `skills/verification-before-completion` | `22f0b463e7a5e579904dd6211a520321035526f7` | [MIT](licenses/obra-superpowers.txt) | required |
| `pr-security-review` | [EricTechPro/super-board](https://github.com/EricTechPro/super-board) `skills/pr-security-review` | `d0b7d5a6850614ca809477c1af43d5d7da408726` | [MIT](licenses/EricTechPro-super-board.txt); the prompt is Anthropic's, [MIT](pr-security-review/LICENSE) | required |
| `testing-strategy` | [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) `engineering/skills/testing-strategy` | `e91a134584eb798bac7fb0379358006a2b63b965` | [Apache-2.0](licenses/anthropics-knowledge-work-plugins.txt) | required |
| `vitest` | [antfu/skills](https://github.com/antfu/skills) `skills/vitest` | `d524ed287eef22757297827ce42e3cad88abd20c` | [MIT](licenses/antfu-skills.txt) | optional |
| `playwright-best-practices` | [currents-dev/playwright-best-practices-skill](https://github.com/currents-dev/playwright-best-practices-skill) `playwright-best-practices` | `0b75b5835a87de1fdd202ba965f3bc5a27738fdf` | [MIT](licenses/currents-dev-playwright-best-practices-skill.txt) | optional |
| `frontend-design` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) `plugins/frontend-design/skills/frontend-design` | `44490cccaf6d9f82fdeec9416fbf7c9bd72575dc` | [Apache-2.0](frontend-design/LICENSE.txt) | not used; `ba-ticket` reads it |

The files are unmodified, with one exception: mattpocock's `code-review` is named `mp-code-review` (folder and the `name:` line of its SKILL.md), so that it does not take the name of Claude Code's own `/code-review` command.

To update a skill, replace its folder with the one at a newer commit, keep that rename, and change its commit here. Do not edit the text of a skill in place: the next update would lose it.
