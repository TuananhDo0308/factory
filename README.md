# Factory

Một skill cho Claude Code để chạy một tác vụ lập trình qua một nhóm agent làm việc cùng nhau, thay vì một agent làm hết trong một lượt.

Đi kèm là hai skill cho bước trước khi build, để làm việc theo GitHub issue:

```
Task ──/ba-ticket──▶ Issue (ticket): mục tiêu, user story, tiêu chí C1..Cn, ngoài phạm vi
Issue ──/dev-subissues──▶ các sub-issue: chia việc, chỗ nằm trong code, seam, rủi ro
1 issue + sub-issue của nó ──/factory──▶ 1 lượt chạy ──▶ 1 pull request ──▶ merge vào main
```

- **`ba-ticket`** (BA): hỏi rõ yêu cầu với bạn, viết một hoặc nhiều issue, mỗi issue cỡ một pull request, với tiêu chí chấp nhận đánh số `C1..Cn` kiểm tra được từ bên ngoài. Chỉ tạo issue sau khi bạn duyệt.
- **`dev-subissues`** (dev): đọc issue và code, thêm sub-issue (sub-issue native của GitHub) nói việc chia thế nào, mỗi phần nằm ở file nào, seam giữa các phần và rủi ro. Sub-issue **chỉ là context cho planner**: không có tiêu chí riêng, planner vẫn tự chia spec và code vẫn kiểm spec. Chỉ tiêu chí của issue được chấm.
- **`factory`**: nhận số issue, lấy tiêu chí của issue làm hợp đồng, đưa issue và sub-issue cho planner làm context, và khi đạt thì mở pull request đóng issue cùng các sub-issue rồi merge vào nhánh mặc định.

Nhóm agent được điều phối bằng code (một script Workflow), không phải bằng một agent đọc hướng dẫn. Thứ tự các bước, việc mỗi agent được thấy gì, và số lần một spec được quay về Build do code quyết định nên không thể bị làm lệch.

Đây là bản nền (baseline) được viết lại từ đầu: chưa có sổ ghi bằng chứng. Skill có kèm một dashboard: mở `factory/dashboard/index.html` bằng trình duyệt để xem tiến độ của lượt đang chạy (trang tự đọc lại vài giây một lần), các lượt đã chạy và benchmark.

## Ai làm gì

| Vai trò | Việc làm | Có sửa code không |
|---|---|---|
| Phiên Claude bạn đang chat | Viết hợp đồng công việc với bạn, khởi động workflow, tự chạy lại kiểm tra, merge lượt chạy đạt, báo cáo | Không (chỉ commit và merge) |
| Script workflow (code) | Điều phối các agent bên dưới, kiểm tra spec, quyết định đạt hay không đạt | Không |
| Planner | Đọc code và trả về một hoặc nhiều spec | Không |
| Implementer | Làm đúng một spec theo kiểu test trước (TDD): với mỗi tiêu chí, viết test, chạy thấy fail đúng lý do, rồi mới viết code cho pass. Khi QA hoặc review gửi spec quay về Build, một phiên mới của implementer nhận các lỗi thuộc file của spec mình | Có (file nguồn và file test của spec) |
| QA | Như lane Tester của super-board: sau mỗi lần implementer làm xong, soát spec đó (tiêu chí nào có test, edge case, test không thể fail), viết thêm test cho các lỗ hổng nghiêm trọng, chạy code review và security review; có lỗi thì gửi spec quay về Build | Có (chỉ file test) |
| Checker | Chạy các lệnh kiểm tra của hợp đồng và liệt kê file đã thay đổi | Không |
| Reviewer | Đánh giá toàn bộ thay đổi so với hợp đồng, và chỗ các phần ghép với nhau | Không |
| Spec reviewer | Chỉ khi task được tách: đọc kỹ từng dòng các file của một spec | Không |

Lý do tách spec: một agent nhận quá nhiều việc cùng lúc dễ đoán mò và bịa chi tiết. Mỗi spec được build bởi một agent riêng trong một phiên riêng, chỉ thấy đúng spec đó; không agent nào nhận nhiều spec cùng lúc. Implementer viết từng test trước code và phải thấy test fail trước, nên test nào cũng chắc chắn có thể fail. Nhưng test do chính agent viết code viết ra thì dễ khớp với những gì nó đã làm, nên sau đó một agent QA riêng đọc test của spec theo spec, không được xem kế hoạch thay đổi code hay lời kể của implementer, và vá các lỗ hổng nghiêm trọng (cách làm học từ super-board: builder làm TDD, QA soát test-gap sau build). Review cũng được chia như vậy: mỗi spec có một reviewer riêng, cộng một reviewer đánh giá toàn bộ thay đổi theo hợp đồng. Không reviewer nào thấy lời giải thích của implementer hay QA, nên họ đánh giá code chứ không đánh giá câu chuyện về code. Khi chưa đạt, mỗi lỗi quay về implementer của spec mà lỗi thuộc về, trong một phiên mới chỉ thấy spec đó, các lỗi của nó và interface của các phần khác.

