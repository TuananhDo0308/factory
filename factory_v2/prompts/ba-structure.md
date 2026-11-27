# Nhiệm vụ: thêm cấu trúc repo rõ ràng và lệnh check vào skill `new-ba`

Nói chuyện với người dùng bằng tiếng Việt. Nội dung skill viết bằng tiếng Anh, như hiện có.

## Bối cảnh

Skill ở `/Users/macbookpro/Documents/new_factory/skills/new-ba/` đã chạy được. Người dùng vừa duyệt thêm các luật cho **repo trống**, với mục tiêu: **nhìn một lỗi là biết ngay nó nằm ở folder nào để sửa**, mà không làm mất khả năng chạy song song. Factory (`/Users/macbookpro/Documents/new_factory/docs/factory-design.md`, bước 2 và 8) đã được cập nhật để dùng những thứ này.

Đọc `SKILL.md`, `references/slicing.md`, `references/ticket-template.md`, `references/batch-reader.md`, `references/plan.md`, `references/plan-schema.json`, `scripts/lib.mjs`, `scripts/check-batch.mjs` trước khi sửa.

## Ràng buộc

- Sửa tối thiểu. Giữ mọi thứ hiện có không bị nhắc tới bên dưới.
- **Chỉ áp dụng cho repo trống**: chưa có commit nào, hoặc chỉ có `README`, `LICENSE`, `.gitignore`, `.github/`, `docs/`, không có file code nào. BA kiểm điều này bằng script (đếm file code đã được track) và ghi kết quả vào `architecture.layout`.
- **Repo đã có code thì không sửa gì về cấu trúc**: `layout` là `"existing"`, BA theo đúng cấu trúc, cách đặt tên và nơi để test sẵn có của repo; không thêm `src/app`, `pages/`, error boundary, luật import, `CLAUDE.md` hay khuôn feature folder; không đề xuất đổi cấu trúc. Chỉ có điểm 1 (`architecture.checks`, đọc từ repo) áp dụng cho repo có sẵn.
- Không thêm agent. Kiểm tra mới là script, hoặc thêm câu hỏi cho reader cả bộ đang có.
- SKILL.md vẫn dưới khoảng 15KB. Không push gì lên GitHub.

## Các thay đổi

1. **Lệnh check trong kế hoạch.** Thêm `architecture.checks` vào plan schema: mảng `{ "name", "command" }` (ví dụ `test`, `e2e`, `lint`, `typecheck`, `build`), bắt buộc và không rỗng.
   - Repo có sẵn: BA đọc từ `package.json`, CI hoặc tài liệu của repo.
   - Repo mới: chính là các lệnh mà ticket nền móng phải làm cho chạy được, và mỗi lệnh có criterion tương ứng trong ticket nền móng.

   Factory lấy lệnh check từ đây.

2. **Cấu trúc repo trống: page ở ngoài, feature ở trong.** Thêm `architecture.layout` vào schema (`"pages-features"` cho repo trống; `"existing"` cho repo đã có code). Với `pages-features`:
   ```
   src/
     app/                  shell, router, registry, error boundary      (nền móng)
     shared/               kiểu dữ liệu, hợp đồng, UI dùng chung          (nền móng; sau đợt 0 chỉ được thêm)
     pages/<page>/
       page.tsx            khung page + các slot                          (nền móng)
       features/<feature>/ một tính năng của page này = một ticket
     features/<feature>/   tính năng nằm trên nhiều page (tìm kiếm, đăng nhập)
   e2e/<page>/<feature>/   e2e theo đúng đường dẫn
   docs/
   CLAUDE.md
   ```
   Với stack khác React, dùng cách tương đương mà stack đó làm tự nhiên. Ghi điều này vào `slicing.md`, mục "Choose the architecture (new repository)", thay cho sơ đồ hiện tại, và cập nhật ví dụ app todo theo đường dẫn mới.

3. **Khuôn của một feature folder**, mọi feature giống nhau:
   - `index.ts`: khai báo `id`, `slot`, `order`, `Component`, `routes`, `storageKeys`, `shortcuts`;
   - `ui/` component; `logic/` hàm thuần; `data/` đọc ghi dữ liệu qua hợp đồng của `shared/`;
   - test nằm cạnh code;
   - `README.md` khoảng 5 dòng: làm gì, issue số mấy, các criteria, các hợp đồng dùng.

   Owns của một slice là folder feature của nó cộng folder e2e của nó.

4. **Nền móng tạo khung cho mọi page có trong prototype**: `page.tsx`, các slot và route của từng page. Nhờ vậy mọi feature đều ở đợt 1. Page mới chỉ thành ticket riêng khi bổ sung vào một bộ đã publish.

5. **Criteria bắt buộc của ticket nền móng với `pages-features`**, thêm vào template ticket nền móng:
   - **luật import**: một feature chỉ được import từ `shared/` và `app/`, không từ feature khác; một page không import feature của page khác. Kiểm bằng lint (ESLint `no-restricted-imports` hoặc `eslint-plugin-boundaries`, hoặc tương đương), và lệnh lint nằm trong `architecture.checks`;
   - **lỗi ghi tên tính năng**: registry bọc mỗi feature trong một error boundary riêng, và có một logger dùng chung; lỗi và log đều có tiền tố `[<page>/<feature>]`. Có test chứng minh;
   - **`CLAUDE.md`** ngắn: stack, các lệnh trong `architecture.checks`, cấu trúc folder, khuôn feature folder, luật import, quy ước tên test `<page>/<feature> · C<n> · ...`, và dòng "bản đồ repo nằm ở `docs/ARCHITECTURE.md`, do factory sinh ra, không sửa tay".

6. **Kiểm bằng script, trong `check-batch`:**
   - `architecture.checks` có mặt và không rỗng;
   - với `pages-features`: Owns của mỗi slice nằm dưới `src/pages/<page>/features/<feature>/**` hoặc `src/features/<feature>/**`, cộng `e2e/**` tương ứng; slice không sở hữu `src/app/**`, `src/shared/**` hay `page.tsx`;
   - với `pages-features`: ticket nền móng sở hữu `CLAUDE.md`, `src/app/**`, và `page.tsx` của các page.

7. **Reader cả bộ hỏi thêm một câu** (`references/batch-reader.md`): ticket nền móng đã tạo khung cho **mọi** page trong prototype chưa, và mỗi slot mà slice dùng đã có trên page đó chưa.

## Hoàn thành khi

- Đã sửa 7 điểm. Liệt kê cho người dùng từng điểm: đã sửa ở file nào.
- Có test mới cho: thiếu `architecture.checks`; repo có sẵn (`existing`) không bị áp các luật của `pages-features`; slice `pages-features` sở hữu ngoài folder feature của nó; slice sở hữu `page.tsx`; nền móng `pages-features` không sở hữu `CLAUDE.md`. Fixture hợp lệ được cập nhật theo cấu trúc mới. Toàn bộ test pass (`node --test tests/`).
- Báo những gì còn chưa làm hoặc chưa chắc.
