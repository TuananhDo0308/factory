# Factory

Một skill cho Claude Code để chạy một tác vụ lập trình qua một nhóm agent làm việc cùng nhau, thay vì một agent làm hết trong một lượt.

Nhóm agent được điều phối bằng code (một script Workflow), không phải bằng một agent đọc hướng dẫn. Thứ tự các bước, việc mỗi agent được thấy gì, và số vòng sửa do code quyết định nên không thể bị làm lệch.

Đây là bản nền (baseline) được viết lại từ đầu: chưa có sổ ghi bằng chứng hay dashboard.

## Ai làm gì

| Vai trò | Việc làm | Có sửa code không |
|---|---|---|
| Phiên Claude bạn đang chat | Viết hợp đồng công việc với bạn, khởi động workflow, tự chạy lại kiểm tra, báo cáo | Không |
| Script workflow (code) | Điều phối các agent bên dưới, kiểm tra spec, quyết định đạt hay không đạt | Không |
| Planner | Đọc code và trả về một hoặc nhiều spec | Không |
| Implementer | Viết code cho đúng một spec, trong các file nguồn spec đó sở hữu. Không viết test | Có |
| Tester | Viết test cho đúng một spec, trong các file test spec đó sở hữu, không thấy code của implementer | Có (chỉ file test) |
| Checker | Chạy các lệnh kiểm tra của hợp đồng và liệt kê file đã thay đổi | Không |
| Reviewer | Đánh giá toàn bộ thay đổi so với hợp đồng, và chỗ các phần ghép với nhau | Không |
| Spec reviewer | Chỉ khi task được tách: đọc kỹ từng dòng các file của một spec | Không |

Lý do tách spec: một agent nhận quá nhiều việc cùng lúc dễ đoán mò và bịa chi tiết. Mỗi spec được build, và sửa nếu cần, bởi một agent riêng trong một phiên riêng, chỉ thấy đúng spec đó; không agent nào nhận nhiều spec cùng lúc. Test của một spec do một agent khác với agent viết code đảm nhận: hai agent làm song song từ cùng một spec và không thấy sản phẩm của nhau, để test đo đúng yêu cầu chứ không được viết cho khớp với code đã làm. Review cũng được chia như vậy: mỗi spec có một reviewer riêng, cộng một reviewer đánh giá toàn bộ thay đổi theo hợp đồng. Không reviewer nào thấy lời giải thích của implementer, nên họ đánh giá code chứ không đánh giá câu chuyện về code.

## Quy trình

1. **Hợp đồng** (phiên chat): mục tiêu, tiêu chí chấp nhận `C1..Cn`, phần ngoài phạm vi, và các lệnh kiểm tra thật của dự án.
2. **Workflow** (code), gồm năm pha:
   - **Spec**: planner trả về spec. Code từ chối và gửi lại kèm lý do nếu có tiêu chí chưa spec nào phụ trách, một file thuộc hai spec, hoặc các phụ thuộc không xếp được thứ tự.
   - **Build**: mỗi spec có một implementer viết code và một tester viết test, chạy song song; mỗi bên sở hữu file riêng và không được xem phần spec dành cho bên kia. Spec không có file test thì không có tester; spec chỉ có file test thì không có implementer. Spec độc lập chạy song song; spec phụ thuộc thì chờ. Agent nào báo đã sửa file không thuộc quyền của mình sẽ làm dừng lượt chạy.
   - **Check**: checker chạy các lệnh kiểm tra và liệt kê file đã đổi. File bị sửa mà không spec nào sở hữu sẽ dừng cả lượt chạy.
   - **Review**: một reviewer mới đánh giá toàn bộ thay đổi theo hợp đồng. Khi có nhiều spec, mỗi spec có thêm một reviewer riêng chỉ thấy spec đó và các file của nó; tất cả chạy song song. Một tiêu chí chỉ đạt khi mọi reviewer phụ trách nó đều đánh giá là đạt.
   - **Repair**: nếu còn lỗi, mỗi spec bị ảnh hưởng được sửa bởi implementer và tester riêng của nó, mỗi bên chỉ thấy spec đó và các lỗi liên quan tới file của mình; tester được sửa test sai so với spec nhưng không được nới test cho khớp code. Sau đó checker và các reviewer mới xem lại. Tối đa hai vòng.
