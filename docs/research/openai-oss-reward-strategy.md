# OpenAI Codex for Open Source 獎勵申請與 ReviewReady 提升策略研究

> 研究日期：2026-08-16
>
> 目的：以公開規則與可驗證證據，找出 ReviewReady 提升獲選機率的最高槓桿。
> 本文件不保證獲選，也不把任何推測寫成 OpenAI 的內部評分標準。

## 結論先行

ReviewReady 目前的技術信任核心已經比一般「PR review bot」更嚴謹，但獎勵申請的主要弱點不是再增加功能，而是公開採用證據、競品區隔與 release surface 還不夠強。

最高投資報酬率的順序是：

1. 把產品定位從「另一個 reviewability checker」說清楚為「AI 時代的 deterministic merge-trust / evidence layer」。
2. 把目前已完成的行為整理成五分鐘可重現的 public proof pack：fixtures、輸入、輸出、失敗案例、測試命令與限制。
3. 完成 npm、GitHub、Action、tag、release、schema、README 的同一版本座標一致性。
4. 取得至少一份真實且經同意的外部 OSS pilot evidence；沒有同意就只能標成 self-dogfood，不能冒充外部採用。
5. 以 AI-1 的 bounded workflow-security corpus 強化「AI 時代」差異化，但不把 LLM 放進 readiness 決策。
6. 只有實際需要公開服務時，才考慮 production App、HTTPS 與 durable store；這不是申請開源獎勵的必要前置，也不應為此先花錢。

目前最準確的判斷是：技術可信度強、社群與外部證據仍早期。這是一個可以誠實申請的專案，但還不能宣稱是同領域最全面、最普及或已達 production-authoritative。

## 1. 官方計畫真正看什麼

