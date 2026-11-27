# So sánh pipeline cũ và pipeline mới: app todo list

Ngày: 2026-11-26. Cả hai lần đều làm một app todo list từ một repo trống, bằng Claude. Giờ trong file theo UTC.

## 0. Tóm tắt

| | Pipeline cũ (`ba-ticket` + `factory` trên Workflow) | Pipeline mới (`new-ba` + `new-factory` trên Node) |
|---|---|---|
| **Cả pipeline (BA + chuẩn bị + factory)** | **230 phút** (BA 68, init 9, factory 153) | **142 phút** (BA 103, factory 39) |
| Phạm vi được giao | 3/5 issue, 31 criteria. App chạy trong trình duyệt, lưu localStorage | **7/7 ticket, 53 criteria**. App có server, cơ sở dữ liệu SQLite, tài khoản và đăng nhập |
| Thời gian factory (wall clock) | **153 phút** (2 giờ 33 phút), dừng tay ở issue thứ 4 | **37,3 phút** (thêm 1,7 phút của lần chạy đầu dừng vì lỗi factory) |
| Thời gian trên mỗi criterion đã giao | cả pipeline 7,4 phút; factory 4,9 phút | cả pipeline **2,7 phút**; factory **0,7 phút** |
| Số agent | 79 (31 trong đó là agent "record" chỉ để ghi tiến độ) | **23**, không có agent nào làm việc của code |
| Người phải can thiệp | 4 lần ("tiếp tục" ×3, "stop" ×1), 2 lần kill tay lệnh check bị treo | 0 lần trong lần chạy chính |
| Chi phí | không đo được (Workflow không ghi chi phí) | factory **$13,82**; cả pipeline khoảng **$27,1** (BA $13,3), giá API |
| Ước tính để giao đủ bộ | cả pipeline khoảng 5,5 tiếng (thêm 2 issue, mỗi issue khoảng 50 phút) | đã giao đủ: 142 phút cả pipeline |

Hai lần không cùng một bộ yêu cầu: bộ mới **lớn hơn và khó hơn** (53 so với 31 criteria đã giao, thêm server, cơ sở dữ liệu và đăng nhập). Vì vậy số so sánh công bằng nhất là thời gian trên mỗi criterion.

## 0b. Toàn bộ pipeline: BA và factory

