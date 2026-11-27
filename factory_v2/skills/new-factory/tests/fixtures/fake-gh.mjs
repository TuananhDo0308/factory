#!/usr/bin/env node
// A stand-in for gh, enough for the orchestrator and check-batch. Data in
// $NF_FAKE_GH_DATA (issues by number); writes are appended to <data>.events.jsonl
// so parallel calls do not lose each other.
import fs from 'node:fs';

const dataFile = process.env.NF_FAKE_GH_DATA;
const eventsFile = `${dataFile}.events.jsonl`;
const args = process.argv.slice(2);

function load() {
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const events = fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  for (const e of events) {
    const i = data.issues[e.issue];
    if (!i) continue;
    i.comments ||= [];
    if (e.type === 'comment') i.comments.push({ id: e.id, body: e.body });
    if (e.type === 'add-label' && !i.labels.some((l) => l.name === e.label)) i.labels.push({ name: e.label });
    if (e.type === 'remove-label') i.labels = i.labels.filter((l) => l.name !== e.label);
  }
  return data;
}
const event = (e) => fs.appendFileSync(eventsFile, `${JSON.stringify({ ...e, at: Date.now() })}\n`);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const [a, b, c] = args;
if (a === 'issue' && b === 'view') {
  const i = load().issues[c];
  if (!i) {
    console.error(`no issue ${c}`);
    process.exit(1);
  }
  const fields = (opt('--json') || 'number,title,body').split(',');
  console.log(JSON.stringify(Object.fromEntries(fields.map((f) => [f, i[f] ?? (f === 'labels' ? [] : f === 'state' ? 'OPEN' : null)]))));
} else if (a === 'issue' && b === 'comment') {
  const body = opt('--body') ?? fs.readFileSync(opt('--body-file'), 'utf8');
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  event({ type: 'comment', issue: Number(c), id, body });
  console.log(`https://github.com/x/y/issues/${c}#issuecomment-${id}`);
} else if (a === 'issue' && b === 'edit') {
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '--add-label') event({ type: 'add-label', issue: Number(c), label: args[k + 1] });
    if (args[k] === '--remove-label') event({ type: 'remove-label', issue: Number(c), label: args[k + 1] });
  }
} else if (a === 'label') {
  if (b === 'list') console.log('[]');
} else if (a === 'api') {
  const m = /issues\/(\d+)\/comments/.exec(b);
  const i = m && load().issues[m[1]];
  console.log(JSON.stringify((i?.comments || []).map((x) => ({ id: x.id, body: x.body }))));
} else {
  console.error(`fake gh: unsupported ${args.join(' ')}`);
  process.exit(2);
}
