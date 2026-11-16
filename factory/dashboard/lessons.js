// Lessons: mistakes the factory team made in several runs, and what was decided
// about each, oldest first. The invoking session adds an entry when the failure
// logs in runs.js show the same mistake in 3 or more runs (SKILL.md, step 7),
// and records the user's decision. index.html lists them on the Factory page.
// It is a script, not JSON, so the page can load it straight from disk.
//
// An entry is never a fix in itself: an accepted lesson is made later as an
// ordinary change to the skill (a rule in workflow/factory.js with its test, or
// one sentence in a role brief), and whoever makes it sets `status` to 'done'.
//
// Fields:
//   id         short name of the pattern, e.g. 'interface-names-drift'
//   pattern    the mistake, in one sentence, as a role or a step makes it
//   runs       ids of the runs in runs.js where it occurred
//   evidence   a few failure-log problems or blocked reasons that show it
//   proposal   the fix, in one sentence
//   target     where the fix goes: 'factory.js' or 'roles/<role>.md'
//   status     'proposed' | 'accepted' | 'rejected' | 'done'
//   proposed   date it was proposed (YYYY-MM-DD)
//   decided    date of the user's decision, once there is one
//   note       the user's reason, or what the fix changed
window.FACTORY_LESSONS = []
