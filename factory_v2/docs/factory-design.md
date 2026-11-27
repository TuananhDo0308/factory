# new_factory: thiết kế factory (bản chốt v2)

Chốt ngày 2026-11-26. v2 sửa theo bản đánh giá độc lập (12 điểm). BA mới: xem `prompts/new-ba-session.md`, và các sửa đổi cho BA ở `prompts/ba-amendments.md`.

## Vì sao viết lại

App todo mất khoảng 5 tiếng. BA chia thành 4 issue nối tiếp, mỗi issue tốn khoảng 40 phút chi phí cố định: planner chia spec theo tầng nên chạy nối tiếp; mỗi criterion có 4–5 người chấm; có recorder agent và checker agent; QC click tay qua Playwright MCP. Số vòng sửa là 0, nên chậm là do quy trình chứ không phải do sửa lỗi.

Có một nguyên nhân gốc khác: factory cũ chạy trong Workflow script, mà Workflow script **không đọc ghi file, không chạy được git hay lệnh, không có đồng hồ** (code cũ ghi: "A script cannot write files, so a small agent writes the dashboard's progress"). Vì vậy mọi việc đáng lẽ là script đều phải thành agent.

## Nguyên tắc

- Quy trình co giãn theo hạng của ticket (S/M/L) và theo số ticket trong bộ.
- BA thiết kế cách chia để chạy song song. Factory chỉ chạy kế hoạch: không cắt lại, **không chia ticket thành spec**.
- Việc làm chắc chắn được thì dùng **code thật**, không dùng agent.
- Không có ngõ cụt: lỗi nào cũng có chẩn đoán và bước tiếp theo; một ticket kẹt không chặn cả bộ.
- Chỉ dùng Claude. Không cần tương thích với Software Factory hiện tại.
- **Mỗi sửa đổi phải không làm tăng thời gian của đường chạy bình thường** (xem bảng cuối file). Chi phí thêm chỉ được phát sinh khi có lỗi.

## Kiến trúc chạy

- Skill `new_factory` (trong Claude Code) chỉ làm hai việc: khởi động bộ điều phối và báo kết quả.
- **Bộ điều phối là một chương trình Node** (`orchestrator/run.mjs`), không phải Workflow script. Nó:
  - giữ toàn bộ trạng thái trong `.factory/runs/<id>/state.json`;
  - gọi Claude cho từng bước agent bằng `claude -p` (headless, `--output-format stream-json`, chọn model theo hạng, `cwd` là worktree của ticket), ghi log từng agent ra file;
  - tự làm bằng code: git (worktree, diff, merge, revert), chạy check, kiểm test theo criterion, cấp port, báo động khi kẹt, thời gian, chi phí, dashboard, comment và label trên GitHub (`gh`).
- **Chạy lại sau crash:** chạy lại đúng lệnh cũ. Bộ điều phối đọc `state.json` và đi tiếp từ bước đầu tiên chưa xong. Mọi bước có tác dụng phụ đều kiểm trạng thái trước khi làm, để không làm hai lần (merge sha X đã ghi thì bỏ qua; comment có marker đã tồn tại thì không đăng lại).

## Input

Số epic trên GitHub. **Các ticket là nguồn sự thật duy nhất.** Kế hoạch (Owns, Uses, Depends on, Size, Wave) được đọc từ chính các ticket; khối JSON trong epic chỉ là bản tóm tắt.

## Pipeline

0. **Một bộ mỗi lúc trên `staging`.** Bộ được khởi động khi bộ khác đang chạy thì xếp hàng, và bắt đầu từ `staging` mới nhất.
1. **Đọc và kiểm kế hoạch.**
   - Epic và mọi ticket phải có label `ready`, không thì từ chối chạy và báo ticket nào chưa có.
   - Đọc các ticket từ GitHub, dựng kế hoạch, luôn chạy `check-batch` (vài giây, không tốn token). Fail thì dừng và báo đúng lỗi để người dùng sửa tay. Không bắt chạy lại BA.
   - Lưu bản chụp các ticket đã dùng vào `state.json`. Nếu khác bản BA tạo (so hash), ghi vào báo cáo "ticket #12 đã thay đổi sau BA".
