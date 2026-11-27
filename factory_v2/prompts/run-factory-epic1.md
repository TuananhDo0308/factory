# Nhiệm vụ: chạy `new-factory` lần đầu trên epic #1 của `sangtruong-rgb/new-ba-sandbox`

Nói chuyện với người dùng bằng tiếng Việt. Đây là **mốc 6** của `prompts/build-factory.md`: chạy thật lần đầu và đo thời gian.

## Đầu vào

- Repo: `sangtruong-rgb/new-ba-sandbox` (private). Epic **#1** "Todo list có tài khoản, v1", các ticket #2–#8, tất cả đã có label `ready`.
- Đã kiểm trước khi chạy: `check-batch` pass, hash khớp với kế hoạch trong epic, 21 thư viện khai báo đều có trên npm.
- Đồ thị: #2 nền móng (L) → #3 (L), #4, #5, #6, #7 (M) chạy song song → #8 (M, phụ thuộc #4).
- Repo hiện chỉ có `README` trên `main`, chưa có nhánh `staging`. **Người dùng đồng ý tạo `staging` từ `main`**: chạy với `--create-staging`.

## Làm

1. Đọc `/Users/macbookpro/Documents/new_factory/skills/new-factory/SKILL.md` và làm đúng theo đó. Skill chưa được cài vào `~/.claude/skills`, nên gọi thẳng `orchestrator/run.mjs` theo đường dẫn tuyệt đối của nó.
2. Clone repo vào `/Users/macbookpro/Documents/new-ba-sandbox`. Nếu thư mục đó đã có thì dùng luôn, sau khi kiểm `git remote get-url origin` đúng repo này.
3. Trước khi chạy, chạy test của skill một lần (`node --test tests/` trong thư mục skill) và xác nhận tất cả pass.
4. Khởi động ở background: `node <skill>/orchestrator/run.mjs --repo sangtruong-rgb/new-ba-sandbox --epic 1 --create-staging --dir /Users/macbookpro/Documents/new-ba-sandbox`. Báo người dùng đường dẫn dashboard và log như SKILL.md nói.
5. Có báo động hay ticket `needs-decision` thì báo người dùng ngay, nguyên văn câu hỏi. **Không tự trả lời thay người dùng.**

## Không làm

- Không sửa code của factory, của `new-ba`, hay các ticket trong lúc đang chạy. Thấy lỗi của factory thì ghi lại, để chạy xong mới báo.
- Không merge hay push vào `main`.
- Không chạy lại từ đầu khi run dừng giữa chừng. Dùng cách chạy tiếp mà SKILL.md mô tả.

## Khi xong, báo người dùng

1. Tổng thời gian (wall clock), cùng thời gian của từng bước: chuẩn bị, nền móng #2, đợt 1, #8, ghép, check cuối, QC.
2. Thời gian của từng ticket so với mục tiêu theo hạng: S 5–10 phút, M 15–20 phút, L khoảng 30 phút.
3. Số agent đã gọi, tổng chi phí, số vòng sửa của từng ticket.
4. Ticket nào đã giao, ticket nào `needs-decision` (kèm câu hỏi), ticket nào chưa giao.
5. So với factory cũ: khoảng 5 tiếng cho app todo.
6. **Bước nào tốn thời gian nhất, và vì sao**, đọc từ `state.json` và log. Đề xuất cách giảm, nhưng không tự sửa.
7. Những lỗi của factory đã ghi lại trong lúc chạy.