OpenAI 官方的 [Codex for Open Source](https://developers.openai.com/community/codex-for-oss) 說明，計畫面向 active open-source projects 的 maintainers；考量訊號包括 meaningful usage、broad adoption、ecosystem importance、active maintenance，以及申請者的 maintainer role/permissions。若專案不完全符合前述形狀但對 ecosystem 有重要性，官方仍鼓勵申請並解釋原因。

目前公開的計畫內容包括：

- 六個月 ChatGPT Pro（含 Codex）。
- 對符合條件的 repository 或 maintainer，個案審核的 Codex Security。
- 用於 pull-request review、maintainer automation、release workflow 或其他核心 OSS 工作的 API credits。

申請頁要求公開 GitHub username 與 public repository，並要求說明 primary/core maintainer 角色、repository 為何重要、API credits 的用途；「Why does this repository qualify?」與其他敘述欄位各有 500 字元上限，申請採 rolling review。

官方 [Program Terms](https://learn.chatgpt.com/docs/codex-for-oss-terms) 另外明確指出：

- 申請不保證 selection、funding 或 access。
- OpenAI 可依 repository usage、ecosystem importance、active maintenance、role/permissions 與 program capacity 個案決定。
- 可能要求驗證身份、repository control 或 maintainer status。
- benefits 的範圍、期間與時間可能因申請者、repository 或 use case 而異。
- API credits 與 Codex Security 是額外且可另行審核的 benefit。
- 不應提交機密資料；計畫也不承諾 submission 的保密或排他性。

因此，最有效的策略不是製造 stars，而是讓審查者在公開 repository 中快速看見：

1. 這個問題為什麼會影響 AI 時代的 OSS maintenance。
2. ReviewReady 與既有工具的邊界差異。
3. 目前哪些性質已用 deterministic tests 證明。
4. 哪些部分仍是明確標記的外部 deployment/evidence gap。
5. 申請人確實是 repository 的 primary maintainer，且能負責持續維護。

## 2. 2026-08-16 的公開狀態快照

以下數字是研究時從 GitHub API、npm registry 與 repository 內部驗證結果取得的 snapshot；下載數不是 unique users，也不能直接等同於 broad adoption。
本表只描述 2026-08-16 的歷史觀察；目前跨 surface 狀態請以
[current-status](../current-status.md) 為準。

| 面向              | 可觀察事實                                                                  | 解讀                                                                                                            |
| ----------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Repository        | public、MIT、TypeScript；建立於 2026-07-21                                  | 真正早期專案，不能假裝已有長期社群歷史                                                                          |
| GitHub adoption   | 1 star、0 fork、8 open issues                                               | 外部社群訊號弱，但不是技術品質的反證                                                                            |
| Contributors      | 2 個 contributor identity：主要維護者與 Dependabot                          | 目前是單一主要維護者專案                                                                                        |
| npm               | @ahoooooo/reviewready latest 1.0.10；2026-07-17 至 2026-08-15 下載 1,460 次 | 有 usage signal，但要誠實標成下載量，不宣稱使用者數                                                             |
| Maintenance       | 2026-08-15 仍有 PR #81 合併與 main post-merge checks                        | active maintenance 可以被公開 commit/PR 證明                                                                    |
| Local proof       | full gate 847 passed、6 skipped；coverage 92.48% statements                 | 強的工程證據，但仍是本專案自己的驗證，不是外部採用證據                                                          |
| Current open work | #28、#57、#58、#59、#60、#61、#78、#79                                      | 主要是 package/release、AI-1/V2 design、外部 pilot、TA-3 production/evidence 邊界，不應被描述成 8 個未知 P0 bug |

這個狀態對申請的含義是：

- 「active maintenance」是可信的。
- 「technical seriousness」有相當強的公開材料支撐。
- 「broad adoption」目前不能主張。
- 「clear importance」必須用問題分析、威脅模型、可重現 fixtures 與競品區隔證明，而不是用誇大的市場語句替代。

## 3. 同領域工具地圖

ReviewReady 不應與所有 code-review 工具比較成同一類。真正的比較是「它在哪一層做決策、輸入是否可信、是否會變更 repository、是否宣稱 correctness」。

| 工具/類別                                                                                                                                                           | 主要解決的問題                                                                                                                     | 與 ReviewReady 的重疊                                  | ReviewReady 的差異                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GitHub rulesets / protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) | 原生 merge controls、reviews、status checks、force-push/tag/branch 規則                                                            | 都能成為 merge 前的 gate                               | ReviewReady 將 repository 自訂 evidence policy、資料一致性與 fail-closed 解釋成可測試結果；它不能也不應取代 GitHub authority                                                                            |
| [Danger JS](https://github.com/danger/danger-js)                                                                                                                    | 用程式碼自動化團隊 PR conventions，例如 changelog、ticket、labels、anti-patterns                                                   | 都可檢查 PR metadata                                   | Danger 是跨平台 convention glue；ReviewReady 專注於 evidence identity、最新結果、base policy、permission 與 trust boundary                                                                              |
| [Mergeable](https://mergeable.readthedocs.io/en/latest/)                                                                                                            | YAML validators/actions、labels、comments、approvals、merge automation                                                             | 都是 repository policy-as-code                         | Mergeable 可執行 actions 甚至 merge；ReviewReady 的核心是 read-only、deterministic evidence，並明確不 approve/merge                                                                                     |
| [Palantir policy-bot](https://github.com/palantir/policy-bot)                                                                                                       | GitHub App approval policy、reviewers/teams/branches/status                                                                        | 都會檢查 review/PR 條件                                | policy-bot 主要是 approval authority；ReviewReady 更廣地處理 check/status、body evidence、linked issue、path、provider ambiguity、base/head binding，並保留 human review 與 merge authority             |
| [ReviewGate](https://github.com/leo-aa88/reviewgate)                                                                                                                | deterministic PR intake/reviewability：size、scope、missing context、risky paths、splitability；另有 hosted App/optional LLM layer | 這是最接近的概念競品，兩者都在 human review 前降低浪費 | ReviewGate 的核心問題是「PR 形狀是否值得看」；ReviewReady 的核心問題是「PR 是否提供了 repository policy 要求、且來源可信的 evidence」；ReviewReady 不以 diff size/AI authorship/LLM report 做 readiness |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard)                                                                                                              | 對整個 OSS repository 的 security health heuristics 打 0–10 分                                                                     | 都關心 repository trust                                | Scorecard 是 repository posture score；ReviewReady 是單一 PR 的 change-specific evidence gate，且不把漂亮分數當成通過理由                                                                               |
| [zizmor](https://github.com/zizmorcore/zizmor)                                                                                                                      | GitHub Actions 靜態安全分析、SARIF、template injection/permissions 等 finding                                                      | 都重視 workflow security 且不應執行不可信程式碼        | zizmor 是 workflow static analyzer；ReviewReady 的 AI-1 應分析 source/prompt/sink，但產品主軸仍是 evidence/trust，不複製 zizmor，也不把 scanner finding 直接等同 readiness                              |

### 競品研究的關鍵結論

ReviewReady 不是「世界上唯一的 PR gate」，也不是「比所有工具更全面」。ReviewGate 已經證明「AI 增加 PR 量、需要在人工 review 前做 deterministic intake」是相鄰且公開存在的產品論點。

ReviewReady 可合理主張的差異化較窄、但更可信：

> ReviewReady is a deterministic, provider-aware evidence and trust-boundary layer for GitHub pull requests. It checks whether the evidence required by the base-branch policy exists, is coherent, current, attributable, bounded, and safe to consume before human review. It does not claim code correctness, approve/merge, or execute PR code.

這句話比「最全面的 AI code review」或「世界第一 merge security」更容易被驗證，也不會與 ReviewGate、zizmor、Scorecard、GitHub rulesets 的職責混淆。

## 4. ReviewReady 現在真正有價值的技術差異

### 4.1 它把「evidence」與「correctness」分開

一般 review bot 容易把「看起來合理」與「可以合併」混在一起。ReviewReady 的產品契約更保守：

- readiness 不是 code correctness。
- human attestation 只證明可見文字，不冒充身份、理解或法律責任。
- audit status 不是 readiness result。
- LLM 不決定 readiness。
- 不執行 pull-request 提供的 code、workflow、script 或 dependency。

這個負責任的負面承諾是申請材料的優勢，必須放在 README 開頭而不是埋在安全文件裡。

### 4.2 它處理「證據是否可信」，不只是證據是否存在

目前 v1/TA-2/TA-3 的強點包括：

- policy 從 immutable base revision 載入，而不是從 proposed head 載入。
- PR metadata、paths、labels、events、API response 一律當 untrusted input。
- latest Check Run 與 legacy Commit Status 按 provider/identity 保守聚合；較新的 failure/pending 不能退回舊 success。
- review 的 COMMENTED、CHANGES_REQUESTED、DISMISSED、permission association 與 timestamp 具有明確語義。
- path separator、rename old/new path、glob、traversal、Markdown heading/fence/task-list/visible evidence 都是 bounded parser contract。
- coherent snapshot 重新檢查 base/head/updated-at，避免把不同時間的 PR、checks、reviews 拼成假證據。
- oversized、missing、malformed、ambiguous、incomplete input fail closed。

這些並非「多幾個 checkbox」；它們是在回答「誰能改變這個 evidence、它代表哪個 revision、它是否仍然有效」。

### 4.3 它把 authority 分層，不把 local green 當成 production authority

ReviewReady 已經把下列層次分開：

1. deterministic core：純規則、穩定 JSON、可重播 fixtures。
2. bounded GitHub observation：讀取 API、處理 pagination/retry/size/deadline，輸入不可信。
3. audit/evidence bundle：可離線 replay，但不改寫 readiness contract。
4. trusted ingress/provider authority：App、hook identity、replay/idempotency、SHA binding、durable state 與 live Check Run race。
5. GitHub repository authority：rulesets、required check source、workflow root 與 bypass actor。

目前 TA-3-I 的 in-memory store 是 reference implementation，不是 durable production authority。這種自我限制會降低行銷聲量，但提高安全可信度；申請文件應保留這個界線。

## 5. 目前申請的主要風險

| 風險                          | 審查者可能的疑問                                                     | 最佳修正方向                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| adoption signal 小            | 「只有 1 star、0 fork，是否只是個人 prototype？」                    | 不偽造採用；用清楚的 ecosystem problem、reproducible proof、公開 roadmap、npm download snapshot 與真實 pilot 補強                 |
| 名稱/論點重疊                 | 「ReviewReady 是否只是 ReviewGate 的另一個名字？」                   | 明確承認 ReviewGate，對比 shape/reviewability 與 evidence/trust；不要宣稱唯一                                                     |
| release surface 漂移          | 「npm README、Action ref、tag、GitHub Release 是否一致？」           | 先完成 #28/#60；每次 release 用一個 canonical commit 與可重現 artifact evidence                                                   |
| production authority 過度宣稱 | 「本機 fixture 能否真的阻止危險 merge？」                            | 明確標記 TA-3 local core、live provider race 與 deployment evidence 尚未完成                                                      |
| AI 角色不清                   | 「maintainer 是人還是只是在轉述 AI？」                               | 如實說明申請人是 repository owner/primary maintainer；AI 是 maintainer tool，不是 readiness authority、merge authority 或身份證明 |
| 功能範圍膨脹                  | 「是否同時做 review bot、scanner、audit、AI analyzer、hosted App？」 | 把產品主軸固定在 deterministic trust/evidence layer；AI-1 只做 bounded security analysis，不能變成通用 AI code review             |
| open issues 太多              | 「是不是還有很多未修復問題？」                                       | 將 open work 清楚分成 implementation、design、evidence、accepted boundary；不要為了數字而關閉尚未證明的 issue                     |

## 6. 不花錢的最高槓桿提升計畫

### P0：申請者一眼看懂、且能自行重現

- README 開頭加入一段 30 秒定位：before human review、evidence not correctness、no LLM verdict、no PR code execution。
- 加入一個最小可複製 demo：安裝 npm、執行一個 ready fixture、一個 not-ready fixture、一個 invalid/incomplete fixture，展示 exit code 與 JSON。
- 將「已證明」與「尚待外部證據」放在同一張簡單邊界圖；不要讓讀者必須翻過大量 ADR 才知道產品能做什麼。
- 在 positioning 文件直接連結 ReviewGate、Danger、policy-bot、zizmor、Scorecard 與 GitHub rulesets，說明互補關係。
- 以固定日期記錄 npm downloads、GitHub stars/forks、open issues、release、CI、contributors；每次更新都保留歷史，不回填或美化數據。

### P1：把技術可信度轉成 public proof

- 完成 #28：讓 npm CLI surface、依賴、Node minimum、packed consumer behavior 可觀察且最小。
- 完成 #60：對齊 npm tarball/provenance、Git tag、GitHub Release、stable Action ref、schemas、README、dist 與 source commit。
- 建立一份 machine-readable conformance matrix，至少涵蓋 stale success、duplicate check name、wrong provider、base-policy mutation、review dismissal、rename/traversal、oversize/truncated API、PR code execution prohibition、audit replay。
- 將 full gate 結果與 package smoke 結果綁定到 exact commit；coverage 是輔助訊號，不能單獨當成安全證明。
- 完成 #57 的設計先於 AI analyzer：明確區分 prompt injection、code execution、secret/capability sink、permission escalation、provider provenance 與 unknown。

### P1：取得一份真正的外部 evidence

- 尋找一個願意明確同意的 public OSS maintainer/repository 做 pilot。
- 只記錄 sanitized evidence：版本、policy、事件類型、結果、false positive/negative、限制與撤銷方式；不收集不必要的私人資料。
- 若暫時沒有外部 maintainer，不要冒充 external pilot；先做 self-dogfood，並把它標為 self-use，說明它證明的是可部署性/可重現性，不是 broad adoption。
- 對 OpenAI 申請，外部 pilot 的價值高於再增加一個沒有使用者的表面功能。

### P2：只有有真實需求才做 production trust root

TA-3 的 HTTPS、GitHub App、durable store、secret rotation、live Checks race evidence 會提高 production credibility，但不是開源獎勵申請的必要條件，也不應為了申請先付費。若沒有真實 adopter，先完成 contract、fixtures、offline replay 與文件即可。

## 7. 申請文字建議

以下是可供表單或後續補充使用的英文草稿；提交前仍必須以當時的實際數據與申請人身份校對。三段都刻意控制在 500 字元以內，不宣稱未證明的 adoption 或 authority。

### Why does this repository qualify?

```text
ReviewReady is an active MIT-licensed TypeScript CLI and GitHub Action that deterministically verifies the evidence a pull request must provide before it consumes human review time. It is early-stage but maintained in public, with 1,460 npm downloads in the last 30 days (17 Jul–15 Aug 2026), reproducible tests, bounded GitHub ingestion, replayable audit evidence, and a clear AI-era trust problem: LLMs and mutable CI signals must not decide readiness.
```

### How will you use API credits for your project?

```text
I would use API credits for bounded maintainer workflows: triaging issues, generating adversarial regression candidates, reviewing test and documentation coverage, and preparing reproducible release/audit evidence across the CLI, GitHub Action, and npm package. AI output would remain advisory: it would never decide readiness, approve or merge pull requests, execute pull-request code, or override base-revision policy; deterministic tests and GitHub controls remain authoritative.
```

### Anything else we should know?

```text
ReviewReady is intentionally not an AI code reviewer. It is a deterministic trust/evidence layer between AI-generated changes and human review. Its design separates evidence observation, policy evaluation, and enforcement authority; unknown, stale, ambiguous, or incomplete inputs fail closed. We document both what is proven locally and what still requires external evidence, rather than claiming a passing fixture is production authority.
```

申請欄位的建議：

- Describe your role：選 Primary maintainer 只有在申請人確實是 repository owner/primary maintainer 時使用。
- I’m interested in：API credits for my project 與專案目前最直接吻合；Codex Security 可在仍能如實說明 AI-1 security corpus/use case 時勾選，不要把尚未存在的 analyzer 說成已完成。
- 不要在表單中寫「AI 完成 90%」作為產品價值。這會模糊 maintainer responsibility；正確敘述是 AI 協助 maintenance，但 deterministic tests、policy 與 GitHub controls 保持 authority。

## 8. 申請成功機率的誠實評估

公開資料不足以計算百分比，而且官方明確保留個案裁量。可以做的是分解影響因素：

| 維度         | 目前評估                                                                 | 提升後的目標                                         |
| ------------ | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| 計畫契合度   | 高：active OSS、maintainer automation、PR review/release use case 明確   | 維持，不擴大成泛 AI code review                      |
| 技術可信度   | 高：deterministic contract、bounded input、fail closed、完整 local tests | 用 public proof pack 讓外部讀者容易驗證              |
| 問題重要性   | 中高：AI 生成 PR 與 mutable CI trust 的問題清楚                          | 用威脅模型、競品邊界、真實 failure fixtures 證明     |
| 外部採用     | 低至中：有 1,460 npm downloads，但 1 star、0 fork，且下載不代表使用者    | 一份同意的 external pilot；沒有就誠實標 self-dogfood |
| 維護者可信度 | 中高：公開 owner、密集 PR/issue/release 活動                             | 持續維護、清楚 issue taxonomy、維持 release parity   |
| 申請敘事     | 可申請，但容易被誤認為一般 reviewability tool                            | 明確使用 trust/evidence layer 定位與比較表           |

因此，下一個「獎勵申請最佳節點」不是把所有 production infrastructure 做完，而是：

> #28/#60 release parity + public proof pack + AI-1 design boundary + 一份真實外部 pilot（或明確標示 self-dogfood）+ 誠實的 maintainer/use-case 敘事。

這個節點比新增 UI、LLM verdict、hosted dashboard 或虛構 stars 更能提高可信度，也不需要先投入雲端費用。

## 9. 明確不要做的事

- 不購買或交換 stars、downloads、reviews、contributors 或 testimonials。
- 不把 npm downloads 寫成 unique users、active installations 或 broad adoption。
- 不把 ReviewReady 稱為「世界上最全面」；目前沒有可支持該結論的 benchmark。
- 不把 local in-memory TA-3 store 寫成 production durable authority。
- 不把 GitHub Actions App display name 寫成獨立 provider provenance。
- 不讓 LLM 決定 ready、批准/合併 PR，或替人作出責任/身份聲明。
- 不用 production hosting 或付費資料庫製造不必要成本。
- 不為了讓 issue 數字變好看而關閉 #28、#57–#61、#78、#79；每個 issue 都應保留可驗證的 outcome。

## 10. 建議追蹤的證據

每次公開版本只保留能回答以下問題的證據：

1. 這個版本的 source、npm tarball、Action dist、schema、README、tag、GitHub Release 是否同一個 canonical revision？
2. 攻擊者能否以舊 success、假 check name、錯 provider、變更 policy、rename/traversal、Markdown invisibility 或 truncated API response 騙過 gate？
3. PR 更新、review dismissal、check race、webhook replay、stale result 是否會失效或 fail closed？
4. 任何測試或 audit 是否執行了 PR 提供的程式碼？預期答案必須是沒有。
5. 實際使用者是否同意被記錄為 pilot？若沒有，報告就必須標明 self-use 或 synthetic fixture。
6. 這份結果是 readiness、audit finding、或 external evidence？三者不能混稱。

## 來源

- OpenAI Developers — [Codex for Open Source](https://developers.openai.com/community/codex-for-oss)
- OpenAI / ChatGPT Learn — [Codex for Open Source Program Terms](https://learn.chatgpt.com/docs/codex-for-oss-terms)
- GitHub Docs — [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- GitHub Docs — [Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
- GitHub Docs — [Workflow execution protections](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/actions-policies/workflow-execution-protections)
- GitHub — [Danger JS](https://github.com/danger/danger-js)
- Mergeable — [documentation](https://mergeable.readthedocs.io/en/latest/)
- Palantir — [policy-bot](https://github.com/palantir/policy-bot)
- Leo Araujo — [ReviewGate](https://github.com/leo-aa88/reviewgate)
- OpenSSF — [Scorecard](https://github.com/ossf/scorecard)
- zizmor — [Static analysis for GitHub Actions](https://github.com/zizmorcore/zizmor)
- ReviewReady — [repository](https://github.com/ahoooooooo/reviewready) and [npm package](https://www.npmjs.com/package/@ahoooooo/reviewready)