2. **Chuẩn bị một lần cho cả bộ.**
   - Lấy lệnh check từ `architecture.checks` của kế hoạch (BA ghi; với repo mới đó cũng là criteria của ticket nền móng). Repo có sẵn mà kế hoạch không ghi thì đọc từ `package.json`/CI.
   - **Chưa có nhánh `staging`**: hỏi người dùng rồi tạo `staging` từ nhánh mặc định.
   - **Repo trống** (`architecture.layout` là `pages-features`; chưa có code): hỏi người dùng rồi tạo commit đầu tiên và nhánh `staging`. Repo đã có code thì factory không đổi gì về cấu trúc. Với repo trống, các bước cần app chạy được (cài thư viện, clone `node_modules`, kiểm hai server và trình duyệt) dời xuống **sau khi nền móng merge**, trước khi ticket đầu tiên của đợt 1 bắt đầu. Nền móng vốn chạy một mình nên không mất thêm thời gian.
   - **Thư viện mới:** bộ điều phối gom mọi `newDependencies` mà các ticket đã khai báo, thêm vào `package.json` trên `staging` trong một commit. Implementer không được tự chạy `add`/`install` thư viện mới.
   - **Prototype:** nếu kế hoạch có `prototype`, copy `git archive <commit>` của nhánh đó vào `path` trên `staging` một lần, trong cùng commit với thư viện mới.
   - Cài dependency **một lần** ở bản gốc. Mỗi worktree nhận bản sao `node_modules` bằng clone copy-on-write (`cp -c` trên APFS, mất vài giây) hoặc pnpm store, kèm thư mục cache riêng. Không worktree nào ghi vào `node_modules` của worktree khác.
   - **Kiểm trước cho QC:** có trình duyệt, app khởi động được, dev server và test runner đọc `PORT`/`BASE_URL` từ biến môi trường (thử khởi động hai server trên hai port khác nhau). Thiếu gì thì báo ngay, không đợi đến cuối bộ mới phát hiện.
3. **Lập lịch theo đồ thị phụ thuộc**, không chờ hết đợt.
   - Ticket nào có các ticket nó phụ thuộc đã merge thì chạy ngay. Wave chỉ dùng để hiển thị.
   - Tối đa khoảng 4 ticket cùng lúc. Mỗi ticket có worktree, `PORT` và thư mục cache riêng.
   - Ticket bắt đầu từ HEAD hiện tại của `staging`, tức đã có mọi ticket nó phụ thuộc.
   - **Gốc của mỗi ticket** là merge-base giữa nhánh của nó và `staging` (`git diff staging...<nhánh>`), không phải commit đầu bộ. Mọi so sánh ở bước 4 đều dùng gốc này, nên vẫn đúng sau khi chạy tiếp ở bước 7.