## Quy trình

1. **Hợp đồng** (phiên chat): mục tiêu, tiêu chí chấp nhận `C1..Cn`, phần ngoài phạm vi, và các lệnh kiểm tra thật của dự án. Khi được đưa một issue, hợp đồng lấy từ issue (tiêu chí của issue, giữ nguyên câu chữ), không lấy tiêu chí từ sub-issue; issue và sub-issue được truyền vào workflow qua arg `issue`, và chỉ planner thấy. Lượt chạy theo issue phải bắt đầu từ nhánh mặc định đúng như trên GitHub (`origin/<mặc định>`). Sau đó phiên chat chạy `scripts/skills-ready.sh` để chắc các skill của nhóm đã được cài, rồi truyền đường dẫn của chúng vào workflow; thiếu skill thì không chạy.
2. **Workflow** (code), gồm năm pha:
   - **Spec**: planner trả về spec (khi chạy theo issue, planner đọc thêm issue và sub-issue làm context: một spec cho mỗi sub-issue nếu file cho phép, gộp hoặc chia lại khi hai phần đụng chung file), mỗi spec có `kind` (feature, bug, ux, refactor, tech-debt, tests, docs). Code từ chối và gửi lại kèm lý do nếu có tiêu chí chưa spec nào phụ trách, một file thuộc hai spec hoặc vừa là file nguồn vừa là file test, thiếu `kind`, ghi một skill chưa được cài, hoặc các phụ thuộc không xếp được thứ tự.
   - **Build**: mỗi spec chạy như một card trên board của super-board. Implementer viết test trước rồi mới viết code, trong các file nguồn và file test spec đó sở hữu. Xong thì QA soát spec: lập bảng tiêu chí nào có test, tìm edge case, tìm test không thể fail, chạy code review và security review, viết thêm test cho các lỗ hổng nghiêm trọng (chỉ trong file test của spec). QA có lỗi gửi trả thì spec **quay về Build**: một phiên implementer mới sửa, rồi một QA mới soát lại, tối đa `maxRebuilds` lần (mặc định 2). Spec nào cũng qua QA, kể cả spec không có file test. Spec độc lập chạy song song; spec phụ thuộc thì chờ cả tầng trước xong. Lượt chạy dừng nếu một agent báo đã sửa file nó không được sửa (với QA: bất cứ gì ngoài file test).
   - **Check**: checker chạy các lệnh kiểm tra và liệt kê file đã đổi. File bị sửa mà không spec nào sở hữu sẽ dừng cả lượt chạy.
   - **Review**: một reviewer mới đánh giá toàn bộ thay đổi theo hợp đồng. Khi có nhiều spec, mỗi spec có thêm một reviewer riêng chỉ thấy spec đó và các file của nó; tất cả chạy song song. Một tiêu chí chỉ đạt khi mọi reviewer phụ trách nó đều đánh giá là đạt.
   - **Quay về Build** (không có pha sửa riêng): nếu lệnh kiểm tra fail, tiêu chí chưa đạt hoặc có lỗi chặn, các spec liên quan quay về Build, như card bị trả về Ready: chủ của file mà lỗi chỉ tới, các spec phụ trách tiêu chí đó, hoặc với lệnh kiểm tra fail thì các spec có file xuất hiện trong output (không thấy file nào thì gửi cho mọi spec). Mỗi spec đó đi lại implementer (phiên mới, được sửa cả file nguồn lẫn file test của spec) → QA, rồi cả thay đổi được check và review lại. Spec đã quay về đủ `maxRebuilds` lần thì lượt chạy fail. Code ghi lại mọi file test bị sửa sau lần build đầu để phiên chat báo cho bạn.

   **Skill** được xếp y như bảng `REGISTRY` của super-board; script chọn cho từng agent, agent nạp bằng Skill tool trước khi làm:

   | Agent | Luôn nạp | Theo `kind` của spec | Có điều kiện (agent tự quyết theo luật) |
   |---|---|---|---|
   | Implementer (cả khi quay về Build) | `verification-before-completion`, `mp-code-review` | `bug`: `diagnosing-bugs`, `tdd` · `feature`: `tdd`, `codebase-design` · `ux`: `tdd` · `refactor`, `tech-debt`: `codebase-design`, `tdd` · `tests`: `tdd` · `docs`: không | `vitest`, `playwright-best-practices`, `testing-strategy`, `domain-modeling` |
   | QA | `tdd`, `diagnosing-bugs`, `verification-before-completion`, `testing-strategy`, `mp-code-review`, `pr-security-review` | | `vitest`, `playwright-best-practices` |
   | Reviewer, spec reviewer | `mp-code-review`, `codebase-design` | | |

   Khác super-board ở mấy chỗ không chạy được: `implement` và `ask-matt` của mattpocock bị khóa với agent; `resolving-merge-conflicts` không còn được phát hành và trong lượt chạy không có merge; plugin `ponytail` không có nguồn công khai, nên luật "giải pháp đơn giản nhất trước" của nó được viết thẳng vào brief implementer, còn reviewer báo over-engineering ở mức `minor`, giống fallback của super-board. Spec có thể ghi `skills` riêng để thay bộ theo `kind`.
