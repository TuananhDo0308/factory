# Factory

Một skill cho Claude Code để chạy một tác vụ lập trình qua một nhóm agent làm việc cùng nhau, thay vì một agent làm hết trong một lượt.

Đây là bản nền (baseline) được viết lại từ đầu: chỉ có hướng dẫn bằng Markdown, chưa có script, sổ ghi bằng chứng hay dashboard.

## Nhóm agent

| Vai trò | Việc làm | Có sửa code không |
|---|---|---|
| Coordinator (phiên Claude bạn đang dùng) | Viết hợp đồng công việc, giao việc, tự chạy kiểm tra, quyết định, báo cáo | Không |
| Planner | Đọc code và trả về một hoặc nhiều spec | Không |
| Implementer | Thực hiện đúng một spec, trong các file spec đó sở hữu | Có |
| Reviewer | Đánh giá kết quả so với hợp đồng | Không |

Lý do dùng nhóm: mỗi agent nhìn công việc bằng con mắt mới. Reviewer không được xem lời giải thích của implementer, nên nó đánh giá code chứ không đánh giá câu chuyện về code.

## Quy trình

1. **Hợp đồng**: mục tiêu, tiêu chí chấp nhận `C1..Cn`, phần ngoài phạm vi, và các lệnh kiểm tra thật của dự án.
2. **Spec**: planner trả về một hoặc nhiều spec. Mỗi spec là một phiếu giao việc tự đủ: mục tiêu, tiêu chí phụ trách, file sở hữu, interface dùng chung, thay đổi cần làm, test, và điều kiện hoàn thành. Task lớn được tách thành nhiều spec, vì một agent nhận quá nhiều việc cùng lúc dễ đoán mò và bịa chi tiết.
3. **Xây dựng**: mỗi spec một implementer, và implementer chỉ thấy spec của mình. Các spec không phụ thuộc nhau chạy song song; spec phụ thuộc thì chờ spec kia xong. Không file nào thuộc hai spec.
4. **Kiểm tra**: coordinator tự chạy test trên kết quả gộp và đọc kết quả.
5. **Review**: một reviewer mới đánh giá diff theo hợp đồng.
6. **Sửa hoặc kết thúc**: lỗi được gửi lại cho implementer rồi review lại bằng reviewer mới, tối đa hai vòng sửa.

Kết thúc bằng một báo cáo ngắn: kết quả, thay đổi gì, từng tiêu chí kèm bằng chứng, từng lệnh kiểm tra kèm kết quả thật, và kết luận của reviewer.

## Cấu trúc thư mục

```
factory/
├── SKILL.md              hướng dẫn cho coordinator
├── roles/
│   ├── planner.md        bản mô tả vai trò planner
│   ├── implementer.md    bản mô tả vai trò implementer
│   └── reviewer.md       bản mô tả vai trò reviewer
└── evals/                các bài test của skill
    └── adds-json-flag-to-cli/
```

## Cài đặt

Sao chép thư mục `factory/` vào thư mục skill của Claude Code:

```sh
cp -r factory ~/.claude/skills/factory
```

Lưu ý: nếu `~/.claude/skills/factory` đã tồn tại (ví dụ bộ Factory cũ), lệnh trên sẽ ghi lẫn vào bản cũ. Hãy sao lưu hoặc xóa bản cũ trước.

Không cần cài agent riêng: mỗi agent là một agent `general-purpose` được yêu cầu đọc bản mô tả vai trò của mình trong `roles/`.

## Cách dùng

Trong Claude Code, mở repo cần làm việc rồi gõ:

```
/factory thêm cờ --json cho lệnh wordstats, giữ nguyên output mặc định và có test
```

Skill cũng tự kích hoạt khi bạn yêu cầu một "factory" hoặc một nhóm agent lập kế hoạch, xây dựng và review một tác vụ.

## Giới hạn hiện tại

- Chưa được kiểm thử đầy đủ: mới có một bài test được định nghĩa trong `factory/evals/`, chưa có kết quả chấm điểm.
- Quy tắc "planner và reviewer không sửa gì" là chỉ dẫn trong prompt, không phải giới hạn công cụ được ép buộc.
- Trạng thái của một lần chạy nằm trong cuộc hội thoại; không có sổ ghi để tiếp tục sau khi phiên kết thúc.
- Một quy trình chung cho mọi loại việc (tính năng, sửa lỗi, refactor, test); chưa có chế độ riêng cho từng loại.
- Không tự commit, push hay mở pull request trừ khi được yêu cầu.
