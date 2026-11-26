// Lessons: mistakes the factory team made in several runs, and what was decided
// about each, oldest first. The invoking session adds an entry when the failure
// logs in runs.js show the same mistake in 3 or more runs (SKILL.md, step 7),
// and records the user's decision. index.html lists them on the Factory page.
// It is a script, not JSON, so the page can load it straight from disk.
//
// An entry is never a fix in itself: an accepted lesson is made later as an
// ordinary change to the skill (a rule in workflow/factory.py with its test, or
// one sentence in a role brief), and whoever makes it sets `status` to 'done'.
//
// Fields:
//   id         short name of the pattern, e.g. 'interface-names-drift'
//   pattern    the mistake, in one sentence, as a role or a step makes it
//   runs       ids of the runs in runs.js where it occurred
//   evidence   a few failure-log problems or blocked reasons that show it
//   proposal   the fix, in one sentence
//   target     where the fix goes: 'factory.py' or 'roles/<role>.md'
//   status     'proposed' | 'accepted' | 'rejected' | 'done'
//   proposed   date it was proposed (YYYY-MM-DD)
//   decided    date of the user's decision, once there is one
//   note       the user's reason, or what the fix changed
window.FACTORY_LESSONS = [
  {"id":"qc-browser-preflight-check","pattern":"UI runs complete Spec, Build, QA, Check, and all Reviews before QC discovers that Playwright MCP cannot launch a browser on the host machine (unconfigured server or missing Chrome binary).","runs":["2026-11-25-i2-xxvd","2026-11-25-i2-z2q1","2026-11-25-i7-we27"],"evidence":["2026-11-25-i2-xxvd: QC could not run the product: Browser mode is set to http (no Playwright MCP browser tools configured in this session).","2026-11-25-i2-z2q1: Playwright MCP server (playwright) failed to launch a browser on browser_navigate with Chromium distribution chrome is not found at /Applications/Google Chrome.app/Contents/MacOS/Google Chrome.","2026-11-25-i7-we27: Playwright MCP browser server failed to initialize: Chromium distribution chrome is not found at /Applications/Google Chrome.app/Contents/MacOS/Google Chrome (only Playwright chromium caches exist under ~/Library/Caches/ms-playwright)."],"proposal":"Before starting the Build phase on UI runs with QC enabled, run a fast Playwright MCP smoke probe (or require --browser chromium / installed Chrome verification in preflight) so an unlaunchable browser blocks immediately instead of after Build, QA, and Review.","target":"factory.py","status":"proposed","proposed":"2026-11-26","decided":"","note":""}
]
