# Nhiệm vụ: sửa skill BA mới cho khớp với factory v2

Nói chuyện với người dùng bằng tiếng Việt. Nội dung skill viết bằng tiếng Anh, như hiện có.

## Bối cảnh

Skill BA mới đã được một session trước viết theo `/Users/macbookpro/Documents/new_factory/prompts/new-ba-session.md`, ở `/Users/macbookpro/Documents/new_factory/skills/new-ba/`. Sau đó thiết kế factory được đánh giá lại và sửa thành v2: `/Users/macbookpro/Documents/new_factory/docs/factory-design.md`. Đọc cả ba trước khi sửa: prompt cũ, skill hiện có, thiết kế v2.

Factory v2 đọc kế hoạch **thẳng từ các ticket** và chạy ticket **theo đồ thị phụ thuộc** (không chờ hết đợt). Vì vậy BA phải đổi một số chỗ dưới đây.

## Ràng buộc

- **Sửa tối thiểu** trên skill hiện có, không viết lại. Giữ những gì không bị nhắc tới bên dưới.
- SKILL.md vẫn dưới khoảng 15KB; chi tiết để trong `references/`.
- Không đổi định dạng hay ý nghĩa của những gì factory v2 không yêu cầu đổi.
- Không push hay tạo gì trên GitHub nếu chưa hỏi người dùng repo nào.
- **Không làm BA chậm thêm đáng kể.** Mọi kiểm tra mới là script, không thêm agent hay reader.

## Các thay đổi

1. **Ticket là nguồn sự thật duy nhất.** Mỗi ticket có một khối kế hoạch máy đọc được, định dạng cố định (ví dụ một khối code ```` ```factory-plan ```` chứa JSON hoặc YAML) gồm `wave`, `owns`, `uses`, `dependsOn`, `size`, `sizeReason`, `newDependencies`. Khối JSON trong epic chỉ là **bản tóm tắt** sinh ra từ các ticket.
2. **`hash` chỉ để báo thay đổi, không để chặn.** Tính bằng một script dùng chung (ví dụ `scripts/plan-hash.mjs`) trên khối kế hoạch và criteria của các ticket, sau khi chuẩn hóa (bỏ khoảng trắng hai đầu, xuống dòng LF). Factory sẽ gọi đúng script này.
3. **`dependsOn` phải chính xác từng ticket.** Chỉ ghi những ticket nó thật sự cần, không ghi "cả đợt trước". Wave chỉ để hiển thị.
4. **Luật không trùng file đổi phạm vi.** `check-batch` không chỉ kiểm trong cùng một đợt. Hai ticket bất kỳ **không có đường phụ thuộc nối với nhau** (tức có thể chạy cùng lúc) phải có Owns không trùng nhau.
5. **Owns tự gồm thư mục test của ticket.** Ví dụ `e2e/<ticket-slug>/**` và các test nằm cạnh code trong folder của ticket. Ticket nền móng cấu hình test runner để tìm được các thư mục này. `check-batch` báo lỗi nếu Owns của một ticket không có chỗ cho test của nó.
6. **Test của nền móng chỉ được assert những điều bất biến**, tức những điều ticket sau không làm thay đổi (shell hiện ra, slot tồn tại, hợp đồng đúng chữ ký). Trạng thái do tính năng quyết định (ví dụ danh sách trống) thuộc về ticket tính năng.
7. **ID criterion gắn theo ticket:** `#12/C3`. Trước khi có số issue thì dùng `#T2/C3`, rồi thay bằng số thật khi tạo issue. Template ticket yêu cầu mỗi test gắn tag ID này, để factory báo cáo theo từng criterion.
8. **Bỏ luật "mỗi criterion nằm ở đúng một ticket".** Luật đó vô nghĩa khi mỗi ticket tự đánh số C1..Cn. Thay bằng: mỗi dòng yêu cầu trong `said.md` được truy về ít nhất một criterion của một ticket, qua một bảng truy vết mà `check-batch` kiểm.
9. **Ticket nền móng bắt buộc có thêm** (thành criteria kiểm được):
   - dev server và test runner đọc `PORT`/`BASE_URL` từ biến môi trường; e2e không dùng lại server có sẵn (`reuseExistingServer: false` hoặc tương đương);
   - e2e chạy bằng Playwright CLI, có JSON reporter;
   - **registry** cho route, key lưu trữ, phím tắt và CSS scope (CSS modules hoặc tiền tố theo feature), kèm một script `check-registry` báo trùng tên;
   - ghi chú kiến trúc nói rõ: file hợp đồng chỉ được **thêm**, không sửa phần đã có sau đợt 0.
10. **Thư viện mới phải khai báo trước** trong `newDependencies` của ticket. Factory sinh lại lockfile sau khi ghép.
11. **Label:** BA gắn `review`. Factory v2 **từ chối chạy** nếu epic và mọi ticket chưa có `ready`. Báo cáo cuối của BA phải nói rõ: xem xong thì đổi `review` sang `ready` cho epic và các ticket.
12. **Dấu hiệu phân hạng:** `sizeReason` nêu những con số factory sẽ kiểm lại (số criteria, số file Owns, số route hoặc trang mới, số màn hình prototype phủ, có đụng auth/tiền/migration không). Factory chỉ nâng hạng.
13. **`check-batch` chạy độc lập và ổn định**, vì factory gọi thẳng:
    - `node check-batch.mjs --epic <n> --repo <owner/name>` đọc issue qua `gh`;
    - `--files <dir>` đọc các body file local, dùng trước khi tạo issue;
    - in JSON (danh sách lỗi, mỗi lỗi có mã, ticket, mô tả) và trả exit code khác 0 khi có lỗi.

    Giữ script ở `skills/new-ba/scripts/` và ghi CLI này vào `references/`, để session viết factory dùng đúng.

## Hoàn thành khi

- Đã sửa skill theo 13 điểm trên. Liệt kê cho người dùng từng điểm: đã sửa ở file nào, hoặc vì sao không cần sửa.
- Test của `check-batch` có thêm các bộ lỗi sau, và tất cả pass:
  - hai ticket khác đợt, không có đường phụ thuộc, trùng Owns;
  - Owns không có thư mục test;
  - ID criterion không gắn theo ticket;
  - một dòng trong `said.md` không truy được về criterion nào;
  - ticket nền móng thiếu criterion về `PORT` hoặc registry;
  - `dependsOn` trỏ tới ticket không tồn tại, hoặc phụ thuộc vòng.
- `plan-hash.mjs` cho cùng kết quả khi body chỉ khác nhau về CRLF/LF và khoảng trắng hai đầu.
- Nếu người dùng đồng ý, chạy lại BA với yêu cầu "làm app todo list" trên repo thử. Báo: số ticket, đồ thị phụ thuộc, kết quả `check-batch`, link issue.
- Báo cho người dùng những gì còn chưa làm hoặc chưa chắc.
