# Factory

Một skill cho Claude Code để chạy một tác vụ lập trình qua một nhóm agent làm việc cùng nhau, thay vì một agent làm hết trong một lượt.

Nhóm agent được điều phối bằng code (một script Workflow), không phải bằng một agent đọc hướng dẫn. Thứ tự các bước, việc mỗi agent được thấy gì, và số vòng sửa do code quyết định nên không thể bị làm lệch.

Đây là bản nền (baseline) được viết lại từ đầu: chưa có sổ ghi bằng chứng. Skill có kèm một dashboard: mở `factory/dashboard/index.html` bằng trình duyệt để xem tiến độ của lượt đang chạy (trang tự đọc lại vài giây một lần), các lượt đã chạy và benchmark.

## Ai làm gì

| Vai trò | Việc làm | Có sửa code không |
|---|---|---|
| Phiên Claude bạn đang chat | Viết hợp đồng công việc với bạn, khởi động workflow, tự chạy lại kiểm tra, merge lượt chạy đạt, báo cáo | Không (chỉ commit và merge) |
| Script workflow (code) | Điều phối các agent bên dưới, kiểm tra spec, quyết định đạt hay không đạt | Không |
| Planner | Đọc code và trả về một hoặc nhiều spec | Không |
| Implementer | Viết code cho đúng một spec, trong các file nguồn spec đó sở hữu. Không viết test | Có |
| Tester | Viết test cho đúng một spec, trong các file test spec đó sở hữu, trong một worktree riêng không có code của implementer; sau đó tự soát lại test trong phiên mới | Có (chỉ file test) |
| Checker | Chạy các lệnh kiểm tra của hợp đồng và liệt kê file đã thay đổi | Không |
| Reviewer | Đánh giá toàn bộ thay đổi so với hợp đồng, và chỗ các phần ghép với nhau | Không |
| Spec reviewer | Chỉ khi task được tách: đọc kỹ từng dòng các file của một spec | Không |
| Fixer | Chỉ khi thay đổi chưa đạt: sửa code dựa trên report tổng hợp từ checker và các reviewer. Không bao giờ sửa test | Có (chỉ file nguồn) |

Lý do tách spec: một agent nhận quá nhiều việc cùng lúc dễ đoán mò và bịa chi tiết. Mỗi spec được build bởi một agent riêng trong một phiên riêng, chỉ thấy đúng spec đó; không agent nào nhận nhiều spec cùng lúc. Test của một spec do một agent khác với agent viết code đảm nhận: hai agent làm song song từ cùng một spec, tester làm trong một bản checkout riêng (git worktree) ở commit gốc nên hai bên không thấy sản phẩm của nhau, để test đo đúng yêu cầu chứ không được viết cho khớp với code đã làm. Viết xong, tester tự soát lại test theo spec cho đến khi một lượt soát không còn gì phải sửa; từ đó test là chuẩn: khi test fail thì mặc định code sai. Review cũng được chia như vậy: mỗi spec có một reviewer riêng, cộng một reviewer đánh giá toàn bộ thay đổi theo hợp đồng. Không reviewer nào thấy lời giải thích của implementer, nên họ đánh giá code chứ không đánh giá câu chuyện về code. Sửa lỗi là chỗ duy nhất một agent làm việc trên toàn bộ thay đổi: lỗi thường nằm ở chỗ hai phần ghép nhau, nên một fixer nhận report tổng hợp và bản đồ file, không nhận các spec.

## Quy trình

1. **Hợp đồng** (phiên chat): mục tiêu, tiêu chí chấp nhận `C1..Cn`, phần ngoài phạm vi, và các lệnh kiểm tra thật của dự án.
2. **Workflow** (code), gồm năm pha:
   - **Spec**: planner trả về spec. Code từ chối và gửi lại kèm lý do nếu có tiêu chí chưa spec nào phụ trách, một file thuộc hai spec, hoặc các phụ thuộc không xếp được thứ tự.
   - **Build**: mỗi spec có một implementer viết code và một tester viết test, chạy song song; mỗi bên sở hữu file riêng và không được xem phần spec dành cho bên kia. Implementer làm trong repository; tester làm trong git worktree riêng ở commit gốc, nên code mới không có trên đĩa của tester và test mới không có trên đĩa của implementer. Viết xong, tester được gọi lại trong phiên mới, vẫn trong worktree đó, để soát test theo spec và sửa nếu sai, lặp đến khi một lượt soát không sửa gì (tối đa hai lượt), trong lúc implementer vẫn đang làm. Khi mọi agent của một tầng build xong, code chép các file test từ worktree về repository. Spec không có file test thì không có tester; spec chỉ có file test thì không có implementer. Spec độc lập chạy song song; spec phụ thuộc thì chờ. Lượt chạy dừng nếu một agent báo đã sửa file không thuộc quyền của mình, nếu git cho thấy tester sửa gì khác ngoài file test trong worktree của nó, hoặc nếu một file test bị đổi trong repository trong lúc build.
   - **Check**: checker chạy các lệnh kiểm tra và liệt kê file đã đổi. File bị sửa mà không spec nào sở hữu sẽ dừng cả lượt chạy.
   - **Review**: một reviewer mới đánh giá toàn bộ thay đổi theo hợp đồng. Khi có nhiều spec, mỗi spec có thêm một reviewer riêng chỉ thấy spec đó và các file của nó; tất cả chạy song song. Một tiêu chí chỉ đạt khi mọi reviewer phụ trách nó đều đánh giá là đạt.
   - **Repair**: nếu còn lỗi, các lỗi được gom thành một report và mặc định code sai. Một fixer duy nhất nhận hợp đồng, report và bản đồ file, phải sửa code cho qua test và chỉ được sửa file nguồn. Tester chỉ được gọi lại khi một reviewer báo lỗi chặn vào chính file test của nó. Sau đó checker và các reviewer mới xem lại. Tối đa hai vòng.
