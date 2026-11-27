# Nhiệm vụ: build skill `new-factory` theo thiết kế đã chốt

Nói chuyện với người dùng bằng tiếng Việt. Code, SKILL.md và các brief của agent viết bằng tiếng Anh.

## Đọc trước, theo thứ tự

1. **Thiết kế, là nguồn sự thật:** `/Users/macbookpro/Documents/new_factory/docs/factory-design.md`. Build đúng như file này viết. Chỗ nào file không nói, chọn cách đơn giản và nhanh nhất rồi ghi lại để báo người dùng. Chỗ nào **mâu thuẫn hay không làm được**, dừng lại và hỏi người dùng, không tự đổi thiết kế.
2. **Skill BA, cung cấp input cho factory:** `/Users/macbookpro/Documents/new_factory/skills/new-ba/`. Đọc `references/plan.md`, `references/plan-schema.json`, `references/slicing.md`, `references/ticket-template.md` và phần đầu `scripts/check-batch.mjs`. Factory **gọi thẳng** `check-batch.mjs --repo <owner/name> --epic <n> --write <file>` để dựng kế hoạch, không tự viết lại logic đó. Không sửa skill BA. Nếu thấy BA thiếu thứ factory cần, ghi lại và báo người dùng.
3. **Factory cũ, chỉ để tham khảo:** `~/.sf/skills-repo/claude/factory/` (`roles/*.md`, `scripts/`). Có thể mượn ý từ các brief cũ (implementer, reviewer, qc) nhưng **rút gọn mạnh**. Brief cũ dài 7–14KB, đó là một trong các sai lầm. Không copy `workflow/factory.js`.

## Vì sao làm lại (đừng lặp lại)

Factory cũ mất khoảng 5 tiếng cho một app todo, vì: chia spec theo tầng nên chạy nối tiếp; mỗi criterion có 4–5 agent chấm; dùng agent cho việc của code (checker, recorder), vì Workflow script không đọc ghi file và không chạy được lệnh; QC click tay qua MCP; brief dài. **Ưu tiên số một của người dùng là tổng thời gian chạy.** Mọi lựa chọn khi build phải giữ đường chạy bình thường (không có lỗi) nhanh nhất có thể.

## Ràng buộc

- **Bộ điều phối là Node, không dùng Workflow tool.** Không cài package nào: chỉ dùng module có sẵn của Node (`child_process`, `fs`, `path`, `crypto`). Agent gọi bằng `claude -p`, GitHub bằng `gh`, git bằng `git`. Máy có Node v26.13.1, Claude Code 2.1.332, gh 2.102.0. Kiểm flag thật bằng `claude --help` trước khi dùng.
- **Việc của code thì code làm.** Agent chỉ dùng cho: implementer, reviewer, chẩn đoán (4d), reviewer thứ hai phân xử, QC smoke. Không có agent nào khác.
- **Agent không đụng git của nhánh chính.** Agent chỉ sửa file và commit trong worktree của nó. Merge, revert, push, label, comment đều do bộ điều phối làm. Giới hạn tool của agent bằng flag của `claude -p`, không bật chế độ bỏ qua quyền.
- **Không timeout.** Theo đúng 4e: báo động khi kẹt, chỉ kill **process con** đã nhận ra được nguyên nhân, theo PID trong cây process của agent. Không bao giờ kill agent, không bao giờ `pkill` theo tên.
- **Chỉ merge vào `staging`**, bằng `--no-ff`. Không bao giờ đụng `main`, không force-push. Nếu repo chưa có nhánh `staging`, hỏi người dùng.
- **Brief của agent ngắn**: mỗi brief dưới khoảng 4KB. SKILL.md dưới khoảng 10KB. Chi tiết để trong code hoặc `references/`.
- Push notification: Node không gọi được tool của Claude Code, nên dùng thông báo của macOS (`osascript -e 'display notification ...'`) cộng với comment trên issue.

## Cần làm ra

Skill ở `/Users/macbookpro/Documents/new_factory/skills/new-factory/`. Tên `new-factory` dùng gạch ngang vì tên skill không dùng gạch dưới; báo người dùng tên này.

- `SKILL.md`, mỏng. Skill trong Claude Code chỉ làm mấy việc:
  - nhận số epic và repo;
  - khởi động `node orchestrator/run.mjs ...` ở background;
  - báo người dùng cách theo dõi;
  - đọc báo cáo khi xong;
  - chạy tiếp một bộ, hoặc một ticket `needs-decision` sau khi người dùng trả lời.
