# Open-source trust landscape and reward-upgrade research

> 研究日期：2026-08-16

> 這是一份只讀研究與策略文件。它不改變 ReviewReady 的 readiness 判定，
> 不把研究結論當成產品通過條件，也不宣稱 OpenAI 獎勵的錄取機率或結果。

## 研究目的

本研究回答四個問題：

1. 世界上與 ReviewReady 相鄰的開源專案各自解決哪一層問題？
2. ReviewReady 目前真正已經完成什麼，哪些仍只是契約、設計或外部權威？
3. 哪些升級最能增加 OpenAI Codex for Open Source 申請的可信度？
4. 如何把升級順序接到既有的 post-v1 execution plan，而不為了表面功能
   或漂亮格式犧牲信任邊界？

研究方法遵循
[深度研究流程](deep-research-process.md)：先固定問題與證據邊界，批次攻擊
不同角度，分開 observation、inference、recommendation，保留反證，最後才
形成可執行的升級路線。相同專案的不同 README 或搜尋結果不是獨立證據；
專案自述的能力也不等於第三方驗證。

## 先說結論

ReviewReady 不需要把自己包裝成另一個 AI code reviewer。它最有價值的定位是：

> 在 pull request 消耗人類 review 時間之前，從 base revision 的 policy
> 出發，對變更範圍、可信來源、最新狀態、可見 evidence 與資料一致性做
> bounded、deterministic、fail-closed 的 evidence/trust 判定。

這個位置位於幾個成熟工具的交界處，但不是它們的替代品：

- GitHub rulesets 決定哪些結果能影響 branch 或 tag。
- Danger、Mergeable、policy-bot 把團隊規範、approval 或 PR metadata 自動化。
- Scorecard、Allstar、zizmor、CodeQL、SLSA 與 artifact attestations 處理
  repository security、workflow security 或供應鏈 provenance。
- OpenCodeReview、reviewd、AI review gate、GuardVibe、AgentTrust 與
  Gortex 處理 AI 產生的程式碼、prompt、agent tool 或 code intelligence。
- ReviewReady 的窄而深的問題是：在這些工具的輸出或 GitHub metadata 被拿來
  當 evidence 之前，這些 evidence 是否屬於同一個 PR snapshot、同一個
  revision、可信的 provider、正確的 base policy，且沒有因不完整或含糊而被
  誤判為 ready？

因此，最有機會提高獎勵申請可信度的升級不是「增加一個模型 verdict」，而是
讓外部審查者在幾分鐘內看見一條完整、可重現、誠實的證據鏈：

1. 一個清楚的 AI 時代 trust problem。
2. 一個與相鄰工具不重疊的 deterministic solution。
3. 一個從 npm、Action、schema、tag、release 到 source commit 的一致版本。
4. 一個可複製的 ready / not-ready / incomplete demo。
5. 一個真實的 maintainer workflow 使用記錄；沒有外部使用者時，就明確標為
   self-dogfood，不把下載量寫成採用者數量。

## 1. 獎勵計畫能支持什麼主張

### 直接觀察

OpenAI 的公開申請頁說明，這個計畫面向 active open-source projects 的
maintainers，尋找 meaningful usage、broad adoption 或 clear importance to
the software ecosystem；審查訊號包括 repository usage、ecosystem
importance 與 active maintenance，也包含 pull request review、issue triage
與 release management 等持續責任。申請採 rolling review，且若專案不完全
符合典型規模但對生態有重要性，申請者可以直接解釋原因。