3. **Xác nhận** (phiên chat): tự chạy lại các lệnh kiểm tra.
4. **Merge** (phiên chat): mỗi lượt chạy làm việc trên một nhánh riêng `factory/<id>`, tách từ nhánh bạn đang đứng (thường là `main`). Chỉ khi workflow trả về `passed` và lần chạy lại kiểm tra cũng đạt, phiên chat mới commit các file thuộc các spec rồi merge fast-forward vào nhánh ban đầu và xóa nhánh riêng. Nếu không đạt, thay đổi nằm lại trên `factory/<id>` và nhánh ban đầu không bị đụng tới. Khi chạy theo issue: push nhánh, mở pull request vào nhánh mặc định với `Closes #<issue>` và `Closes #<sub-issue>` cho từng sub-issue (GitHub không tự đóng sub-issue khi issue cha đóng), rồi `gh pr merge --squash`. Nếu GitHub từ chối merge (branch protection đòi review, check chưa xong, xung đột), pull request được để mở và phiên chat báo lý do; không bao giờ dùng `--admin` để vượt.
5. **Gửi về XS Factory Bench** (phiên chat): nếu máy có lệnh `xfb`, phiên chat chạy `xfb report` để gửi bản ghi của lượt chạy và transcript lên XS Factory Bench, bất kể kết quả là gì. Không có `xfb` thì bỏ qua. Bước này không bao giờ làm thay đổi lượt chạy: gửi không được thì `xfb` giữ lại và gửi sau.
6. **Báo cáo** (phiên chat): kết quả, từng tiêu chí kèm bằng chứng, những gì còn mở, và đã merge hay chưa.

**Model** được chọn theo vai trò trong code (bảng `MODELS`): planner dùng Fable, effort high, vì spec sai thì mọi agent phía sau sai theo; reviewer toàn bộ thay đổi dùng Opus, effort high, vì là cửa cuối quyết định đạt hay không; implementer, QA và spec reviewer dùng Sonnet, effort medium; implementer của spec bị quay về Build được nâng lên Opus; checker dùng Sonnet, effort low vì chỉ chạy lệnh. Muốn đổi thì truyền arg `models`, ví dụ `{"implementer": {"model": "opus"}}`.

Code tự tính đạt hay không đạt: mọi lệnh kiểm tra thoát với mã 0, mọi tiêu chí được đánh giá là đạt, và không còn lỗi chặn. Không agent nào tự tuyên bố "đạt".

Khi gặp tình huống cần quyết định (spec sai, implementer cần file ngoài quyền), workflow dừng với trạng thái `blocked` và trả việc về cho phiên chat.

## Cấu trúc thư mục