- `orchestrator/`, chia thành module nhỏ, mỗi module một việc và test được riêng:
  - state (đọc ghi `state.json` theo kiểu atomic; mọi bước có tác dụng phụ đều kiểm trạng thái trước khi làm);
  - plan (gọi `check-batch`, kiểm label `ready`);
  - queue (mỗi lúc một bộ trên `staging`);
  - prepare (bước 2);
  - scheduler (đồ thị phụ thuộc, tối đa 4 ticket cùng lúc);
  - ticket runner (4a–4c);
  - fix loop (4d, gồm bảng khóa và các luật chống kẹt);
  - merge (bước 5, gồm tìm thủ phạm bằng cách chia đôi);
  - final (bước 6: check đầy đủ, QC, revert);
  - resume (bước 7);
  - watchdog (4e);
  - report và dashboard (bước 8, trang HTML tĩnh đọc `state.json`).
- `roles/`: `implementer.md`, `reviewer.md` (bản L thêm phần security), `diagnoser.md`, `qc.md`.
- Bảng model theo hạng, đúng như bảng trong thiết kế. Model nhẹ là `haiku`, rồi `sonnet`, `opus`. Phần leo thang ở 4d (vòng 3 dùng model mạnh hơn) cũng theo thiết kế.
- `tests/`, xem mục dưới.

## Thứ tự build và kiểm

Làm theo từng mốc. Hết mỗi mốc, báo người dùng ngắn gọn: đã xong gì, test nào pass.

1. **Mốc 1: nền.** State, plan, queue, prepare. Riêng phần prepare, gồm: gom `newDependencies`, copy prototype, cài thư viện một lần, clone `node_modules` copy-on-write, kiểm trước hai server trên hai port và có trình duyệt.
2. **Mốc 2: một ticket chạy từ đầu đến cuối.** Worktree, implementer, 4b (check của dự án, Owns so với merge-base, mỗi criterion có test gắn ID và có assertion), reviewer, merge.
3. **Mốc 3: song song.** Scheduler theo đồ thị, merge xếp hàng, sinh lại lockfile, check sau khi ghép chỉ khi có ticket phụ thuộc đang chờ, tìm thủ phạm bằng chia đôi.
4. **Mốc 4: lỗi và ngõ cụt.** 4d đầy đủ (chẩn đoán, bảng khóa, chuyển khóa, phát hiện vòng chờ, giới hạn 4 vòng), `needs-decision`, revert sau QC, chạy tiếp (gồm revert của commit revert), crash rồi chạy lại.
5. **Mốc 5: cuối bộ.** Check đầy đủ trên `staging`, QC (e2e báo theo criterion, cộng agent smoke qua Playwright MCP), watchdog và báo động, báo cáo và dashboard.
6. **Mốc 6: chạy thật.** Xem mục dưới.

**Test:**
- Unit test bằng `node --test` cho các phần thuần logic: scheduler, bảng khóa và phát hiện vòng, kiểm Owns (gồm xóa và đổi tên file, các file bị bỏ qua), kiểm test theo criterion, chia đôi tìm thủ phạm, đọc ghi state và chạy tiếp, phân loại nguyên nhân kẹt.
- **Test tích hợp không tốn token:** bộ điều phối đọc đường dẫn lệnh agent từ biến môi trường (ví dụ `NF_CLAUDE_BIN`), để test thay `claude` bằng một script giả. Script giả sửa file và commit theo kịch bản, trên một repo git fixture có `staging`. Phải có kịch bản cho:
  - đường chạy bình thường với 3 ticket, 2 trong số đó chạy song song;
  - xung đột ý nghĩa sau khi ghép;
  - ticket sửa ngoài Owns;
  - ticket tới `needs-decision` rồi chạy tiếp;
  - revert sau QC rồi chạy tiếp;
  - crash giữa chừng rồi chạy lại;
  - process con chạy ở chế độ watch bị kẹt.
- Toàn bộ test phải pass trước mốc 6.

## Mốc 6: chạy thật

- Repo thử: `sangtruong-rgb/new-ba-sandbox` (private). **Hỏi người dùng trước khi chạy**. Nếu chưa có bộ ticket, nhờ người dùng chạy skill `new-ba` với yêu cầu "làm app todo list" trước.
- Chạy factory trên epic đó. Báo người dùng:
  - tổng thời gian, và thời gian từng bước;
  - số agent đã gọi, chi phí;
  - ticket nào giao xong, ticket nào `needs-decision`;
  - so với khoảng 5 tiếng của factory cũ.
- Nếu đường chạy bình thường chậm hơn mục tiêu trong bảng phân hạng (S 5–10 phút, M 15–20 phút, L khoảng 30 phút mỗi ticket), chỉ ra bước nào tốn thời gian nhất và đề xuất cách giảm. **Không tự sửa thiết kế.**

## Không làm

- Không sửa `factory`, `ba-ticket` hay `new-ba`.
- Không cài skill vào `~/.claude/skills` nếu chưa hỏi người dùng.
- Không thêm bước, agent hay kiểm tra nào ngoài thiết kế. Thấy cần thì đề xuất với người dùng.

## Hoàn thành khi

Toàn bộ test pass, mốc 6 đã chạy và có số liệu, và người dùng nhận được danh sách: những gì đã build, những chỗ đã tự chọn vì thiết kế không nói, những gì còn chưa làm hoặc chưa chắc.
