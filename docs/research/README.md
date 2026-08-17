# ReviewReady research index

這個目錄保存 ReviewReady 的研究材料。分類以研究目的為準，而不是把每份
文件拆成無意義的欄位或重複副本。現有根目錄檔案路徑保留，以免破壞既有
文件、issue 與 PR 的連結；本頁是它們的正式分類索引。

## 分類

### 升級編排

- [Open-source upgrade lifecycle](../oss-upgrade-process.md)

  將基底對抗流程、深度研究、post-v1 節點、實作驗證、Git 整合、release
  parity 與 dogfood／採用證據串成可重複的端到端升級循環；它不改變 readiness
  contract，也不授予 LLM 或研究文件外部權威。

### 方法

- [Deep research process](deep-research-process.md)

  研究產品、威脅模型、同領域專案與獎勵策略時使用的抽象流程：固定問題
  與證據邊界，批次攻擊獨立角度，保留反證，分開 observation、inference
  與 recommendation，直到剩餘問題屬於外部權威或產品 execution。

### 策略

- [OpenAI OSS reward strategy](openai-oss-reward-strategy.md)

  針對 Codex for Open Source 申請的官方條件、目前公開訊號、申請敘事、
  不應宣稱的 adoption evidence 與 no-cost priority。

### Landscape 與升級

- [Open-source trust landscape and reward upgrade](open-source-landscape-and-reward-upgrade.md)

  本輪深度研究成果：比較 GitHub rulesets、PR policy、security/provenance、
  AI review 與 agent safety 專案，診斷 ReviewReady 的技術與公開證據成熟度，
  並把升級順序接到 post-v1 execution plan。

### 認證與發布

- [GitHub and npm auth architecture](github-npm-auth-architecture.md)

  研究跨專案 GitHub keyring、npm Trusted Publishing、OIDC、token 風險與
  release environment 的取捨；把一次性登入與長期自動發布的邊界分開。

## 研究資料的共同規則

- 每個外部事實都要保留來源連結與研究日期。
- 專案 README 的自述是觀察，不自動等於第三方證據。
- npm downloads、stars、forks、contributors、pilot 與 production authority
  必須使用不同語意，不能互相冒充。
- 研究結論不能改寫 deterministic readiness，也不能讓 LLM 取得 readiness
  authority。
- 研究文件不取代 executable tests、release evidence、GitHub rulesets 或
  其他外部權威。

## 關聯的執行資料

- [Current project status](../current-status.md)：跨 local、release、npm、GitHub
  與文件狀態的唯一索引；外部 provider 狀態必須附驗證時間與 evidence class。
- [Post-v1 execution plan](../exec-plans/active/post-v1.md)：固定的
  PL-0 → TA-1 → TA-2 → TA-3 → AI-1 → V2-1 → AD-1 節點順序。
- [Product spec](../product-spec.md)：v1 行為與非目標。
- [Architecture](../architecture.md)：trust boundary、輸入與模組責任。
- [Release evidence](../release-evidence-v1.md)：歷史 release candidate
  與證據邊界，不把歷史記錄當成目前 live authority。