4. **Factory cho mỗi ticket:**
   - a. **Một implementer**, không planner, không spec. **Code bình thường, không TDD**, rồi viết test: mỗi criterion có ít nhất một test (unit hoặc e2e). Chỉ sửa trong Owns. Owns của mỗi ticket tự động gồm thư mục test của nó (ví dụ `e2e/<ticket>/**` và test nằm cạnh code). Mỗi test gắn ID criterion trong tên (ví dụ `C5`; ID là duy nhất trong cả bộ).
   - b. **Check bằng code** (bộ điều phối chạy, không có agent):
     - các check của dự án; e2e chạy bằng **Playwright CLI** với `PORT` riêng và không dùng lại server có sẵn;
     - diff so với Owns, lấy từ **commit** so với gốc (có xử lý xóa và đổi tên file; bỏ qua `__pycache__`, `.gitkeep` và file do check sinh ra). Sửa ngoài Owns thì đi vào 4d, loại "ticket thiếu chỗ";
     - **kiểm test theo criterion** (dưới một giây, không chạy thêm gì): mỗi criterion của ticket có ít nhất một test gắn ID của nó, và test đó có assertion thật (`expect`/`assert`). Thiếu thì trả về implementer như một lỗi bình thường;
     - `package.json` và lockfile được bỏ qua khi so Owns, nhưng chỉ với các thư viện đã khai báo. Thư viện chưa khai báo là lỗi.
     - Kill process chỉ theo PID đã ghi lại, không dùng `pkill` theo tên.
   - c. **Reviewer tùy hạng** (xem bảng). Với M và L, reviewer đọc cả test: test có kiểm đúng criterion không, có mock quá tay đến mức không kiểm gì không; test rỗng là lỗi gửi về implementer. Ticket S có diff đụng file chung (file của ticket nền móng, registry) thì tự nâng lên M.
   - d. **Sửa và leo thang.** Vòng 1–2: một implementer mới nhận danh sách lỗi. Sau 2 vòng, một agent chẩn đoán xếp lỗi vào một loại:
     - code khó: vòng 3 dùng model mạnh hơn (S → Sonnet, M → Opus, L → Opus effort cao nhất hoặc Fable), kèm bản chẩn đoán;
     - ticket thiếu chỗ: **bảng khóa** của bộ điều phối kiểm file cần sửa có ticket nào đang chạy, đang chờ, hoặc chưa merge nào giữ không. Trống thì khóa file đó, nới Owns rồi chạy vòng 3. Bị giữ thì:
       - ticket giữ file **phụ thuộc (trực tiếp hoặc gián tiếp) vào ticket đang cần**: chuyển khóa cho ticket đang cần. Không có rủi ro, vì ticket giữ file chỉ chạy sau khi ticket này đã merge;
       - ticket giữ file đang `needs-decision`: ticket đang cần cũng chuyển `needs-decision` với lý do "chờ #X", và được tính là "chưa giao";
       - còn lại: chờ ticket giữ file merge xong rồi chạy vòng 3 từ `staging` mới. Trước khi chờ, kiểm đồ thị chờ có vòng không; có vòng thì chuyển `needs-decision` ngay, không chờ mãi.

       File hợp đồng của nền móng chỉ được **thêm**, không được sửa phần đã có;
     - người chấm sai (không áp dụng cho S): chạy lại check, thêm một reviewer thứ hai độc lập để phân xử;
     - yêu cầu mâu thuẫn hoặc mơ hồ: chuyển thẳng sang `needs-decision`.

     **Giới hạn tổng:** mỗi ticket có tối đa 4 vòng sửa trên cả bộ, tính cả các vòng do check sau khi ghép hay QC gửi về. Quá giới hạn thì `needs-decision`, để không lặp mãi giữa QC và sửa.

     **`needs-decision`**, không phải fail: giữ nhánh code, comment lên issue bản chẩn đoán kèm một câu hỏi cụ thể, gắn label `needs-decision`. Phần còn lại của bộ vẫn chạy; các ticket phụ thuộc (trực tiếp hoặc gián tiếp) đứng chờ và được báo là "chưa giao".
   - e. **Không timeout. Báo động khi kẹt, kèm lý do.** Agent không bao giờ bị kill. Bộ điều phối theo dõi log stream của từng agent; 30 phút không có tiến triển thì xử lý theo lý do:
     - lệnh không thoát (dev server chạy foreground, test ở chế độ watch, lệnh chờ nhập y/n): **kill đúng process con đó** theo PID, agent nhận kết quả lỗi và làm tiếp, rồi báo động;
     - lỗi API hoặc rate limit: chờ rồi thử lại, rồi báo động;
     - lặp vòng, port hoặc tài nguyên bị khóa, không rõ: chỉ báo động.

     Báo động gồm: ticket, bước, agent, đã chạy bao lâu, lý do, đã tự xử lý gì, 20 dòng log cuối. Gửi qua push notification và một comment trên issue của ticket.
