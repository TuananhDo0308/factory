# Báo cáo chạy thử skill `new-ba`: app todo list

Ngày chạy: 2026-11-26. Yêu cầu: "làm app todo list". Repo thử: `sangtruong-rgb/new-ba-sandbox` (private).
Skill: `skills/new-ba/`. Model: Claude Opus 5.5 cho luồng chính và cả 4 agent phụ.

## 1. Tóm tắt

| Chỉ số | Kết quả |
|---|---|
| Thời gian, từ lúc bắt đầu tới khi bộ ticket lên GitHub | **1 giờ 43 phút** (13:02 → 14:45 UTC) |
| Thời gian máy thực sự làm việc | khoảng **79 phút** (trừ thời gian chờ người dùng trả lời và thời gian treo) |
| Thời gian lãng phí vì `check-prototype` chậm hoặc treo | khoảng **30 phút**; đã sửa trong skill, lần kiểm hiện tại mất khoảng 1 phút |
| Chi phí quy theo giá API | khoảng **$13.3** (luồng chính $8.8, 4 agent phụ $4.5) |
| Kết quả | 1 epic, 7 ticket, 3 đợt, 53 criterion, 23 hợp đồng, prototype 12 màn (48 ảnh) |
| `check-batch` | **pass**, cả trên thư mục local lẫn khi đọc thẳng từ GitHub; hash khớp với epic |
| Lời người dùng (`said.md`) | 11/11 dòng `kept` theo cả hai reader |
| Reviewer thiết kế | vòng 1 `fix` (1 P1, 6 P2), vòng 2 **`pass`** (mọi điểm ≥ 3) |

## 2. Thời gian

Giờ theo UTC, lấy từ transcript của session và thời điểm tạo issue trên GitHub.

| Bước của skill | Từ | Đến | Thời lượng | Ghi chú |
|---|---|---|---|---|
| 1. Hỏi yêu cầu (2 vòng) | 13:02 | 13:10 | 7 phút | khoảng 6 phút là người dùng trả lời |
| 1b. Dựng 3 hướng thiết kế, người dùng chọn | 13:10 | 13:14 | 4 phút | 3 trang HTML, 12 ảnh, trang so sánh |
| 2–7. Kiến trúc, chia lát, nền móng, đợt, viết 7 ticket | 13:14 | 13:21 | 7 phút | tra phiên bản thư viện trên npm |
| 8. Dựng prototype cả luồng, lần kiểm đầu | 13:21 | 13:41 | 20 phút | lần kiểm đầu rất chậm (hơn 25 phút cho 44 ảnh), phải dừng |
| 10. Reader lượt 1 (chạy song song) | 13:32 | 13:38 | 5,6 phút | 22 tool call |
| Sửa theo reader 1 | 13:38 | 13:41 | 3 phút | hợp đồng nền móng viết rõ hơn, `item-meta` tách đôi, T5 chuyển sang đợt 2 |
| 10. Reader lượt 2 (song song với kiểm prototype) | 13:41 | 13:47 | 5,7 phút | 10 tool call |
| Sửa theo reader 2 | 13:47 | 13:52 | 5 phút | |
| Gỡ lỗi `check-prototype` | 13:46 | 14:12 | khoảng 26 phút | lỗi `aria-current=""` trong prototype; vòng bấm lồng chưa bỏ qua nút đã chạy được |
| Treo, chờ người dùng gõ "continue" | 14:12 | 14:29 | khoảng 17 phút | máy không làm gì |
| 8. Reviewer thiết kế vòng 1, rồi sửa | 14:30 | 14:40 | 10 phút | reviewer mất 3,5 phút |
| 8. Reviewer thiết kế vòng 2, rồi sửa | 14:40 | 14:45 | 5 phút | reviewer mất 3 phút |
| 11–12. Quét secret, publish, đọc lại | 14:45:00 | 14:46:24 | 1,5 phút | 8 issue được tạo trong 29 giây |
| Thử sửa bộ (chạy publish lại) và `pull-batch` | 14:46 | 14:48 | 2 phút | |

**Thời gian chia theo loại:**

| Loại | Phút |
|---|---|
| Máy làm việc hữu ích | khoảng 49 |
| Máy chờ hoặc gỡ lỗi `check-prototype` (đã sửa) | khoảng 30 |
| Chờ người dùng trả lời câu hỏi | khoảng 7 |
| Treo, chờ người dùng gõ "continue" | khoảng 17 |
| **Tổng** | **khoảng 103** |

Nếu chạy lại với bản `check-prototype` đã sửa, và người dùng trả lời ngay, ước tính còn khoảng **55–60 phút**.

## 3. Chi phí

Token thật lấy từ transcript, tính theo giá API công bố của Claude Opus 5.5:

