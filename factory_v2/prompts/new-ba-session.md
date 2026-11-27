# Nhiệm vụ: viết skill BA mới cho `new_factory`

Nói chuyện với người dùng bằng tiếng Việt. Viết nội dung skill (SKILL.md, references, scripts) bằng tiếng Anh, như các skill hiện có.

## Bối cảnh

Người dùng đang xây `new_factory`, một software factory mới thay cho skill `factory` hiện tại. Factory cũ quá chậm: một app todo mất khoảng 5 tiếng, vì
- BA chia yêu cầu thành chuỗi issue nối tiếp (T1 → T2 → T3 → T4), theo tầng ("data model before the screens"),
- factory chạy từng issue một, mỗi issue lại bị planner chia thành nhiều spec nối tiếp,
- mỗi issue tốn khoảng 40 phút chi phí cố định.

Hướng mới: **BA thiết kế cả bộ ticket để chạy song song**. Factory mới nhận **cả bộ** (không phải một issue), chạy mỗi ticket là một factory riêng, các ticket cùng đợt chạy song song. Factory mới **không chia ticket thành spec nữa**: mỗi ticket có tối đa khoảng 8 criteria, một implementer làm.

Một session khác đang thiết kế factory mới. Phần của bạn chỉ là skill BA.

## Đọc trước

- Skill BA hiện tại: `/Users/macbookpro/Documents/ConverReplay/factory/claude/ba-ticket/` (SKILL.md, `references/`, `scripts/check-ticket.mjs`, `check-prototype.mjs`, `publish-prototype.sh`). Giữ lại những gì vẫn đúng: cách hỏi, template ticket, cách viết criteria, kiểm prototype, cách tạo issue bằng file body.
- Planner cũ (để thấy cách chia spec theo file ownership): `~/.sf/skills-repo/claude/factory/roles/planner.md`.
- Load skill `writing-for-agents` trước khi viết SKILL.md.

## Ràng buộc

- **Không sửa** `ba-ticket`, `factory` hay bất kỳ skill hiện có nào. Viết skill mới ở `/Users/macbookpro/Documents/new_factory/skills/new-ba/`. Tên `new-ba` là tạm, có thể hỏi người dùng để đổi.
- Giữ SKILL.md gọn, dưới khoảng 15KB. Factory cũ có brief 47KB và nhiều role 10KB+, đó là một sai lầm. Phần chi tiết để trong `references/`, đọc khi cần.
- Việc nào làm chắc chắn được bằng code thì viết thành script (kiểm ticket, kiểm cả bộ, tạo issue). Không giao cho agent.
- Không push hay tạo gì trên GitHub khi test nếu người dùng chưa chỉ định repo thử nghiệm.

## Flow đã được người dùng duyệt

**Input:** một yêu cầu viết tự do, hoặc các issue có sẵn.
**Output:** bộ ticket chia theo đợt, đã nằm trên GitHub, kèm file kế hoạch.

1. **Hiểu yêu cầu** (như BA cũ): hỏi dồn cho tới khi cụ thể, hỏi về prototype. **Mới:** chọn hướng thiết kế ở bước này (xem mục Prototype).
2. **Đọc hoặc chọn kiến trúc.**
   - Repo có sẵn: vẽ bản đồ module, tìm file nóng (routes, store, schema, `App`, config) và các điểm mở rộng.
   - Repo mới: chọn bộ khung, mặc định mỗi tính năng một folder, có registry tự nạp các folder.
   - Kết quả: ghi chú kiến trúc ngắn, gồm danh sách file chung và các điểm mở rộng.