來源：[OpenAI Codex for Open Source 申請頁](https://openai.com/form/codex-for-oss/)
與
[OpenAI Developers 的 Codex for Open Source 說明](https://developers.openai.com/community/codex-for-oss)。

### 推論

公開資料沒有提供錄取率、各訊號的權重或最低 stars/downloads 門檻，所以
不能負責任地計算「獲獎機率」。可以做的是提升審查者能直接驗證的訊號：

- 專案是否真的在持續維護；
- 問題是否對 AI 時代的開源維護有清楚重要性；
- 解法是否和既有工具有明確邊界；
- 專案是否能實際放進 maintainer workflow；
- 宣稱是否能由公開 commit、release、測試與使用記錄支持。

這也意味著，1 star 或少量 fork 不是技術品質的反證，但它們會使
「clear importance」不能只靠一句願景補足。ReviewReady 必須用可重現 proof
與具體 maintainer problem 來補強，而不是購買或製造社群訊號。

### 不應提出的主張

目前證據不能支持以下說法：

- 「世界上最全面」或「沒有任何同類專案更強」；
- npm downloads 等於 unique users、active installations 或 broad adoption；
- AI 產生了大部分工作，因此 maintainer responsibility 可以省略；
- TA-3 library contract 等於已經有 live、durable、production GitHub App；
- 一個 CI check 名稱等於可信的 workflow provenance；
- 研究文件漂亮或多個模型同意，就等於 readiness。

## 2. 同方向開源專案地圖

下表不是排名，而是 trust boundary map。每個專案放在它實際宣稱的主要
責任層；同一個專案可能跨越數層，但不能因此把它的能力擴大解讀。

| 層次                        | 代表性來源                                                                                                                                                       | 它主要回答的問題                                                    | 與 ReviewReady 的關係                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub merge authority      | [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)                   | 哪些 branch、tag、review、status、path 或 bypass 規則可阻止合併？   | 它是外部權威；ReviewReady 應讀取並尊重它，不能取代它。                                                |
| PR convention               | [Danger JS](https://github.com/danger/danger-js)、[Mergeable](https://mergeable.readthedocs.io/en/latest/)、[policy-bot](https://github.com/palantir/policy-bot) | PR 是否符合團隊規範、approval policy、metadata 或自動化條件？       | ReviewReady 可互補，但更重視 evidence 的 revision、provider、時間與快照一致性。                       |
| Repository security posture | [OpenSSF Scorecard](https://github.com/ossf/scorecard)、[Allstar](https://github.com/ossf/allstar)                                                               | repository 的安全最佳實務與設定是否達標？                           | Audit 可以消費或對照這類訊號，但 readiness 不應把 security score 直接當成 PR evidence。               |
| Workflow / code security    | [zizmor](https://github.com/zizmorcore/zizmor)、[CodeQL Action](https://github.com/github/codeql-action)                                                         | workflow 或 source 是否有靜態分析可發現的風險？                     | 它們是 scanner；ReviewReady 的 AI-1 應避免複製其職責，並清楚區分 finding 與 readiness。               |
| Build provenance            | [actions/attest](https://github.com/actions/attest)、[SLSA](https://slsa.dev/)                                                                                   | artifact 是否可由 digest、predicate、簽章與 build provenance 驗證？ | 這是未來 release / attestation 的互補信任來源，不是 PR body 或 check 的替代品。                       |
| AI-generated code quality   | [Open Code Review](https://github.com/raye-deng/open-code-review)                                                                                                | AI 產生的 code 是否有 hallucinated imports、stale APIs 或品質問題？ | 它把模型或本地 LLM 放進 code-quality review；ReviewReady 的 readiness 不應依賴模型判斷。              |
| AI review containment       | [JPHutchins code-review spec](https://github.com/JPHutchins/code-review/blob/main/SPEC.md)、[reviewd](https://github.com/simion/reviewd)                         | 如何讓 AI 讀取不可信 PR、產生 review 並限制寫入權限？               | Threat model 高度相關；ReviewReady 的產品邊界更早，先驗證 evidence 是否可供人 review。                |
| AI review gate              | [Codex Review Gate](https://github.com/JoeyTeng/codex-review-gate-action)、[Plumbline Gate](https://github.com/marketplace/actions/plumbline-gate)               | AI review 結果是否可被綁定到 head、解讀或導向 gate？                | 可作為相鄰設計比較；模型輸出仍是它們流程中的輸入，不能成為 ReviewReady readiness authority。          |
| Prompt / agent safety       | [GuardVibe](https://github.com/goklab/guardvibe)、[AgentTrust](https://github.com/chenglin1112/AgentTrust)、[Gortex](https://github.com/zzet/gortex)             | prompt、tool capability、agent action 或 code context 是否受控？    | 是 AI-1 的鄰接領域；ReviewReady 應分析與 PR trust 相關的 source/prompt/sink，不做通用 agent runtime。 |

### 2.1 GitHub 原生權威：必要但不完整

GitHub rulesets 是 branch、tag 與 merge 行為的正式控制面，能要求 pull
request、review、status checks、path 等條件，也能設定 bypass actor。這些
規則是 ReviewReady 必須尊重的外部 authority；ReviewReady 自己報告的
ready 不應被描述成 GitHub 的 merge approval。

GitHub 的安全文件同時指出，pull_request_target 或 workflow_run 若
checkout 不可信 PR，會暴露 privileged token、cache 或 secrets；第三方
Actions 最好 pin 到完整 commit SHA。這直接支持 ReviewReady 的核心不變量：
讀取 PR metadata 不等於可以執行 PR code，檢查 workflow 的存在不等於
workflow root 已被保護。

來源：[GitHub Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)。

### 2.2 PR 規範與 approval 工具：功能多，但 trust proof 不是同一件事

Danger JS 的定位是讓團隊把 review convention 寫成 CI 後的自動化規則；
Mergeable 著重 PR inbox、條件與 workflow；policy-bot 則把複雜 approval
policy 轉成 status check。這些工具證明「PR metadata 可以被政策化」已有
成熟需求，但它們的核心問題不同。

policy-bot 的公開安全說明特別有價值：status 可能被有寫入權限的使用者
覆寫，comment 編輯與 commit identity 也可能造成時間或歸屬問題。這些已知
限制不是要我們複製 policy-bot，而是提醒我們：

- provider identity 要明確綁定，不能只比對 check name；
- review、status、comment 與 PR metadata 要在一致 snapshot 中判定；
- 既有成功不能掩蓋更新後的 failure、pending 或 ambiguity；
- external authority 的缺失要報告為 incomplete，而不是猜測通過。

來源：[policy-bot README 與 Security 說明](https://github.com/palantir/policy-bot)、
[Danger JS](https://github.com/danger/danger-js)、
[Mergeable 文件](https://mergeable.readthedocs.io/en/latest/)。

### 2.3 Security、workflow 與 provenance 工具：應整合，不應冒充 readiness

Scorecard 以 security health metrics 評估 open-source best practices；
Allstar 以 GitHub App 持續監控 policy violation；zizmor 做 CI/CD
static analysis；CodeQL Action 執行 CodeQL 或上傳 SARIF；SLSA 與
actions/attest 讓 artifact digest、predicate 與簽章有可驗證的供應鏈
語意。

這些能力對 ReviewReady 很重要，但它們回答的是「安全姿態或 artifact
provenance 如何改善」，不是「這個 PR 是否已準備好消耗人類 review 時間」。
最好的產品策略是：

- 不重新實作已有的 scanner；
- 在 audit 或 future evidence bundle 中清楚引用其結果與 provenance；
- 不把 scanner 的 PASS、artifact 簽章或 aggregate score 直接轉成
  readiness；
- 對每個外部結果保存 source、revision、provider、時間與不完整狀態。

來源：[OpenSSF Scorecard](https://github.com/ossf/scorecard)、
[Allstar](https://github.com/ossf/allstar)、
[zizmor](https://github.com/zizmorcore/zizmor)、
[CodeQL Action](https://github.com/github/codeql-action)、
[SLSA](https://slsa.dev/)、
[actions/attest](https://github.com/actions/attest)。

### 2.4 AI code review 與 agent safety：最容易誤入的重疊區

Open Code Review 將 hallucinated package、stale API 與 AI-generated code
quality 放進 CLI、MCP 與 CI；reviewd 讓 Claude、Gemini 或 Codex CLI 讀取
PR 並發布 review；Codex Review Gate 把 Codex 結果綁定到 current head；
Plumbline Gate 將 proof receipt、deterministic checks 與 semantic review
組合。這些專案說明市場確實在處理 AI 產生 PR 的新風險，但也顯示不同
產品選擇：

- 模型可以用來找 code quality finding；
- 模型輸出可以被安全地限制在 advisory review；
- gate 可以驗證模型結果是否對應 current head；
- 但「模型說 clean」不等於 deterministic readiness。

JPHutchins 的 normative spec 更直接地把 agentic review 拆成
orchestrator、reviewer 與 commenter，要求讀不可信內容的角色沒有
write credential，能寫入的角色不持有 model key，也不執行被審查的變更。
這與 ReviewReady 的安全直覺高度相容；差異在於該 spec 的核心交付物是
AI review，而 ReviewReady 的核心交付物是人類 review 前的 evidence gate。

GuardVibe 將 prompt security 與幻覺套件偵測前移到 code generation 前；
AgentTrust 以 rule engine、risk chain 與可選 LLM judge 做 agent action
interception；Gortex 提供 local graph-based code intelligence。它們可作為
AI-1 的威脅來源與互補工具，但不能把通用 agent safety 擴張成 ReviewReady
的 readiness 職責。

來源：[Open Code Review](https://github.com/raye-deng/open-code-review)、
[reviewd](https://github.com/simion/reviewd)、
[JPHutchins code-review spec](https://github.com/JPHutchins/code-review/blob/main/SPEC.md)、
[Codex Review Gate](https://github.com/JoeyTeng/codex-review-gate-action)、
[Plumbline Gate](https://github.com/marketplace/actions/plumbline-gate)、
[GuardVibe](https://github.com/goklab/guardvibe)、
[AgentTrust](https://github.com/chenglin1112/AgentTrust)、
[Gortex](https://github.com/zzet/gortex)。

## 3. ReviewReady 的可 defend 差異化

### 已有相鄰工具的能力

相鄰專案已經證明以下問題有市場與技術解法：

- policy-as-code 可以檢查 PR metadata、reviewer、path 或 branch；
- security tooling 可以檢查 workflow、dependency、permissions 與 provenance；
- AI review 可以被限制在 read-only、advisory 或 head-bound flow；
- artifact 可以透過 digest、attestation 與 SLSA 語意驗證；
- maintainer workflow 可以用 status、comment、issue 或 dashboard 降低負擔。

ReviewReady 不需要再證明這些基本命題。

### ReviewReady 的窄而深核心

ReviewReady 的差異化應集中在一個可驗證的交叉點：

1. **Evidence before review**：它不是判斷 code 正確，而是判斷是否值得開始
   人類 review。
2. **Base-revision policy binding**：有效 policy 從 base revision 取得，不採用
   PR head 可能偷偷改寫的 policy。
3. **Coherent snapshot**：PR identity、base/head、changed paths、checks、
   legacy statuses、reviews、linked issues 與 visible evidence 不可任意拼接。
4. **Provider-aware conservative reduction**：同名 check 的 provider ambiguity、
   latest status、review freshness、permission association 與 rename/path
   語意都要保守處理。
5. **Bounded and fail-closed**：pagination、retry、response、text、count、
   parser 與 deadline 有上限；資料缺失、超限、過期或無法歸屬時不能猜成
   ready。
6. **No PR execution**：不 checkout、import、build、cache restore 或執行
   pull request 送入的程式碼來取得 authority。
7. **Stable public contract**：v1 readiness JSON 與 exit code 穩定，audit
   report / evidence bundle 與 readiness 結果分離。

這個定位可以與 GitHub rulesets、Scorecard、zizmor、AI reviewer 與
attestation 串接，卻不需要宣稱取代它們。

## 4. 目前進度診斷

本節與其中的版本、採用數據及 repository state 都是 **2026-08-16 的研究
快照**，不是今日 live status。跨 local、release、npm 與 GitHub 的最新狀態
以 [current-status](../current-status.md) 為準；研究文件保留當時觀察，不回填
成後來的版本。

### 技術信任核心：強

從 repository 的 product spec、architecture、tests、release evidence 與
目前 branch 可確認，ReviewReady 已經把主要 v1 風險具體化：

- deterministic CLI 與 Action，不使用 LLM 決定 readiness；
- policy 從 base revision 載入；
- coherent PR snapshot 與 post-evidence recheck；
- latest Check Run / legacy status 的保守聚合；
- 同名 check 的 provider identity 與 ambiguity；
- review 的 APPROVED、COMMENTED、CHANGES_REQUESTED、DISMISSED 與
  reviewer association；
- Markdown heading、fence、task list 與 visible evidence parsing；
- POSIX path、rename old/new path、glob 與 traversal 邊界；
- bounded pagination、retry、response size、text size、count 與 deadline；
- public JSON compatibility、CLI exit code、Action bundle 與 dist parity；
- read-only audit、exact revision policy/workflow read、offline replay 與
  不執行 workflow source 的限制。

截至該研究快照，本地最近一次完整 gate 的結果是 847 tests passed、6
skipped；這是 repository validation evidence，不是外部採用證據。

### Trusted root 與外部權威：仍有明確邊界

TA-3 的 trusted-ingress library contract 已進入 main，但這不等於已有
production HTTPS service、durable replay store、secret manager、live
GitHub App enforcement 或經外部 authority 驗證的 webhook deployment。

目前仍應把下列事情當成不同層次：

- 已完成的 library、fixtures、schema、offline replay；
- 已提交但尚未被外部設定證明的 workflow/reference；
- 只有在真實部署與 live run 後才能宣稱的 provider、ruleset、bypass、
  replay 與 idempotency authority。

這個界線正是 #78 與 #79 的價值：不是阻止產品前進，而是防止文件把契約
誤寫成已上線的信任根。

### 公開分發與證據表面：中等，且是近期最高 ROI

在 2026-08-16 研究快照中，local origin/main 與 package metadata 是
v1.0.10；repository 的
published README、Action ref、schema、tag、GitHub Release、npm tarball
與 dist 仍需要在每次 release 以同一個 canonical revision 重新核對。
README 也保留部分歷史 v1.0.6/v1.0.7 reference，這是不可改寫已發布 bytes
造成的真實相容性問題，不應被 marketing 文字掩蓋。

本次公開頁面抓取與 local Git ref 的版本文字也出現不同步風險。這不應被
猜測性地解釋成哪一邊「才是真的」；正確處理方式是把 registry、default
branch、tag、release、Action ref 與 tarball 放進同一次 release verification，
並保存 snapshot date 與 digest。這正是 #28/#60 必須完成的問題。

### 生態採用訊號：低，但可以誠實補強

截至 2026-08-16 的既有研究快照：

- GitHub：1 star、0 fork、8 個 open issues；
- npm：@ahoooooo/reviewready 在 2026-07-17 至 2026-08-15 有 1,460 次下載；
- 維護：近期仍有公開 PR、release 與 CI activity；
- contributor：目前是小型維護者群。

這些資料只能支持「有公開發布與維護活動」，不能支持 broad adoption、
unique users 或 production authority。OpenAI 的公開條件允許用 clear
ecosystem importance 解釋非典型規模，因此補強方向應是：

- 讓 AI-generated PR 與 poisoned/mutable CI evidence 的問題一看就懂；
- 用 reproducible fixtures 證明 false-ready 會被拒絕；
- 讓 ReviewReady 自己產生可公開檢查的 dogfood evidence；
- 若有人同意，才增加一個真實 external pilot；
- 維持下載、stars、forks 與 pilot 的語意分離。

## 5. 提升獎勵申請可信度的升級路線

既有
[post-v1 execution plan](../exec-plans/active/post-v1.md) 的技術順序仍然
有效：PL-0 → TA-1 → TA-2 → TA-3 → AI-1 → V2-1 → AD-1。本研究不以獎勵
申請為理由跳過安全 gate，也不把 application proof 與 product readiness
混成一件事。

### 第一優先：建立 public proof path

這是最值得優先完成的公開可信度升級：

1. 固定一個 canonical commit，讓 source、package、Action dist、schema、
   README、tag、GitHub Release 與 npm tarball 都能追溯到它。
2. 把 #28 的 npm CLI surface 縮到可理解、可重現、可 clean-room install
   的程度；package 內不應出現只有 repository 才存在的假路徑或未打包
   的 map/reference。
3. 以 #60 完成 release parity、GitHub release immutability、stable Action
   ref、provenance 與歷史版本邊界的明確說明。
4. 提供一個不用 secrets 的短 demo：一個 ready fixture、一個 not-ready
   fixture、一個 invalid/incomplete fixture，展示文字結果、JSON shape 與
   exit code。
5. 把每次 evidence snapshot 的日期、revision、digest 與不可宣稱事項留在
   release evidence，而不是只放一個綠色 badge。

這組工作比新增 dashboard 或模型功能更能讓外部審查者確認「它真的能被
maintainer 使用」。

### 第二優先：完成 AI-1 的差異化設計，但保持 deterministic authority

AI-1 應該回答「AI workflow 的 prompt injection、source-to-prompt、prompt-
to-script、secret/token/shell/deploy sink 如何被檢查」，而不是做通用
AI code review。

建議的設計方向：

- 將 source、prompt、sink、capability、execution context 與 trust boundary
  分開；
- 把 zizmor、CodeQL、GuardVibe、AgentTrust 與 JPHutchins spec 的已知能力
  當作比較基線，不複製其完整產品；
- 先採 bounded corpus、synthetic fixtures、false-positive cases 與
  deterministic report；
- AI 只能協助提出候選 threat 或研究摘要，不能決定 audit pass 或 PR
  readiness；
- 明確區分 prompt injection、code execution、permission escalation、
  secret exfiltration 與一般 code-quality defect。

這能把 ReviewReady 從「又一個 PR policy checker」升級成
「AI 時代 merge-trust 的證據前置層」，同時不破壞 v1 的信任根。

### 第三優先：把 V2-1 做成可遷移的 identity/provenance contract

V2-1 的 authenticated attestation provenance 與 unmatched-change semantics
不是用來增加表面輸出，而是補足兩個根本問題：

- 一個 evidence 到底是由哪個 provider、哪個 revision、哪個 workflow
  instance 產生？
- 變更沒有匹配 policy rule 時，v1 相容行為與未來更嚴格行為如何共存？

任何新 public JSON 都必須有版本化、相容、可 replay 的 migration path；
不可為了讓報告看起來完整而把未知資料填成通過。

### 第四優先：用真實但不誇大的 adoption proof 收尾

AD-1 的正確順序是 #28 → #60 → #61：

- 先讓別人能可靠安裝與理解；
- 再確保 npm、GitHub、Action 與 release 完全一致；
- 最後才邀請一個明確同意的外部 repository 做 pilot。

如果沒有外部 repository，應公開記錄 ReviewReady 自己的 dogfood，以及
限制為「self-dogfood / synthetic fixture」；不能用自己的使用紀錄冒充
第三方採用。

## 6. 成本效益與停止條件

本案不需要先購買雲端服務、hosted dashboard 或昂貴基礎設施才能改善
申請。對目前規模，最有效的免費路線是：

- public repository 的 deterministic tests；
- offline fixtures 與 replay；
- npm clean-room package proof；
- GitHub-hosted CI；
- documented release evidence；
- 一個自我 dogfood 及最多一個 consented pilot。

TA-3 的 durable service、secret rotation、live App enforcement 只有在真實
adopter 或明確部署需求出現時才值得擴張。否則保持 library contract、
offline evidence 與外部邊界的誠實標示，反而比做一個沒有權威控制的 demo
service 更安全。

研究在以下條件達成時停止，而不是因為文件變長：

- 沒有尚未解決、能改變升級順序的重大來源衝突；
- 最強的反方主張「這只是另一個 AI reviewer / prototype」已用公開可重現
  證據回答；
- 每一項重要主張都能追到 source、local revision 或明確的未知；
- 剩餘工作已轉成 product execution issue 或外部 authority action；
- 新增來源只會重複已知事實，不會改變決策。

## 7. 最終判斷

ReviewReady 目前已經是一個技術上有清楚信任模型、測試與公開契約的
early-stage deterministic project；它還不是有廣泛採用、已完成 production
trusted root、或能宣稱「世界最全面」的產品。

若目標是提高 Codex for Open Source 的獲選機率，最強的可辯護敘事是：

> AI 讓 PR 產生速度變快，但也讓「模型說可以」與「CI 有一個綠色 check」
> 更不足以成為 merge trust。ReviewReady 用不依賴模型的、可重播且
> fail-closed 的 evidence layer，先確認變更是否具有人類 review 所需的
> 可信前提，再把 correctness 與 merge authority 留給測試、reviewer 與
> GitHub 原生控制。

這個敘事成立的必要條件不是星數，而是 public proof path、release parity、
AI-1 的邊界設計與誠實的 adoption wording。下一個技術差異化節點仍是
AI-1；下一個最能提升外部可信度的公開交付則是 #28/#60 所代表的
reproducible release proof。兩者不可混為同一個 readiness verdict。

## 來源與研究邊界

### 官方與平台來源

- [OpenAI Codex for Open Source](https://openai.com/form/codex-for-oss/)
- [OpenAI Codex for Open Source Developers page](https://developers.openai.com/community/codex-for-oss)
- [GitHub About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [GitHub Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)

### PR policy 與 review

- [Danger JS](https://github.com/danger/danger-js)
- [Mergeable documentation](https://mergeable.readthedocs.io/en/latest/)
- [Palantir policy-bot](https://github.com/palantir/policy-bot)
- [JPHutchins safe agentic code review spec](https://github.com/JPHutchins/code-review/blob/main/SPEC.md)
- [reviewd](https://github.com/simion/reviewd)
- [Codex Review Gate](https://github.com/JoeyTeng/codex-review-gate-action)
- [Plumbline Gate](https://github.com/marketplace/actions/plumbline-gate)

### Security、AI safety 與 provenance

- [OpenSSF Scorecard](https://github.com/ossf/scorecard)
- [OpenSSF Allstar](https://github.com/ossf/allstar)
- [zizmor](https://github.com/zizmorcore/zizmor)
- [GitHub CodeQL Action](https://github.com/github/codeql-action)
- [GitHub actions/attest](https://github.com/actions/attest)
- [SLSA](https://slsa.dev/)
- [Open Code Review](https://github.com/raye-deng/open-code-review)
- [GuardVibe](https://github.com/goklab/guardvibe)
- [AgentTrust](https://github.com/chenglin1112/AgentTrust)
- [Gortex](https://github.com/zzet/gortex)

### 本地 repository sources

- [README.md](../../README.md)：目前公開定位、版本與已知邊界。
- [docs/product-spec.md](../product-spec.md)：v1 行為與非目標。
- [docs/architecture.md](../architecture.md)：trust boundary 與模組規則。
- [docs/exec-plans/active/post-v1.md](../exec-plans/active/post-v1.md)：固定節點順序。
- [docs/research/openai-oss-reward-strategy.md](openai-oss-reward-strategy.md)：先前的申請策略與公開 snapshot。
- [docs/research/deep-research-process.md](deep-research-process.md)：本研究採用的方法。