| Loại token | Đơn giá |
|---|---|
| Input | $4 / MTok |
| Output | $20 / MTok |
| Ghi cache, TTL 5 phút | $5 / MTok |
| Ghi cache, TTL 1 giờ | $8 / MTok |
| Đọc cache | $0.20 / MTok |

| Thành phần | Lượt gọi model | Output | Ghi cache | Đọc cache | Chi phí |
|---|---|---|---|---|---|
| Luồng chính (BA) | 58 | 139.944 | 185.665 (1h) | 22.704.490 | **$8.83** |
| Reader lượt 1 | 16 | 27.743 | 101.435 (5m) | 975.705 | $1.26 |
| Reader lượt 2 | 11 | 26.963 | 94.262 (5m) | 570.710 | $1.12 |
| Reviewer thiết kế vòng 1 | 15 | 16.653 | 110.780 (5m) | 977.008 | $1.08 |
| Reviewer thiết kế vòng 2 | 15 | 13.877 | 106.785 (5m) | 941.255 | $1.00 |
| **Tổng** | **115** | **225.180** | **598.927** | **26.169.168** | **khoảng $13.29** |

Ghi chú:
- **Đây là chi phí quy đổi theo giá API.** Nếu bạn dùng gói thuê bao Claude, số tiền thực trả khác.
- **Đọc cache chiếm khoảng một nửa chi phí luồng chính** (22,7 triệu token, khoảng $4.5). Lý do là session này mang theo toàn bộ lịch sử viết skill từ trước. Một session BA mới, chỉ chạy skill, sẽ rẻ hơn rõ rệt.
- **Không tính:** phần viết skill trước lần chạy thử, và các lệnh `npm`, Playwright chạy trên máy (không tốn token).

## 4. Kết quả

**Trên GitHub**
- Epic: https://github.com/sangtruong-rgb/new-ba-sandbox/issues/1 (label `ready`, `epic`). Body có mục tiêu, luồng người dùng, danh sách ticket theo đợt, và khối `## Plan` (JSON) cho factory.
- Prototype: nhánh `prototype/todo-v1` (gồm `index.html`, `prototype.json`, `taste.md`, 48 ảnh). Factory chép vào `docs/prototypes/todo-v1/`.

| Đợt | Issue | Ticket | Hạng | Criteria |
|---|---|---|---|---|
| 0 | #2 | Nền móng: server, DB, phiên đăng nhập, khung trang | L | 10 |
| 1 | #3 | Đăng ký, đăng nhập, đăng xuất | L | 9 |
| 1 | #4 | Thêm việc (sở hữu luật tên việc và ô hạn chót) | M | 7 |
| 1 | #5 | Đánh dấu xong và xóa | M | 6 |
| 1 | #6 | Hạn chót: nhóm theo hạn, quá hạn nổi bật | M | 7 |
| 1 | #7 | Lọc theo trạng thái, kèm số đếm | M | 6 |
| 2 | #8 | Sửa tên và hạn chót | M | 8 |

So với BA cũ, vốn chia todo thành 4 issue nối tiếp: bộ này có 5 ticket chạy song song ở đợt 1. Đường dài nhất là T1 → T3 → T5, tức 3 ticket nối tiếp.

**Các bước kiểm**

| Kiểm | Kết quả |
|---|---|
| `check-ticket` × 7 | không có lỗi; cảnh báo về số criterion ở #2 (10) và #3 (9) |
| `check-batch` | pass; cảnh báo đợt 1 có 5 ticket, factory chạy khoảng 4 cùng lúc |
| `check-prototype` | sạch: 12 màn, 1440/390, sáng/tối, bấm mọi nút, đo tương phản |
| `scan-secrets` | sạch; toàn dữ liệu mẫu, email `@example.com` |
| Đọc lại từ GitHub | 7 sub-issue, label `ready` đủ ở epic và mọi ticket, không còn `#T` |
| Sửa bộ (chạy `publish-batch` lần 2) | sửa 7 issue tại chỗ, không tạo trùng, prototype có commit mới, hash vẫn khớp |
| `pull-batch`, rồi `check-batch --dir` | cùng hash với GitHub |

**Reader và reviewer tìm ra gì**
- **Reader 1:** nền móng thiếu hợp đồng về
  - ai vẽ tiêu đề nhóm và số đếm;
  - vẽ lại danh sách mỗi phút;
  - hai vị trí của `item-meta`;
  - chỗ đặt nút hành động;
  - store có dùng chung không.

  Ngoài ra luật tên việc và ô hạn chót đang bị T3 và T5 build song song mà không chung luật. Tất cả đã sửa trong ticket và hợp đồng.
- **Reader 2:** tìm ra
  - luật 401 sẽ hiện "phiên hết" ngay lần mở trang đầu;
  - `DueFields` không khớp màn chi tiết;
  - email phân biệt hoa thường;
  - một criterion của T7 không test được trong chính build của nó;
  - breakpoint giữa 390 và 1440 chưa quyết;
  - fixture e2e thiếu trường.

  Tất cả đã sửa.