3. **Liệt kê các lát tính năng.** Mỗi lát là một hành vi người dùng làm được từ đầu đến cuối, tối đa khoảng 8 criteria. Chia theo hành vi, không chia theo tầng.
4. **Gán Owns** cho mỗi lát (folder hoặc file nó sở hữu), và ghi những file chung nó buộc phải đụng.
5. **Tách nền móng (đợt 0).** Phần nào trong file chung mà từ hai lát trở lên cùng cần sửa thì kéo vào ticket nền móng: kiểu dữ liệu, interface, slot, registry, test/e2e setup, design tokens. Mặc định **1 ticket nền móng, chạy 1 lần**. Chỉ được chia nền móng khi có các phần thật sự tách rời (ví dụ schema backend và shell frontend) và `check-batch` xác nhận không trùng file. Nền móng không chứa logic tính năng. Vượt quá khoảng 8 criteria nghĩa là đang nhét tính năng vào nền.
6. **Xếp đợt.**
   - Lát nào cần dùng hành vi của lát khác thì sang đợt sau, hoặc gộp với lát đó.
   - Lát nào vẫn trùng file với lát khác thì **gộp lại**, không xếp hàng.
   - Tối đa 3 đợt. Nhiều hơn thì ghi rõ trong báo cáo rằng code quá dính chặt.
7. **Viết ticket theo template mới:** Objective, Acceptance criteria `C1..Cn`, Out of scope, **Wave**, **Owns**, **Uses** (hợp đồng lấy từ nền móng), **Depends on** (chỉ trỏ về đợt trước). Ticket nền móng có criteria kỹ thuật nhưng kiểm được: app khởi động, shell hiện ra, test chạy, interface đúng như mô tả.
8. **Prototype:** vẽ cho cả luồng. Mỗi ticket chỉ tới phần màn hình của mình. Các lát dùng chung một màn hình thì mỗi lát lấp một slot. Chất lượng phải nâng lên rõ rệt (xem mục Prototype).
9. **Kiểm bằng script:**
   - `check-ticket` cho từng ticket.
   - **`check-batch` (mới)** cho cả bộ: không có hai ticket cùng đợt chung file trong Owns; Depends on chỉ trỏ về đợt trước; mỗi criterion nằm ở đúng một ticket; không quá 3 đợt; file kế hoạch đúng định dạng.
10. **Một reader độc lập cho cả bộ**, là agent mới, không phải fork. Nó trả lời ba câu:
    - Mỗi ticket có đủ thông tin để build mà không phải đoán không?
    - Hai ticket cùng đợt có build được mà không cần biết về nhau không?
    - Nền móng đã có đủ hợp đồng chưa?

    Sửa ticket theo những gì nó báo. Tối đa 2 lượt reader.
11. **Không có bước duyệt trước khi tạo.**
    - Quét secret và dữ liệu thật trong prototype bằng script.
    - Push lên GitHub, rồi báo lại cho người dùng kèm link. Người dùng lên GitHub xem và báo nếu cần chỉnh.
    - Repo public thì ghi cảnh báo trong báo cáo.
    - BA phải hỗ trợ chạy lại để sửa bộ ticket đã tạo theo góp ý: sửa issue, giữ nguyên số criterion đã có.
12. **Tạo kết quả:**
    - Tạo epic trước, rồi các issue theo thứ tự đợt, thay `#T1..` bằng số issue thật.
    - Ghi **file kế hoạch** dưới dạng khối JSON trong body của epic, và giữ một bản local.
    - Ghi vào kế hoạch **`hash`**: mã hash của nội dung các ticket (các mục Wave, Owns, Uses, Depends on, criteria) lúc `check-batch` pass. Lần chạy BA để chỉnh sửa phải cập nhật hash. Factory so hash này: khớp thì chạy luôn; không khớp thì factory tự đọc lại ticket và chạy `check-batch` (vì vậy `check-batch` phải chạy được độc lập, đọc thẳng từ GitHub issue).
    - Ghi **`size`** (`S` | `M` | `L`) và **`sizeReason`** (một dòng) cho từng ticket, theo mục "Phân hạng ticket" bên dưới.
    - **Label (cần xác nhận với người dùng ngay đầu session):** đề xuất BA gắn `review`, người dùng tự đổi sang `ready` sau khi xem, để dispatcher không tự chạy factory trước khi người dùng duyệt. Nếu người dùng muốn gắn `ready` luôn thì làm theo.

**Bỏ khỏi BA cũ:** chia theo tầng; Depends on tuyến tính; mỗi ticket một reader; bước duyệt trước khi tạo. **Nới** luật "half a ticket" cho riêng ticket nền móng.