3. **Xác nhận và báo cáo** (phiên chat): tự chạy lại các lệnh kiểm tra, rồi báo cáo kết quả, từng tiêu chí kèm bằng chứng, và những gì còn mở.

Code tự tính đạt hay không đạt: mọi lệnh kiểm tra thoát với mã 0, mọi tiêu chí được đánh giá là đạt, và không còn lỗi chặn. Không agent nào tự tuyên bố "đạt".

Khi gặp tình huống cần quyết định (spec sai, implementer cần file ngoài quyền), workflow dừng với trạng thái `blocked` và trả việc về cho phiên chat.

## Cấu trúc thư mục

```
factory/
├── SKILL.md              hướng dẫn cho phiên chat: hợp đồng, gọi workflow, báo cáo
├── workflow/
│   └── factory.js        script điều phối
├── roles/
│   ├── planner.md        bản mô tả vai trò planner và định dạng spec
│   ├── implementer.md
│   ├── tester.md         người viết test cho từng spec
│   ├── checker.md
│   ├── reviewer.md       reviewer toàn bộ thay đổi
│   └── spec-reviewer.md  reviewer cho từng spec
└── evals/                các bài test của skill
    └── adds-json-flag-to-cli/
```

## Yêu cầu

- Claude Code có công cụ Workflow. Nếu phiên không có công cụ này, skill sẽ báo là không chạy được thay vì tự điều phối bằng tay.
- Repo cần làm việc phải là git repo có ít nhất một commit.

## Cài đặt

Sao chép thư mục `factory/` vào thư mục skill của Claude Code:

```sh
cp -r factory ~/.claude/skills/factory
```

Lưu ý: nếu `~/.claude/skills/factory` đã tồn tại (ví dụ bộ Factory cũ), lệnh trên sẽ ghi lẫn vào bản cũ. Hãy sao lưu hoặc xóa bản cũ trước.

Không cần cài agent riêng: mỗi agent được yêu cầu đọc bản mô tả vai trò của mình trong `roles/`.

## Cách dùng

Trong Claude Code, mở repo cần làm việc rồi gõ:

```
/factory thêm cờ --json cho lệnh wordstats, giữ nguyên output mặc định và có test
```

Skill cũng tự kích hoạt khi bạn yêu cầu một "factory" hoặc một nhóm agent lập kế hoạch, xây dựng và review một tác vụ.

## Giới hạn hiện tại

- Script workflow không tự chạy được lệnh, nên kết quả kiểm tra trong lượt chạy do agent checker báo về. Phiên chat chạy lại các lệnh đó sau khi workflow xong để có bằng chứng trực tiếp.
- Quy tắc "planner, checker và các reviewer không sửa gì" là chỉ dẫn trong prompt, không phải giới hạn công cụ được ép buộc. Code chỉ phát hiện được file bị sửa ngoài quyền sở hữu của các spec.
- Implementer và tester của một spec làm việc trên cùng một thư mục, nên việc "không xem file của nhau" cũng là chỉ dẫn trong prompt. Code chỉ so danh sách file mỗi agent tự báo đã sửa với các file nó sở hữu.
- Một lệnh kiểm tra thất bại không gán được cho spec nào, nên ở vòng sửa nó được gửi cho implementer và tester của mọi spec.
- Các implementer và tester chạy song song trên cùng một thư mục làm việc; an toàn là nhờ không file nào có hai chủ.
- Trạng thái của một lượt chạy không được lưu để tiếp tục sau khi phiên kết thúc.
- Một quy trình chung cho mọi loại việc (tính năng, sửa lỗi, refactor, test); chưa có chế độ riêng cho từng loại.
- Không tự commit, push hay mở pull request trừ khi được yêu cầu.