```
ba-ticket/
├── SKILL.md              BA: task → issue, tiêu chí C1..Cn, tạo issue sau khi được duyệt
└── references/ticket-template.md
dev-subissues/
├── SKILL.md              dev: issue → sub-issue làm context cho planner
└── references/subissue-template.md
factory/
├── SKILL.md              hướng dẫn cho phiên chat: hợp đồng, gọi workflow, báo cáo
├── workflow/
│   └── factory.js        script điều phối
├── scripts/
│   ├── skills-ready.sh   kiểm tra skill của nhóm đã cài chưa, in đường dẫn cho workflow
│   ├── install-skills.sh cài skill từ mattpocock/skills, obra/superpowers, antfu/skills, anthropics/knowledge-work-plugins, currents-dev, super-board (commit đã ghim)
│   └── factorybench-*    gửi lượt chạy về FactoryBench
├── roles/
│   ├── planner.md        bản mô tả vai trò planner và định dạng spec
│   ├── implementer.md    viết test trước rồi code, cho từng spec; cả khi quay về Build
│   ├── qa.md             soát test của từng spec sau build
│   ├── checker.md
│   ├── reviewer.md       reviewer toàn bộ thay đổi
│   └── spec-reviewer.md  reviewer cho từng spec
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
- Các skill của nhóm phải được cài: `tdd`, `diagnosing-bugs`, `codebase-design`, `code-review` (mattpocock/skills; cài dưới tên `mp-code-review` để không trùng lệnh `/code-review` có sẵn của Claude Code) `verification-before-completion` (obra/superpowers), `pr-security-review` (EricTechPro/super-board) và `testing-strategy` (anthropics/knowledge-work-plugins). Tùy chọn: `vitest`, `playwright-best-practices`, `domain-modeling`. Xem phần Cài đặt.

## Cài đặt

### Cách nhanh: dán prompt này vào Claude Code

Mở Claude Code ở thư mục bất kỳ và dán nguyên đoạn dưới đây. Claude sẽ tự tải Factory, cài các skill mà nhóm agent dùng và kiểm tra lại.

```text
Cài skill Factory cho Claude Code từ https://github.com/sangtruong-rgb/factory, theo đúng các bước sau:

1. Clone repo (git clone --depth 1) vào một thư mục tạm.
2. Nếu ~/.claude/skills/factory, ~/.claude/skills/ba-ticket hoặc ~/.claude/skills/dev-subissues đã tồn tại, dừng lại, cho tôi biết nó là gì (thư mục hay symlink, trỏ đi đâu) và hỏi tôi trước khi thay. Không ghi đè khi chưa được tôi đồng ý.
3. Sao chép các thư mục factory/, ba-ticket/ và dev-subissues/ trong repo thành ~/.claude/skills/factory, ~/.claude/skills/ba-ticket và ~/.claude/skills/dev-subissues (bước 2 áp dụng cho cả ba).
4. Chạy: bash ~/.claude/skills/factory/scripts/install-skills.sh
   Script này tải các skill mà nhóm agent dùng (mattpocock/skills, obra/superpowers, super-board, antfu/skills, anthropics/knowledge-work-plugins, currents-dev) ở commit đã ghim vào ~/.claude/skills, và giữ nguyên skill nào đã có.
5. Chạy: bash ~/.claude/skills/factory/scripts/skills-ready.sh "$HOME"
   Lệnh này phải thoát với mã 0. Nếu thoát với mã 10, nó in tên các skill còn thiếu: báo cho tôi.