## File kế hoạch (giao diện duy nhất giữa BA và factory mới)

Định dạng khởi điểm, có thể bổ sung trường nhưng phải giữ cấu trúc:

```json
{
  "id": "todo-v1",
  "epic": 10,
  "architecture": {
    "shared": ["src/App.tsx", "src/tasks/types.ts"],
    "extensionPoint": "src/features/*/index.ts",
    "contracts": [{ "name": "TaskRepo", "file": "src/tasks/repo.ts", "summary": "..." }]
  },
  "waves": [
    { "wave": 0, "tickets": [{ "issue": 11, "owns": ["src/App.tsx", "src/tasks/**", "e2e/setup.ts"], "criteria": ["C1", "C2"] }] },
    { "wave": 1, "tickets": [
      { "issue": 12, "owns": ["src/features/add-task/**"], "uses": ["TaskRepo", "slot:input"], "dependsOn": [11] },
      { "issue": 13, "owns": ["src/features/toggle-done/**"], "uses": ["TaskRepo", "slot:item-action"], "dependsOn": [11] }
    ]}
  ]
}
```

Mỗi ticket có thêm `"size": "M", "sizeReason": "..."`, và ở cấp gốc có `"hash": "sha256:..."`.

Viết JSON Schema cho file này trong `references/`, để `check-batch` và factory mới cùng dùng một schema.

## Phân hạng ticket

Factory mới chạy mỗi hạng một kiểu. BA ghi hạng; factory kiểm lại bằng script và chỉ được nâng hạng, không hạ.

- **S:** đổi chữ, config, bug nhỏ, ≤3 criteria, không có màn hình mới, không đụng auth/tiền/migration. Factory chạy 1 agent làm tất cả, không có reviewer.
- **M:** tính năng bình thường. Đây là mặc định.
- **L:** màn hình mới phức tạp, nhiều criteria, hoặc **đụng auth/tiền/migration/security** dù nhỏ. Rủi ro nâng hạng: hạng lấy theo cái cao hơn giữa độ lớn và rủi ro.

Ticket L phải hiếm. Nếu nhiều ticket ra L vì độ lớn (không phải vì rủi ro) thì chia nhỏ hơn.

## Prototype

Người dùng thấy prototype hiện tại "generic, quá AI, chưa đủ wow". **Trước khi viết phần này, hỏi người dùng hai thứ:** một prototype cũ họ thấy chưa đạt, và vài sản phẩm hoặc trang họ thấy "wow". Hướng đã bàn:

- Chọn hướng thiết kế ở bước 1: người dùng đưa ảnh tham khảo, hoặc BA dựng 2–3 hướng thật sự khác nhau dưới dạng ảnh nhỏ để chọn.
- Có danh sách cấm các mặc định generic (font Inter/system mặc định, gradient tím, card bo góc giống nhau, bố cục căn giữa, emoji làm icon, chữ lorem). Lưu theo từng dự án; tham khảo file "taste" của skill `ui-refine-loop`.
- Dùng nội dung thật hoặc sát thật.
- Một reviewer thiết kế độc lập xem ảnh chụp ở 1440 và 390, cả sáng và tối, rồi bắt sửa, tối đa 1–2 vòng.

## Hoàn thành khi

- Có skill ở `/Users/macbookpro/Documents/new_factory/skills/new-ba/` gồm SKILL.md, references (template ticket mới, brief reader cả bộ, schema file kế hoạch, hướng dẫn prototype) và scripts (`check-ticket`, `check-batch`, quét secret, tạo issue và epic).
- `check-batch` có test: một bộ hợp lệ, và các bộ lỗi (trùng Owns cùng đợt, phụ thuộc trỏ về đợt sau, criterion nằm ở hai ticket, 4 đợt).
- Chạy thử một lần với yêu cầu "làm app todo list" trên một repo thử. Hỏi người dùng repo nào trước khi push. Báo lại: số ticket, số đợt, kết quả check-batch, nhận xét của reader, link issue.
- Báo cho người dùng những gì còn chưa làm hoặc chưa chắc.
