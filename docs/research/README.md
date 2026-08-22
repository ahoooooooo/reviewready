# ReviewReady research index

這個目錄保存可重播、可驗證的研究方法與架構決策背景。研究文件不取代產品
contract、executable tests、release evidence、GitHub rulesets 或其他外部權威。

## 方法

- [Deep research process](deep-research-process.md)

  用於外部事實、技術 landscape、adoption 與策略問題：固定問題與證據邊界、
  批次攻擊獨立角度、保留反證，並分開 observation、inference、recommendation
  與 external dependency。

- [Open-source upgrade lifecycle](../oss-upgrade-process.md)

  將對抗開發、深度研究、實作驗證、Git 整合、release parity 與採用證據串成
  可重複的升級循環；它不改變 readiness contract，也不授予 LLM 權威。

## 認證與發布

- [GitHub and npm auth architecture](github-npm-auth-architecture.md)

  說明 GitHub keyring、npm Trusted Publishing、OIDC、token 風險與 release
  environment 的邊界，把一次性登入與長期自動發布分開。

## 共同規則

- 每個外部事實都要保留來源連結、觀察日期、範圍與限制。
- 專案 README 的自述是觀察，不自動等於第三方證據。
- npm downloads、stars、forks、contributors、pilot 與 production authority
  必須使用不同語意，不能互相冒充。
- 研究結論不能改寫 deterministic readiness，也不能讓 LLM 取得 readiness
  authority。
- 針對特定獎勵或申請所寫的宣傳草稿不屬於產品 repository 的 canonical
  documentation；若需要，應由維護者在申請工作區以當時的官方條件重新建立。

## 關聯的執行資料

- [Roadmap](../../ROADMAP.md)：目前產品優先順序與證據邊界。
- [Product spec](../product-spec.md)：v1 行為與非目標。
- [Architecture](../architecture.md)：trust boundary、輸入與模組責任。
- [Release evidence](../release-evidence-v1.md)：歷史 release candidate 與
  證據邊界，不把歷史記錄當成目前 live authority。