6. Xóa thư mục tạm.
7. Báo lại cho tôi: skill nào vừa được cài (kể cả factory, ba-ticket, dev-subissues), skill nào giữ nguyên vì đã có, skills-ready có đạt không, và nhắc tôi mở phiên Claude Code mới để dùng /factory.
```

### Cài bằng tay

```sh
git clone --depth 1 https://github.com/sangtruong-rgb/factory.git /tmp/factory-src
cp -r /tmp/factory-src/factory ~/.claude/skills/factory      # sao lưu hoặc xóa bản cũ trước nếu đã có
cp -r /tmp/factory-src/ba-ticket ~/.claude/skills/ba-ticket
cp -r /tmp/factory-src/dev-subissues ~/.claude/skills/dev-subissues
bash ~/.claude/skills/factory/scripts/install-skills.sh      # cài skill của nhóm vào ~/.claude/skills, không ghi đè
bash ~/.claude/skills/factory/scripts/skills-ready.sh "$HOME" # phải thoát với mã 0
rm -rf /tmp/factory-src
```

Lưu ý: nếu `~/.claude/skills/factory` đã tồn tại (ví dụ bản Factory cũ), `cp -r` sẽ ghi lẫn vào bản cũ. Hãy sao lưu hoặc xóa bản cũ trước. Skill `code-review` của mattpocock được cài dưới tên `mp-code-review` để không che lệnh `/code-review` có sẵn của Claude Code.

Không cần cài agent riêng: mỗi agent được yêu cầu đọc bản mô tả vai trò của mình trong `roles/`. Cài xong, mở một phiên Claude Code mới để skill được nạp.

## Cách dùng

Trong Claude Code, mở repo cần làm việc rồi gõ:

```
/factory thêm cờ --json cho lệnh wordstats, giữ nguyên output mặc định và có test
```

Skill cũng tự kích hoạt khi bạn yêu cầu một "factory" hoặc một nhóm agent lập kế hoạch, xây dựng và review một tác vụ.

Làm theo issue (cần `gh` đã đăng nhập):

```
/ba-ticket người dùng cần xuất danh sách đơn hàng ra CSV, lọc theo ngày
/dev-subissues #42
/factory #42
```

Mỗi bước dừng lại để bạn duyệt trước khi tạo issue hay sub-issue trên GitHub.

## Giới hạn hiện tại

- Script workflow không tự chạy được lệnh, nên kết quả kiểm tra trong lượt chạy do agent checker báo về. Phiên chat chạy lại các lệnh đó sau khi workflow xong để có bằng chứng trực tiếp.
- Quy tắc "planner, checker và các reviewer không sửa gì" là chỉ dẫn trong prompt, không phải giới hạn công cụ được ép buộc. Code chỉ phát hiện được file bị sửa ngoài quyền sở hữu của các spec.
- Test do chính implementer viết nên không độc lập với code. QA và các reviewer đọc lại test theo spec để bù cho điều đó, nhưng một lỗi hiểu sai spec mà cả test lẫn code cùng mắc vẫn có thể lọt qua nếu QA và reviewer cũng không nhận ra.
- Việc implementer thật sự viết test trước và thấy test fail là chỉ dẫn trong prompt: implementer tự báo lại trong `tdd`, code không kiểm chứng được. Việc QA phá thử dòng code rồi khôi phục cũng vậy; QA bị dặn kiểm bằng `git diff` rằng file nguồn y như cũ.
- Khi spec quay về Build, implementer được phép sửa test của spec mình. Code ghi lại các file test bị sửa, QA và reviewer vòng sau thấy diff, nhưng việc "không nới lỏng test cho dễ pass" vẫn là chỉ dẫn trong prompt.
- Mỗi lần spec quay về Build tốn thêm 2 agent (implementer và QA), cộng một lượt check và review cả thay đổi nếu do review gửi về. Giới hạn là `maxRebuilds` lần mỗi spec.
- Lệnh kiểm tra fail mà output không nhắc tới file nào của spec thì code không biết lỗi của ai, nên gửi cho mọi spec: tốn thêm agent ở task nhiều spec.
- Mỗi agent được script cấp một thư mục nháp riêng trong thư mục `scratch` (mặc định `<repo>-factory-scratch`, cạnh repository), vì các agent của cùng một lượt chạy vốn dùng chung scratchpad của session: hai agent chọn trùng tên thư mục thì có thể xóa file của nhau, hoặc ghi xuyên qua link do agent kia tạo vào thẳng repository.
- Các implementer chạy song song trên cùng một thư mục làm việc; an toàn là nhờ không file nào có hai chủ.
- Tiến độ trên dashboard được cập nhật ở các mốc của lượt chạy (xong Spec, đầu mỗi tầng Build, khi một spec chuyển sang QA, xong Check, xong Review, mỗi lần spec quay về Build), không phải theo từng agent. Mỗi lần cập nhật do một agent nhỏ ghi file, vì script không tự ghi được. Dashboard chỉ hiện được một lượt đang chạy tại một thời điểm.
- Trạng thái của một lượt chạy không được lưu để tiếp tục sau khi phiên kết thúc.
- Một quy trình chung cho mọi loại việc; chỗ khác nhau giữa các loại chỉ là bộ skill implementer nạp theo `kind`.
- Skill là của bên thứ ba và viết cho người dùng ngồi trước máy (ví dụ `tdd` bảo thống nhất seam với người dùng, `mp-code-review` so diff với `HEAD` và tự sinh sub-agent). Prompt dặn agent: không có ai để hỏi, interface trong spec là seam đã thống nhất, diff là `git diff <base>` vì thay đổi chưa commit, và khi skill mâu thuẫn với brief thì brief thắng. Agent có tuân theo hay không vẫn là chỉ dẫn trong prompt.
- Chưa kiểm chứng agent do Workflow sinh ra có Skill tool hay không; nếu không có, prompt bảo agent đọc thẳng file SKILL.md theo đường dẫn được truyền vào.
- Lượt chạy đạt từ một yêu cầu bằng lời được commit và merge ở máy bạn; skill không tự push hay mở pull request trừ khi được yêu cầu. Lượt chạy đạt từ một issue thì được push, mở pull request và merge thẳng vào nhánh mặc định mà không có người duyệt trên GitHub: lớp duyệt duy nhất là QA, các reviewer của factory và lần chạy lại kiểm tra của phiên chat. Lượt không đạt không được push hay merge.
- Sub-issue chỉ là context: planner có thể chia spec khác với sub-issue, và yêu cầu nào chỉ nằm trong sub-issue mà không có trong tiêu chí của issue thì không được chấm. `dev-subissues` được dặn đề xuất thêm tiêu chí vào issue thay vì viết vào sub-issue.