5. **Ghép bằng code thẳng vào `staging`.**
   - Ticket pass thì merge ngay bằng `--no-ff` (mỗi ticket là một merge commit, revert được bằng một lệnh). Các lần merge xếp hàng từng cái một. Dùng 3-way merge bình thường; conflict thật (hiếm, vì Owns tách nhau) đưa vào một vòng sửa.
   - File tự sinh (lockfile) không merge mà sinh lại sau khi ghép. **Không bao giờ tự sinh lại snapshot**: snapshot đổi là lỗi cần sửa. Ticket muốn thêm thư viện phải khai báo trước.
   - **Trùng tên** (route, key lưu trữ, phím tắt) lộ ra qua test của registry ở nền móng: mỗi feature tự khai báo tên của nó, registry báo lỗi khi trùng. CSS được scope theo feature. Không cần script riêng.
   - **Check sau khi ghép:** chạy một lần khi có ticket đang đợi code vừa merge (tức trước khi khởi động ticket phụ thuộc). Gồm typecheck, build, unit, e2e; bỏ lint/format. Nếu không còn ticket nào phụ thuộc thì không chạy ở đây, vì bước 6 chạy check đầy đủ trên `staging` cuối cùng.
   - **Fail sau khi ghép thì tìm thủ phạm bằng code:** chạy riêng các file test fail (nhanh), rồi chia đôi theo thứ tự merge, mỗi lần chỉ chạy những file đó. Lỗi gửi về ticket có lần merge gây ra lỗi, nêu tên cả ticket thủ phạm lẫn ticket bị ảnh hưởng. Chỉ khi không tìm được mới gửi cho ticket sở hữu file test fail.
6. **QC một lần duy nhất**, khi mọi ticket đã xong (merge hoặc `needs-decision`), trên `staging`.
   - Bắt đầu bằng **một lần check đầy đủ** trên `staging` cuối cùng: typecheck, build, unit, e2e. Đây là lần duy nhất code đã ghép của các ticket cuối được typecheck và build cùng nhau (e2e chạy qua dev server, không typecheck). Fail thì tìm thủ phạm như bước 5. Kết quả e2e báo theo **từng criterion** (ví dụ `C5`) dựa trên tag của test.
   - Một agent dùng app qua Playwright MCP để smoke các luồng chính và kiểm những criterion không có e2e.
   - Phạm vi QC chỉ gồm các ticket đã merge. Ticket `needs-decision` và các ticket phụ thuộc nó được liệt kê là "chưa giao", không bị tính là lỗi.
   - Lỗi gửi về ticket sở hữu criterion đó (sửa theo 4d). Sau khi sửa: chạy lại toàn bộ check, QC chỉ kiểm lại những criterion đã fail.
   - Ticket nào thành `needs-decision` **sau khi đã merge** thì bộ điều phối **tự revert** nó (cùng các ticket phụ thuộc đã merge) khỏi `staging`, ghi sha của commit revert vào `state.json`, rồi chạy lại check. `staging` chỉ còn code đã qua QC.
7. **Báo cáo cho người dùng**: ticket đã giao, ticket `needs-decision` kèm câu hỏi, những gì đã thay đổi sau BA. Factory không đụng tới main; người dùng tự kiểm `staging` lần cuối và tự quyết đưa lên main.
   - **Khi người dùng trả lời một ticket `needs-decision`:** chạy lại bộ điều phối cho bộ đó. Nó chạy tiếp ticket đó, rồi các ticket phụ thuộc, rồi check sau khi ghép, rồi QC cho các criterion của chúng.
     - Ticket **chưa từng merge**: merge `staging` mới nhất vào nhánh của nó rồi chạy tiếp.
     - Ticket **đã bị revert** (và các ticket phụ thuộc bị revert theo): **không** merge `staging` vào nhánh cũ, vì làm vậy sẽ áp luôn commit revert và xóa code của ticket. Thay vào đó, tạo nhánh mới từ `staging` mới nhất và chạy `git revert <sha của commit revert>` để lấy lại code, rồi chạy tiếp từ đó.
