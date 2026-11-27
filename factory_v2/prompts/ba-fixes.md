# Nhiệm vụ: sửa 5 chỗ còn thiếu trong skill `new-ba`

Nói chuyện với người dùng bằng tiếng Việt. Nội dung skill viết bằng tiếng Anh, như hiện có.

## Bối cảnh

Skill ở `/Users/macbookpro/Documents/new_factory/skills/new-ba/` đã xong và chạy được (15/15 test pass). Nó đã khớp gần hết với thiết kế factory v2 (`/Users/macbookpro/Documents/new_factory/docs/factory-design.md`): ticket là nguồn sự thật, hash chỉ để báo, kiểm trùng Owns giữa các ticket không phụ thuộc nhau, phân hạng, CLI `check-batch`. **Giữ nguyên tất cả những thứ đó**, kể cả cách đánh số criterion xuyên suốt cả bộ và label mặc định `ready`.

Đọc `SKILL.md`, `references/slicing.md`, `references/ticket-template.md`, `references/plan.md`, `references/plan-schema.json`, `scripts/lib.mjs`, `scripts/check-batch.mjs` và các bước 2, 4, 5 của file thiết kế factory trước khi sửa.

## Ràng buộc

- Sửa tối thiểu, chỉ 5 điểm dưới đây. Không viết lại, không đổi định dạng hiện có ngoài những gì được nêu.
- Không thêm agent hay reader. Mọi kiểm tra mới là script.
- SKILL.md vẫn dưới khoảng 15KB.
- Không push gì lên GitHub.

## 5 điểm cần sửa

1. **Khai báo thư viện mới (bắt buộc).** Factory v2 gom thư viện của mọi ticket rồi cài một lần trước khi build. Implementer không được tự `add`, và `package.json` không thuộc Owns của ai.
   - Thêm mục **New dependencies** vào template ticket (`tên@phiên bản`, mỗi dòng một thư viện, hoặc `none`).
   - `lib.mjs` đọc mục này; plan schema thêm trường `newDependencies` (mảng chuỗi) cho mỗi ticket; đưa trường này vào hash.
   - `check-batch` báo lỗi khi hai ticket khai báo cùng một thư viện với phiên bản khác nhau.

2. **Ticket nền móng phải có hạ tầng để chạy song song (bắt buộc).** Factory chạy khoảng 4 worktree cùng lúc, mỗi cái một port, và kiểm điều này ngay ở bước chuẩn bị. Thêm vào phần nền móng của `slicing.md` và template ticket nền móng những criterion sau, áp dụng khi dự án có dev server hoặc e2e:
   - dev server và e2e đọc `PORT` và `BASE_URL` từ biến môi trường;
   - e2e luôn tự khởi động server của nó, không dùng lại server đang chạy (`reuseExistingServer: false` hoặc tương đương);
   - e2e chạy bằng Playwright CLI và ghi kết quả bằng JSON reporter;
   - CSS được scope theo từng feature (CSS modules hoặc tiền tố theo feature), không có CSS global ngoài phần của nền móng;
   - **mỗi feature tự khai báo** route, key lưu trữ và phím tắt của nó trong chính folder của nó (ví dụ trong `index.ts`). Registry của nền móng gom các khai báo này và **báo lỗi khi trùng tên**, kèm một test của nền móng chứng minh điều đó. Như vậy không slice nào phải sửa file chung để đăng ký tên, và trùng tên sau khi ghép sẽ lộ ra qua chính test đó.

   `check-batch` báo lỗi (`problem:`) khi batch có e2e mà không criterion nào của nền móng nhắc tới `PORT`.

3. **File hợp đồng chỉ được thêm (bắt buộc).** Ghi vào `slicing.md` và `plan.md`: sau đợt 0, file hợp đồng chỉ được **thêm** mới, không được sửa phần đã có. Factory dựa vào luật này khi một ticket cần nới Owns vào file hợp đồng.

4. **Test của nền móng chỉ assert những điều bất biến (nên sửa).** Thêm một dòng vào phần nền móng của `slicing.md` và câu hỏi thứ ba của `references/batch-reader.md`: test của nền móng chỉ kiểm những điều ticket sau không làm thay đổi (shell hiện ra, slot tồn tại, hợp đồng đúng chữ ký). Trạng thái do tính năng quyết định (ví dụ danh sách trống, nội dung một slot) thuộc về ticket tính năng. Nếu không, ticket đợt sau làm hỏng test của một ticket đã merge.

5. **Owns phải có chỗ cho test (nên sửa).** `check-batch` báo lỗi khi Owns của một ticket không có chỗ cho test của nó: không có glob folder (`dir/**`), không có file test, không có đường dẫn `e2e/`. Nếu không, ticket đó sẽ dừng ở bước kiểm Owns của factory rồi mất một vòng sửa.

## Hoàn thành khi

- Đã sửa 5 điểm. Liệt kê cho người dùng từng điểm: đã sửa ở file nào.
- Có test mới cho: phiên bản thư viện mâu thuẫn; nền móng thiếu criterion `PORT` khi có e2e; Owns không có chỗ cho test. Có thêm một fixture hợp lệ có `New dependencies`. Toàn bộ test pass (`node --test tests/`).
- Báo những gì còn chưa làm hoặc chưa chắc.
