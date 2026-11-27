// state.json: the whole run. Written atomically (temp file + rename), so a crash
// leaves either the old or the new state, never half of one. state.js holds the
// same data for the dashboard, which a browser cannot fetch from file://.
import fs from 'node:fs';
import path from 'node:path';

export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function newState({ runId, repo, epic, dir }) {
  return {
    version: 1,
    runId,
    repo,
    epic,
    dir,
    status: 'starting',
    startedAt: now(),
    finishedAt: null,
    plan: null,
    changedAfterBA: [],
    snapshot: {},
    profile: null,
    prepared: null,
    tickets: {},
    locks: {},
    mergeLog: [],
    lastGreen: null,
    steps: {},
    agents: [],
    alarms: [],
    comments: {},
    final: null,
    runs: 0,
    notes: [],
  };
}

export const now = () => new Date().toISOString();

export class Store {
  constructor(runDir) {
    this.dir = runDir;
    this.file = path.join(runDir, 'state.json');
    this.state = null;
  }

  exists() {
    return fs.existsSync(this.file);
  }

  load() {
    this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    return this.state;
  }

  init(fields) {
    fs.mkdirSync(this.dir, { recursive: true });
    this.state = newState(fields);
    this.save();
    return this.state;
  }

  save() {
    const text = JSON.stringify(this.state, null, 2);
    writeAtomic(this.file, `${text}\n`);
    writeAtomic(path.join(this.dir, 'state.js'), `window.STATE = ${text};\n`);
  }

  // Timings of the steps of the pipeline, by name.
  begin(name) {
    const s = (this.state.steps[name] ||= { start: now(), end: null, ms: 0 });
    if (s.end) {
      // Started again (resume, a second final check): keep the time already spent.
      s.restart = now();
      s.end = null;
    }
    this.save();
  }

  end(name) {
    const s = this.state.steps[name];
    if (!s || s.end) return;
    s.end = now();
    s.ms += Date.parse(s.end) - Date.parse(s.restart || s.start);
    delete s.restart;
    this.save();
  }

  // A side effect done once per key: the recorded result is returned on a second call.
  async once(key, fn) {
    const done = (this.state.done ||= {});
    if (key in done) return done[key];
    const r = await fn();
    done[key] = r ?? true;
    this.save();
    return done[key];
  }
}