| Bước | Pipeline cũ | Pipeline mới |
|---|---|---|
| BA | 68 phút (08:04 → 09:13): 5 issue nối tiếp; chờ người trả lời khoảng 8 phút | 103 phút (13:02 → 14:45): 1 epic, 7 ticket chia 3 đợt, 53 criteria, 23 hợp đồng, prototype 12 màn |
| Chuẩn bị repo | 9 phút (`factory init`) | không có bước riêng (nền móng #2 làm trong factory) |
| Factory | 153 phút, dừng ở issue thứ 4 | 39 phút (37,3 + 1,7 của lần chạy đầu dừng vì lỗi factory) |
| **Tổng các bước** | **230 phút** | **142 phút** |
| Wall clock từ đầu đến cuối | 236 phút (08:04:53 → 12:00:37) | 160 phút (13:02 → 15:42), gồm khoảng 10 phút trước khi bật factory và 7,5 phút sửa lỗi factory |
| Phút trên mỗi criterion | 7,4 | 2,7 |

BA mới chậm hơn BA cũ ở lần thử đầu (103 so với 68 phút). BA mới làm nhiều việc hơn: chia đợt, viết hợp đồng, dựng prototype 12 màn, hai lượt người đọc độc lập và hai vòng reviewer thiết kế. Trong 103 phút chỉ khoảng 49 phút là máy làm việc hữu ích: khoảng 30 phút mất vì script kiểm prototype chậm và treo (đã sửa), 17 phút treo chờ người gõ "continue", 7 phút người trả lời câu hỏi. Sau khi sửa, BA mới ước tính còn 55–60 phút, và cả pipeline khoảng 95–100 phút. Tính cả pipeline thì BA giờ là bước lớn nhất.

## 1. Hai lần chạy

| | Lần cũ | Lần mới |
|---|---|---|
| Repo | `sangtruong-rgb/todolist_claude_run1` | `sangtruong-rgb/new-ba-sandbox` |
| BA | `/ba-ticket`, 68 phút, ra 5 issue nối tiếp | `new-ba`, 103 phút wall clock (khoảng 49 phút máy làm việc hữu ích), ra 1 epic, 7 ticket chia 3 đợt, prototype 12 màn |
| Chuẩn bị repo | `factory init`, 9 phút (PR #6) | Không có bước riêng: ticket nền móng #2 dựng repo trong bộ |
| Factory | 3 lần Workflow, mỗi issue một lần, chạy nối tiếp | Một chương trình Node, chạy song song theo đồ thị phụ thuộc |
| Nguồn số liệu | Transcript của phiên Claude Code, 4 file kết quả Workflow, PR và issue trên GitHub | `state.json`, `run.log`, log của từng agent, `report.md` |

Phần BA không nằm trong phạm vi so sánh chính của file này. BA mới chậm hơn ở lần thử đầu vì thêm prototype và người đọc độc lập; xem `docs/ba-test-run-todo-v1.md`. Với các lỗi đã sửa, BA mới ước tính còn 55–60 phút.

## 2. Pipeline cũ: số liệu

### 2.1 Dòng thời gian của factory

| Giờ | Sự kiện |
|---|---|
| 09:27:39 | Người dùng: "dùng factory chạy tuần tự các issue trên github" |
| 09:31, 09:33 | Hai lần gọi Workflow lỗi (`scriptPath` không hợp lệ), mất 8 phút trước khi chạy được |
| 09:35:16 | Workflow issue #1 bắt đầu; sau đó phải resume lúc 10:03 |
| 10:06 | Người dùng phải gõ "ok, tiếp tục đi" |
| 10:11:22 | PR #7 (issue #1) merge |
| 10:14:38 | Workflow issue #2 bắt đầu; xong khoảng 10:41 |
| 10:16 | Người dùng gõ "ok, tiếp tục đi" |
| 10:51:51 | Lệnh chạy check do phiên chính tự chạy bị treo, phải kill tay (`TaskStop`) |
| 10:55:15 | PR #8 (issue #2) merge |
| 11:04–11:05 | Phiên dừng, người dùng gõ "oke roi", "continue" |
| 11:07:40 | Workflow issue #3 bắt đầu; xong khoảng 11:46, có một vòng làm lại sau QC |
| 11:56:03 | Lệnh check lại bị treo, kill tay |
| 11:58:17 | PR #9 (issue #3) merge |
| 11:59:59 | Workflow issue #4 bắt đầu |
| 12:00:15 | Người dùng: "stop factory". Issue #4 và #5 không được làm |

### 2.2 Từng issue

| Issue | Criteria | Từ lần merge trước đến lần merge này | Trong Workflow | Ngoài Workflow (dựng contract, PR, chờ, check treo) | Agent |
|---|---|---|---|---|---|
| #1 thêm việc, đánh dấu xong, lưu | 11 | 43,7 phút | khoảng 34 phút (có stop rồi resume) | khoảng 10 phút | 18 trở lên (phần resume) |
| #2 sửa, xoá, hoàn tác | 12 | 43,9 phút | 26,8 phút | khoảng 17 phút | 22 |
| #3 lọc, đếm, xoá việc đã xong | 8 | 63,0 phút | 37,9 phút | khoảng 25 phút | 37 |
| #4, #5 | 8 + ? | không làm | | | 2 |

### 2.3 Bên trong một issue (#2 và #3, có đủ số liệu từng agent)

Thời gian các pha, tính từ đầu Workflow:

| Pha | Issue #2 | Issue #3 |
|---|---|---|
| Spec (planner chia issue thành spec) | 0 → 12,3 phút | 0 → 17,3 phút |
| Build (implementer test trước, QA từng spec) | 12,3 → 19,5 | 17,3 → 32,0 |
| Check (checker agent chạy check) | 19,5 → 20,1 | 23,0 → 32,7 |
| Review (reviewer, review từng spec, QC) | 20,1 → 26,8 | 23,7 → 37,9 (có vòng 2 sau QC) |

Agent theo vai:

| Vai | Issue #2 | Issue #3 | Ghi chú |
|---|---|---|---|
| planner (fable) | 1, 12,3 phút | 1, 17,3 phút | Một agent chiếm gần nửa thời gian Workflow |
| record (haiku) | 9 | 14 | Chỉ để ghi tiến độ ra dashboard, vì Workflow không ghi được file |
| build (sonnet) | 3 | 3 + 2 rebuild (opus) | Spec chia theo tầng, chạy nối tiếp: "S1 → S2 → S3" |
| qa (sonnet) | 3 | 5 | Mỗi spec một QA |
| checker (sonnet) | 1 | 2 | Một agent để chạy lệnh check |
| reviewer (opus) | 1, 6,1 phút | 2, 9,5 phút | Review toàn thay đổi |
| review từng spec (sonnet) | 3 | 6 | Thêm một lớp review theo spec |
| qc (sonnet) | 1, 6,2 phút | 2, 9,2 phút | Bấm tay qua Playwright MCP |
| **Tổng** | **22** | **37** | |

Mỗi criterion của issue #2 qua tay khoảng 4–5 người chấm: QA của spec, review của spec, reviewer chung, checker và QC.

## 3. Vấn đề của pipeline cũ

| # | Vấn đề | Bằng chứng | Chi phí thời gian |
|---|---|---|---|
| P1 | **Issue chạy nối tiếp.** BA chia theo issue, factory làm từng issue một | 3 issue nối nhau, 44–63 phút mỗi issue | Tổng thời gian bằng tổng các issue |
| P2 | **Chi phí cố định mỗi issue lớn.** Mỗi issue có planner, dựng contract, PR và CI riêng | Planner 12–17 phút; ngoài Workflow 10–25 phút mỗi issue | Khoảng 25–40 phút mỗi issue trước khi tính đến code |
| P3 | **Planner chia spec theo tầng, nên spec chạy nối tiếp** | Log: "2 spec(s) in 2 build level(s): S1 → S2", "nothing runs in parallel" | Build 7–15 phút, không song song |
| P4 | **Quá nhiều người chấm cho mỗi criterion** | 4–5 agent chấm mỗi criterion; pha Review 7–14 phút | Review chiếm khoảng 25–35% Workflow |
| P5 | **Dùng agent cho việc của code** (Workflow không đọc ghi file, không chạy được lệnh) | 31 agent record, 3 agent checker; 40% số agent chỉ để ghi tiến độ | Mỗi agent tốn từ vài chục giây đến vài phút |
| P6 | **QC bấm tay qua MCP ở mỗi issue** | QC 6–9 phút mỗi issue, lặp lại 3 lần | Khoảng 20 phút cho 3 issue |
| P7 | **Kẹt và cần người** | Lệnh check treo, phải kill tay 2 lần; 3 lần chờ người gõ "tiếp tục"; 2 lần gọi Workflow lỗi | Khoảng 10–25 phút mỗi issue ngoài Workflow |
| P8 | **Một vòng sửa làm lại cả chuỗi review** | Issue #3: QC fail, 2 rebuild (opus), rồi QA, checker, reviewer, 3 review spec và QC chạy lại | Vòng 2 của #3 mất khoảng 14 phút |
| P9 | **Không chạy lại được giữa chừng** | Issue #1 phải resume; người dùng dừng ở issue #4, issue #4 và #5 bỏ dở | Mất phần chưa xong |

Một ghi nhận đáng chú ý: số vòng sửa ở pipeline cũ gần như bằng 0 (chỉ issue #3 có một vòng). Pipeline cũ **chậm vì quy trình, không phải vì code sai**.

## 4. Pipeline mới: đề xuất cho từng vấn đề

| Vấn đề | Giải pháp trong pipeline mới |
|---|---|
| P1 issue nối tiếp | BA chia theo **lát tính năng** cộng một **ticket nền móng** giữ hợp đồng chung. Factory chạy theo **đồ thị phụ thuộc**: ticket nào có đủ ticket phụ thuộc đã merge thì chạy ngay, tối đa 4 ticket cùng lúc, mỗi ticket trong worktree và `PORT` riêng |
| P2 chi phí cố định mỗi issue | Không có planner, không chia ticket thành spec. Chuẩn bị (thư viện, prototype) làm **một lần cho cả bộ**. Không có PR: merge thẳng vào `staging` bằng code |
| P3 spec theo tầng | Mỗi ticket có **một implementer** làm trọn lát của nó |
| P4 nhiều người chấm | Check bằng code cộng **một reviewer tùy hạng** (S: không reviewer; M: 1; L: 1 opus kèm security). QC **một lần** ở cuối bộ |
| P5 agent làm việc của code | Bộ điều phối là chương trình Node: git, chạy check, kiểm Owns, kiểm mỗi criterion có test gắn ID, merge, dashboard, báo cáo đều là code |
| P6 QC mỗi issue | e2e theo criterion (Playwright CLI, report JSON) thay cho phần lớn việc bấm tay. Một QC agent ở cuối chỉ smoke các luồng chính và kiểm những criterion không có e2e |
| P7 kẹt, cần người | Không timeout, nhưng có watchdog: 30 phút không tiến triển thì báo động kèm lý do; lệnh treo (dev server, chế độ watch) bị kill theo PID trong cây process của agent. Không có bước nào chờ người, trừ `needs-decision` |
| P8 vòng sửa làm lại tất cả | Vòng sửa chỉ chạy lại check và reviewer của ticket đó. QC chỉ kiểm lại những criterion đã fail. Tối đa 4 vòng mỗi ticket |
| P9 không chạy lại được | Toàn bộ trạng thái nằm trong `state.json`, ghi atomic. Chạy lại đúng lệnh cũ thì đi tiếp từ bước dở, không làm hai lần |

## 5. Pipeline mới: số liệu lần chạy

### 5.1 Từng bước

| Bước | Giờ | Thời gian | Ghi chú |
|---|---|---|---|
| Đọc và kiểm kế hoạch | | 13 s | Gọi thẳng `check-batch` của BA |
| Chuẩn bị | | 10 s | 21 thư viện và prototype trong một commit, cài một lần |
| Nền móng #2 (L) | 15:04:44 → 15:18:07 | **13,4 phút** | Implementer opus 11,4 phút, check vài giây, reviewer opus 1,8 phút |
| Check sau khi ghép #2 | | 8 s | Có 5 ticket đang chờ #2 nên mới chạy |
| Đợt 1: #3 (L), #4–#7 (M) song song | 15:18 → 15:29 | **11,1 phút** | Các ticket M xong trong 2–3 phút; #3 là ticket dài nhất |
| #8 (M, phụ thuộc #4) | 15:21 → 15:26 | 4,7 phút | Chạy ngay khi #4 merge, chồng lên đợt 1 |
| Check đầy đủ trên `staging` (lần 1) | 15:29 | 20 s | e2e fail sau khi ghép #3 |
| Chia đôi tìm thủ phạm | | 13 s | Chỉ đúng #3; test fail thuộc #2 và #7 |
| #3 sửa | 15:29 → 15:39 | 9,4 phút | Implementer opus 8,5 phút |
| Check đầy đủ (lần 2) và QC | 15:39 → 15:42 | 8 s + 2,6 phút | QC smoke 6 luồng, kiểm tay 8 criteria không có e2e |
| **Tổng** | | **37,3 phút** | |

### 5.2 Từng ticket so với mục tiêu theo hạng

| Ticket | Hạng | Thời gian | Mục tiêu | Vòng sửa |
|---|---|---|---|---|
| #2 nền móng | L | 13,4 phút | khoảng 30 | 1 (chạy lại vì lỗi factory) |
| #3 đăng ký, đăng nhập, đăng xuất | L | 11,1 phút đến lần merge đầu; 20,9 phút tính cả lần sửa | khoảng 30 | 2 |
| #4 thêm việc | M | 2,7 phút | 15–20 | 0 |
| #5 xong và xoá | M | 1,8 phút | 15–20 | 0 |
| #6 hạn chót | M | 2,4 phút | 15–20 | 0 |
| #7 lọc | M | 2,0 phút | 15–20 | 0 |
| #8 sửa việc | M | 4,7 phút | 15–20 | 1 |

### 5.3 Agent và chi phí

| Vai | Số lần gọi | Thời gian agent | Chi phí |
|---|---|---|---|
| implementer | 11 | 38,4 phút | $9,17 |
| reviewer | 10 | 8,9 phút | $3,95 |
| diagnoser | 1 | 19 s | $0,09 |
| qc | 1 | 2,6 phút | $0,61 |
| **Tổng** | **23** | | **$13,82** |

Kết quả: check đầy đủ pass; e2e pass 45 criteria; QC pass cả 53 criteria và 6 luồng chính; không ticket nào `needs-decision`.

## 6. Pipeline mới có giải quyết được vấn đề không

| Vấn đề | Kết quả đo ở lần chạy mới | Giải quyết? |
|---|---|---|
| P1 issue nối tiếp | 5 ticket chạy song song sau nền móng; #8 chạy ngay khi #4 merge, không chờ hết đợt | **Có** |
| P2 chi phí cố định mỗi issue | Chuẩn bị 10 s cho cả bộ; không có planner hay PR; ticket M từ lúc bắt đầu đến lúc merge 2–5 phút | **Có** |
| P3 spec theo tầng | Một implementer mỗi ticket; không có chuỗi S1 → S2 | **Có** |
| P4 nhiều người chấm | Một reviewer mỗi ticket, khoảng 0,5–2 phút; vẫn bắt được 2 lỗi thật (#8 C50, #3) | **Có**, và vẫn giữ được chất lượng |
| P5 agent làm việc của code | 0 agent record hay checker; check bằng code mất vài giây (62 unit test và 72 e2e dưới 15 s) | **Có** |
| P6 QC mỗi issue | Một QC duy nhất, 2,6 phút, cho cả 53 criteria | **Có** |
| P7 kẹt, cần người | Không bước nào chờ người; không lệnh nào treo; lệnh nguy hiểm (`pkill`) bị chặn bằng quyền | **Có** ở lần này (watchdog chưa phải ra tay) |
| P8 vòng sửa làm lại tất cả | Vòng sửa của #3 sau check cuối: chỉ implementer và reviewer của #3, rồi check cuối và QC (chỉ criteria còn thiếu) | **Có** |
| P9 không chạy lại được | Lần chạy đầu dừng vì lỗi factory; sửa xong, `--retry 2` đi tiếp từ `state.json`, không làm lại bước nào | **Có** |

### Thời gian giờ nằm ở đâu

Sau khi bỏ các chi phí quy trình, thời gian còn lại dồn vào **chuỗi nối tiếp chạy bằng opus**: nền móng (11,4 phút), #3 (6,5 phút), #3 sửa (8,5 phút). Ba agent này chiếm khoảng 26/37 phút. Opus cũng chiếm khoảng $9,2/$13,8.

## 7. Vấn đề mới phát hiện ở lần chạy mới

| # | Vấn đề | Tác động | Trạng thái |
|---|---|---|---|
| N1 | Brief chỉ đưa hợp đồng ticket **dùng**, không đưa hợp đồng ticket **cung cấp**; nền móng nhận "none" nên tự dừng | 1,7 phút và phải chạy lại | **Đã sửa**, có test |
| N2 | Brief ghi "`package.json` không phải của bạn" cả khi ticket sở hữu nó | Nền móng có thể không tạo được script | **Đã sửa** |
| N3 | Hợp đồng slot không ghi vòng đời (cổng đăng nhập mount muộn làm hỏng #6, #7) | Vòng sửa 9,4 phút ở cuối | **Đã sửa ở BA**: hợp đồng ghi thứ tự mount và cổng |
| N4 | Nền móng lớn là chặng nối tiếp dài nhất | 13,4 phút | **Đã sửa ở BA**: nền móng L tách thành backend và frontend chạy song song khi kiểm riêng được |
| N5 | Kiểm hai server báo động sai (hai server chung một file SQLite, câu báo lại quy cho `PORT`) | Báo động sai | **Đã sửa**: mỗi server một worktree, báo động dẫn log thật |
| N6 | Báo cáo cộng cả khoảng nghỉ giữa hai lần chạy vào tổng thời gian; không ghi lần check cuối fail | Số liệu sai | **Đã sửa** |
| N7 | Server implementer bỏ lại có thể giữ `PORT` của ticket | Có thể làm e2e fail oan (chưa xảy ra) | **Đã sửa**: tắt theo PID, chỉ process trong worktree của ticket |
| N8 | `staging` chỉ push lên GitHub khi run xong | Không theo dõi được trên GitHub | **Đã sửa**: push sau mỗi lần merge |
| N9 | `npm install` sau một lần merge có thể làm bẩn worktree `staging`, khiến lần merge sau bị đổ lỗi oan | Có thể phí 4 vòng sửa (test bắt được) | **Đã sửa**, có test |
| N10 | BA vẫn ghi implementer "viết test trước" (TDD), trong khi factory đã bỏ TDD | Lệch tài liệu | **Đã sửa** |

## 8. Quyết định và việc còn mở

- **Implementer hạng L giữ opus** (người dùng chốt). Không đổi bảng model.
- **Lệnh check lấy từ kế hoạch (đã làm).** Với repo mới chưa có gì thì không đọc được `package.json`, nên factory giờ lấy `architecture.checks` mà BA ghi trong kế hoạch. Thứ tự: `.factory/project.json` của dự án, rồi kế hoạch, rồi script trong `package.json` khi kế hoạch không có.
- **Epic #1 phải publish lại** trước khi chạy factory lần nữa: kế hoạch cũ thiếu các trường `layout` và `checks` mà BA mới bắt buộc.
- **Chưa được kiểm trên chạy thật:** watchdog, `needs-decision` thật, revert sau QC, crash rồi chạy lại, hai bộ xếp hàng. Các phần này mới có test với agent giả.
- **Lần chạy tới:** một bộ trên repo đã có code, để đo lại sau các sửa đổi N3, N4 (dự kiến rút ngắn chặng nền móng và bỏ vòng sửa ở cuối).