3. **Xác nhận** (phiên chat): tự chạy lại các lệnh kiểm tra.
4. **Merge** (phiên chat): mỗi lượt chạy làm việc trên một nhánh riêng `factory/<id>`, tách từ nhánh bạn đang đứng (thường là `main`). Chỉ khi workflow trả về `passed` và lần chạy lại kiểm tra cũng đạt, phiên chat mới commit các file thuộc các spec rồi merge fast-forward vào nhánh ban đầu và xóa nhánh riêng. Nếu không đạt, thay đổi nằm lại trên `factory/<id>` và nhánh ban đầu không bị đụng tới.
5. **Gửi về XS Factory Bench** (phiên chat): nếu máy có lệnh `xfb`, phiên chat chạy `xfb report` để gửi bản ghi của lượt chạy và transcript lên XS Factory Bench, bất kể kết quả là gì. Không có `xfb` thì bỏ qua. Bước này không bao giờ làm thay đổi lượt chạy: gửi không được thì `xfb` giữ lại và gửi sau.
6. **Báo cáo** (phiên chat): kết quả, từng tiêu chí kèm bằng chứng, những gì còn mở, và đã merge hay chưa.

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
│   ├── spec-reviewer.md  reviewer cho từng spec
│   └── fixer.md          người sửa code theo report ở vòng sửa
├── dashboard/            trang theo dõi nhóm agent và các lượt chạy
│   ├── index.html        mở thẳng bằng trình duyệt
│   ├── runs.js           các lượt đã chạy, phiên chat thêm một mục sau mỗi lượt
│   └── live.js           lượt đang chạy, workflow ghi đè ở mỗi bước (không commit)
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
- Worktree của tester là một thư mục khác trên cùng máy, không phải sandbox: tester cố tình tìm đến repository chính thì vẫn đọc được, nên phần đó vẫn là chỉ dẫn trong prompt. Việc tester sửa file nào được kiểm bằng git trong worktree; với implementer và fixer, code vẫn so danh sách file agent tự báo, cộng thêm việc phát hiện file test bị đổi trong repository lúc build.
- Worktree chỉ có những gì git theo dõi. Để tester chạy được test, script tạo symlink từ repository vào worktree cho các đường dẫn bị git bỏ qua: mặc định là `node_modules`, `.venv`, `venv`, `.env`, `.env.local`, `.env.test`, cộng với các đường dẫn truyền thêm qua `share`. Một đường dẫn chỉ được link khi nó có trong repository và bị git bỏ qua. Đây là link chứ không phải bản sao: tester bị dặn không được sửa hay cài thêm vào đó, và không được tự tạo link riêng tới đó, nhưng đó vẫn chỉ là chỉ dẫn trong prompt. Mỗi agent được script cấp một thư mục nháp riêng trong `<worktrees>/scratch/`, vì các agent của cùng một lượt chạy vốn dùng chung scratchpad của session: hai agent chọn trùng tên thư mục thì có thể xóa file của nhau, hoặc ghi xuyên qua link do agent kia tạo vào thẳng repository. Test cần DB thật thì chạy trên cùng DB với implementer. Thứ gì không được link (kết quả build, `node_modules` lồng trong monorepo nếu không truyền qua `share`) thì vẫn thiếu, và tester phải ghi rõ trong báo cáo. Worktree cũng không có code của các spec khác, kể cả spec mà nó phụ thuộc.
- Việc tạo worktree và chép test về do một agent nhỏ chạy đoạn lệnh mà script viết sẵn (hai agent nhỏ cho mỗi tầng build có tester), vì script không tự chạy được git. Script đọc lại kết quả lệnh để quyết định.
- Mỗi vòng sửa chỉ có một fixer cho toàn bộ report. Với task lớn có nhiều lỗi cùng lúc, agent này có thể bị quá tải và sửa sót.
- Test là chuẩn nên một test sai mà lọt qua cả vòng tự soát lẫn reviewer sẽ khiến code đúng bị sửa theo nó. Fixer chỉ có thể ghi lại nghi ngờ để phiên chat báo cho bạn.
- Các implementer chạy song song trên cùng một thư mục làm việc; an toàn là nhờ không file nào có hai chủ.
- Tiến độ trên dashboard được cập nhật ở các mốc của lượt chạy (xong Spec, xong mỗi tầng Build, xong Check, xong Review, mỗi vòng sửa), không phải theo từng agent. Mỗi lần cập nhật do một agent nhỏ ghi file, vì script không tự ghi được. Dashboard chỉ hiện được một lượt đang chạy tại một thời điểm.
- Trạng thái của một lượt chạy không được lưu để tiếp tục sau khi phiên kết thúc.
- Một quy trình chung cho mọi loại việc (tính năng, sửa lỗi, refactor, test); chưa có chế độ riêng cho từng loại.
- Lượt chạy đạt được commit và merge ở máy bạn; skill không tự push hay mở pull request trừ khi được yêu cầu. Lượt không đạt không được merge.
