#!/usr/bin/env node
// Print a ticket's Prototype section, for a prototype publish-prototype.sh pushed.
//
//   node prototype-section.mjs --commit <sha> --issue <n> --ticket <issue body file> \
//        [--repo owner/name] [--artifact <claude.ai link, for viewing only>]
//
// Run inside the repository: the manifest and the screenshots' names are read from
// the pushed commit, never from the working copy. The path is the one the ticket's
// criteria name. --repo defaults to the origin remote.
//
// Exit codes: 0 ok (section on stdout) · 64 usage · 70 the commit is not here
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { BINDING, criteriaLines, prototypePaths } from './check-prototype.mjs';

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export const isArtifactUrl = (url) => /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+$/.test(url || '');

// The one path the criteria name, when it is this issue's; otherwise ''.
export function ticketPath(body, issue) {
  const paths = new Set(criteriaLines(body).flatMap((c) => prototypePaths(c.text)));
  const [p] = paths;
  return paths.size === 1 && new RegExp(`^([A-Za-z0-9_-][A-Za-z0-9._-]*/)+issue-${issue}/index\\.html$`).test(p) ? p : '';
}

export const repoOf = (url) => /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/.exec(url || '')?.[1] || '';

export function section(m, { repo, commit, issue, path: file, artifact, shots }) {
  const what = m.source ? `Provided by the user: ${cell(m.source)}.` : 'Throwaway code: build what it shows, do not copy its source.';
  const img = (id, vp, w) =>
    shots
      .filter((f) => new RegExp(`^${id}-${vp}-(light|dark)\\.png$`).test(f))
      .sort()
      .reverse()
      .map((f) => `<img src="https://github.com/${repo}/raw/${commit}/shots/${f}" width="${w}" alt="${id}, ${f.slice(id.length + 1, -4)}">`)
      .join(' ') || 'not shot';
  const out = [
    '## Prototype',
    '',
    `- Branch: \`prototype/issue-${issue}\`, never merged; keep it until this issue's pull request is merged`,
    `- Commit: \`${commit}\``,
    `- Path in the repository: \`${file}\``,
    `- Drawn from: \`${m.drawnFrom.commit}\`${m.drawnFrom.files.length > 0 ? `, ${m.drawnFrom.files.map((f) => `\`${f}\``).join(', ')}` : ', no screen of the product'}`,
    ...((m.drawnFrom.unbuilt || []).length > 0 ? [`- Drawn before they were built: ${m.drawnFrom.unbuilt.map(cell).join('; ')}`] : []),
    ...(artifact ? [`- To look at it on claude.ai, for people it is shared with: ${artifact}`] : []),
    '',
    `Approved with the criteria, and binding through the ones that name it: what they name matches it ${BINDING[m.binding]}, never pixel for pixel. What it shows around that is context, and stays as the product has it. ${what} Where another criterion says otherwise, that criterion is right.`,
    '',
    'To use it, open the page this prints in any browser:',
    '',
    '```bash',
    `d=$(mktemp -d) && git fetch -q origin prototype/issue-${issue} && git archive ${commit} | tar -x -C "$d" && echo "$d/index.html"`,
    '```',
    '',
    'The factory copies it from that commit to that path when a run starts, unless the files it was drawn from have changed since or it was drawn on screens not yet built; agents read it there.',
    '',
    '| Screen | Criteria | Shows | Desktop | Mobile |',
    '|---|---|---|---|---|',
    ...m.screens.map((s) => `| \`${s.id}\`: ${cell(s.title)} | ${(s.criteria || []).join(', ') || 'context'} | ${cell(s.shows)} | ${img(s.id, 'desktop', 360)} | ${img(s.id, 'mobile', 160)} |`),
  ];
  if ((m.notShown || []).length > 0) out.push('', 'Not shown:', '', ...m.notShown.map((n) => `- ${n.criterion}: ${cell(n.why)}`));
  return out.join('\n');
}

if (process.argv[1]?.endsWith('prototype-section.mjs')) {
  const a = {};
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const git = (...x) => execFileSync('git', x, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const bad = !/^[0-9a-f]{40,64}$/.test(a.commit || '') || !/^[1-9]\d*$/.test(a.issue || '') || !a.ticket || !fs.existsSync(a.ticket) || (a.artifact && !isArtifactUrl(a.artifact));
  if (!bad) a.path = ticketPath(fs.readFileSync(a.ticket, 'utf8'), a.issue);
  if (!bad && !a.repo) {
    try {
      a.repo = repoOf(git('remote', 'get-url', 'origin').toString().trim());
    } catch {
      a.repo = '';
    }
  }
  if (bad) {
    console.error('usage: prototype-section.mjs --commit <sha> --issue <n> --ticket <body file> [--repo owner/name] [--artifact <link>]');
    process.exitCode = 64;
  } else if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(a.repo || '')) {
    console.error('cannot tell the repository from origin; pass --repo owner/name');
    process.exitCode = 64;
  } else if (!a.path) {
    console.error(`the ticket's criteria do not name exactly one path <folder>/issue-${a.issue}/index.html`);
    process.exitCode = 64;
  } else {
    try {
      const m = JSON.parse(git('show', `${a.commit}:prototype.json`).toString());
      const shots = git('ls-tree', '--name-only', `${a.commit}:shots`).toString().split('\n').filter(Boolean);
      console.log(section(m, { ...a, shots }));
    } catch (e) {
      console.error(`cannot read the prototype from ${a.commit}: ${e.message}`);
      process.exitCode = 70;
    }
  }
}
