#!/usr/bin/env node
// Tell a repository with no code yet from one that has code, for architecture.layout.
//
//   node detect-layout.mjs [<repository root>]          (default: the current directory)
//
// Counts the files git tracks, leaving out README*, LICENSE*, .gitignore, .github/**
// and docs/**. None left (or no commit yet): "pages-features", and the batch lays the
// repository out as references/slicing.md says. Any left: "existing", and the batch
// follows the repository's own structure.
//
// stdout: one JSON line { "layout": "...", "codeFiles": n, "examples": [...] }
// Exit codes: 0 ok · 64 not a git repository
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const NOT_CODE = /^(?:README(?:\.[^/]*)?|LICEN[CS]E(?:\.[^/]*)?|\.gitignore|\.gitattributes|\.github\/.*|docs\/.*)$/i;

export function layoutOf(files) {
  const code = files.filter((f) => f && !NOT_CODE.test(f));
  return { layout: code.length === 0 ? 'pages-features' : 'existing', codeFiles: code.length, examples: code.slice(0, 5) };
}

function main(argv) {
  const root = path.resolve(argv[0] || '.');
  let files;
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
  } catch {
    console.error(`${root} is not a git repository`);
    return 64;
  }
  console.log(JSON.stringify(layoutOf(files)));
  return 0;
}

if (process.argv[1]?.endsWith('detect-layout.mjs')) process.exitCode = main(process.argv.slice(2));
