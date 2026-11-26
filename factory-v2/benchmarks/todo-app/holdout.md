# Holdout Scenarios — Todo App Benchmark (Builder MUST NOT read)

H1 (Above-the-fold UX & C1): Open `/` at 1440px and 390px. Verify the task workspace is immediately visible above the fold without a giant multi-row form crushing the viewport, and sidebar actions use compact icons rather than bulky text buttons.

H2 (Persistence & C2/C6): Add a task titled `"Ship v2 release"` with multi-line notes `"Step 1\nStep 2"`, High priority, due today, and tag `"Launch"`. Reload the page (`F5`). Confirm the task, multi-line notes, badge, and `"Launch"` tag persist intact.

H3 (Undo & C3/C5): Toggle a task complete (verify strikethrough and open counter drops by 1), then delete a task, verify the Undo banner appears immediately, click Undo within 8 seconds, and confirm the task is restored.

H4 (Custom List Migration & C9): Create custom list `"Travel"`, add a task inside `"Travel"`, delete `"Travel"` via confirmation dialog, and confirm the task is moved safely to `"Inbox"`.

H5 (Combined Filters & C10/C11): Filter by status `"Active"` + tag `"Launch"` + search substring `"release"`, confirm logical AND behavior, then click Clear filters to recover all tasks.

H6 (Corrupted Storage Recovery & C6): Inject invalid JSON into localStorage, reload `/`, confirm the app resets gracefully without crashing and shows a dismissible warning banner.

H7 (Responsive & Dark Mode & C12): Verify zero console errors, zero page errors, and zero horizontal overflow (`scrollWidth <= clientWidth`) at 1440px and 390px in both light and dark color schemes.