- **Reviewer thiết kế vòng 1:**
  - P1: khung chi tiết ở 390 bị vỡ;
  - P2: giờ hiện hai lần trên mỗi dòng;
  - P2: màu đỏ mang 4 nghĩa;
  - P2: lỗi không nằm dưới ô của nó;
  - P2: tiêu đề sai cho tài khoản mới.

  Đã sửa P1 và các P2.
- **Reviewer thiết kế vòng 2:** `pass`. Còn 2 việc chưa làm: thay câu khẩu hiệu ở màn đăng nhập 1440, và các chỉnh P3.

## 5. Skill đã được sửa nhờ lần chạy thử

| Vấn đề | Sửa |
|---|---|
| `check-prototype` bấm lại cùng một nút (thanh prototype, bộ lọc) trên mọi màn, rồi bấm lồng mọi nút ở màn được mở; prototype cả luồng mất hơn 25 phút | Nút cùng tên đã chứng minh chạy được thì bỏ qua, ở cả vòng chính lẫn vòng lồng. Còn khoảng 1 phút |

## 6. Còn mở

1. **Nền móng 10 criteria, T2 có 9.** Repo trống cộng auth làm nền móng nặng, vượt mức khoảng 8 của skill. Có thể tách nền móng thành 2 đợt, nhưng sẽ chậm hơn.
2. **`package.json` trong repo mới.** T1 sở hữu nó, trái với luật "không ticket nào sở hữu `package.json`". Cần thống nhất với thiết kế factory.
3. **Criterion đổi sau reader lượt 2** (theo reviewer thiết kế) chưa được reader nào đọc lại, vì skill giới hạn 2 lượt.
4. **Gợi ý bổ sung cho `slicing.md`:** một danh sách kiểm cho nền móng, gồm ai vẽ phần giao diện dùng chung, store có dùng chung không, xử lý lỗi API ở đâu. Cả hai reader đều tìm ra lỗ hổng ở đúng các chỗ này. Chưa sửa.
5. **Trang so sánh 3 hướng** được mở bằng trình duyệt trên máy, không phải Artifact như skill mô tả.
6. **Label `ready` đang gắn sẵn.** Dispatcher có thể chạy factory ngay trên repo thử.

## 7. Đề xuất giảm thời gian và chi phí

- **Chạy BA trong một session mới.** Bỏ được phần lớn chi phí đọc cache (khoảng $4.5 ở lần này).
- **Cho reader chạy song song với `check-prototype`**, như lần này đã làm. Reviewer thiết kế thì cần ảnh, nên phải chờ lần kiểm xong.
- **Bổ sung danh sách kiểm nền móng** (mục 6.4) để lượt reader đầu ít lỗi hơn. Lần này mỗi lượt reader kéo theo khoảng 5–8 phút sửa.
- **Đặt timeout hoặc báo tiến độ cho `check-prototype`**, để không có lần treo 17 phút như lần này.

## 8. Đã sửa để BA chạy nhanh hơn (2026-11-26, sau lần chạy)

| Sửa | Ở đâu | Hiệu quả |
|---|---|---|
| Reader và reviewer thiết kế chạy song song trong một vòng, sửa chung một lần; vòng 2 chỉ chạy khi vòng 1 có thay đổi, và reader vòng 2 đọc cả criterion đổi theo reviewer thiết kế | `SKILL.md` bước 10, `prototype.md` | ước tính ~10–12 phút |
| Reader chỉ liệt kê criterion `guess` / `cannot judge` (vẫn phải phân tích từng criterion) | `batch-reader.md` | ước tính ~2–3 phút mỗi vòng |
| `check-prototype` mở 6 trang cùng lúc (cả các nút trong một màn), vẫn giữ luật bỏ qua nút cùng tên đã chạy được; thêm `--only`, `--jobs`, `--timeout` (300 s), dòng `progress:` | `check-prototype.mjs` | đo trên prototype todo: 67 s → 12 s; lỗi cài thử ra 60/60 giống bản cũ, 3 lần chạy như nhau |
| Sửa hết rồi kiểm một lần; `--only` khi chỉ sửa vài màn | `prototype.md` | |
| Danh sách 9 câu hỏi trước khi viết nền móng (mục mở 6.4) | `slicing.md` | ít lỗi ở reader lượt đầu |
| Sửa file bằng Edit, không viết lại cả ticket | `SKILL.md` | ~2 phút |
| Đi thử prototype: mỗi ticket UI một luồng chính và một lỗi, không phải mọi criterion | `prototype.md` | tránh 5–10 phút |

Không làm, có chủ ý: bỏ vòng 2 khi vòng 1 có sửa, tách reader thành nhiều agent, đổi model của reader hoặc reviewer, viết nháp kiến trúc trong lúc chờ người dùng chọn hướng.