8. **Đo và báo cáo bằng code:** thời gian từng bước, chi phí, trạng thái từng ticket, dashboard. Không có recorder agent.
   - **Bản đồ repo** (chỉ với repo trống, `layout` là `pages-features`; repo đã có code thì không thêm file này): ở bước báo cáo, script sinh `docs/ARCHITECTURE.md` từ kế hoạch: bảng page → feature → folder → issue → criteria → hợp đồng dùng. Ghi vào `staging` trong một commit riêng của bộ điều phối. Không agent nào viết file này.

Bộ chỉ có 1 ticket: không có lập lịch, chạy thẳng rồi merge vào `staging`.

## Phân hạng

BA ghi `size`. Factory kiểm lại bằng code (số criteria, số file Owns, số route hoặc trang mới, số màn hình prototype phủ, auth/tiền/migration) và chỉ nâng hạng, không hạ. Hạng lấy theo cái cao hơn giữa độ lớn và rủi ro.

| | S | M (mặc định) | L |
|---|---|---|---|
| Ví dụ | Đổi chữ, config, bug nhỏ, ≤3 criteria | Tính năng bình thường | Màn hình mới phức tạp, hoặc auth/tiền/migration |
| Implementer | 1 agent làm tất cả, model nhẹ | Sonnet | Opus |
| Check bằng code | Có | Có | Có |
| Reviewer | Không (diff đụng file chung thì lên M) | 1 | 1 Opus + security review |
| QC | QC cuối | QC cuối | QC cuối |
| Mục tiêu thời gian | 5–10 phút | 15–20 phút | ~30 phút |

## Ảnh hưởng của v2 tới thời gian chạy

| Sửa đổi | Đường chạy bình thường | Chỉ khi có lỗi |
|---|---|---|
| Node điều phối thay Workflow | **Nhanh hơn**: check, diff, merge, dashboard là code, bỏ được agent | Chạy lại từ bước đang dở, không chạy lại các bước đã xong |
| Lập lịch theo đồ thị phụ thuộc | **Nhanh hơn**: không chờ cả đợt | — |
| Clone `node_modules` copy-on-write | +vài giây mỗi ticket | — |
| Kiểm trước cho QC ở bước 2 | +khoảng 1 phút một lần | Tiết kiệm cả bộ nếu thiếu trình duyệt |
| Test thuộc Owns, gắn ID criterion | 0 | Bỏ được các lần dừng sai ở 4b |
| Bỏ TDD, chỉ kiểm mỗi criterion có test có assertion | **Nhanh hơn** khoảng 1–2 phút mỗi ticket | — |
| Gom thư viện mới, cài một lần ở bước 2 | 0 | Bỏ được các vòng sửa sai vì `package.json` |
| Check đầy đủ một lần trên `staging` cuối | +1 lần check cho cả bộ | Bắt được lỗi typecheck/build mà e2e bỏ sót |
| Gốc theo từng ticket, xử lý khóa vòng, revert của revert | 0 | Không treo, không mất code |
| Trùng tên bắt bằng test của registry | 0 (nằm trong test sẵn có) | — |
| Check sau ghép chỉ khi có ticket phụ thuộc | **Ít hơn** trước | — |
| Tìm thủ phạm bằng chia đôi | 0 | Chỉ chạy lại các file test fail |
| Bảng khóa, revert, giới hạn 4 vòng | 0 | Chặn vòng lặp vô hạn |
| Kill process con khi kẹt | 0 | **Nhanh hơn**: không treo hàng giờ |
| S có diff đụng file chung lên M | +1 reviewer, chỉ cho ticket đó | — |
| Label `ready`, luôn chạy `check-batch` | +vài giây | — |
