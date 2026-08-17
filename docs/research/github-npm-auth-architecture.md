# GitHub 與 npm 認證架構研究

## 研究邊界

- 研究日期：2026-08-17
- 研究問題：ReviewReady 及其他由同一位維護者管理的專案，如何讓 AI
  在不反覆登入、不保存長期高權限 token 的情況下，安全執行日常 Git
  操作與 npm 發布。
- 研究範圍：GitHub CLI、Git credential manager、npm CLI、npm
  Trusted Publishing、GitHub Actions release workflow。
- 非目標：改變 ReviewReady 的 readiness contract、讓 LLM 成為
  readiness 或 merge authority、移除 GitHub 的必要保護。
- 觀察邊界：本機工作區與 2026-08-17 的 GitHub/npm 公開狀態。平台設定
  可能在下一輪研究中改變，不能把本文件的 live observation 當成永久事實。

## 凍結的現況

本機 ReviewReady 工作區的 package.json 為 1.0.11，release workflow
已經具備：

- GitHub-hosted runner 與 Node 24；
- id-token: write；
- release environment；
- 直接發布已審核 tarball；
- npm provenance、integrity、shasum、clean-room install 與 GitHub
  release/tag 的後續驗證；
- 沒有 NPM_TOKEN 或 NODE_AUTH_TOKEN。

GitHub CLI 顯示帳號已登入且憑證位於 Windows keyring；HTTPS remote 的
唯讀 git ls-remote 也成功。這表示 GitHub 認證已達到跨 repository
共用的本機狀態，不需要為每個專案重新登入。

npm 公開 registry 的 @ahoooooo/reviewready latest 為 1.0.11；本次設定
驗證期間 npm whoami 能辨識維護者帳號，帳戶 2FA 為 auth-and-writes，且
信箱已驗證。這個本機 session 只用於一次性外部設定，不是發布信任根；
完成後會移除，之後本機 npm whoami 預期為未登入。

GitHub release environment 目前限制在 protected branches，並設有
required reviewer；repository 也有 active 的 main branch ruleset。這
是發布的外部保護，不應因為希望少一次提示就移除。

## 方案攻擊

### GitHub

長期把 GH_TOKEN、GITHUB_TOKEN 或 PAT 放入環境變數會繞過 keyring，
增加 shell、log、子程序與錯誤訊息洩漏的風險。SSH key 可以讓 Git fetch
或 push 持久化，但不能完整取代 GitHub CLI 的 API 認證與 repository
操作。

GitHub CLI 的 browser login 預設會把 token 存入系統 credential store；
insecure-storage 則明確是較弱的純文字 fallback。ReviewReady 使用
Windows keyring 加 Git Credential Manager，涵蓋多個 repository，且不
把秘密寫入專案或 persistent environment，因此是本機 GitHub 的首選。

### npm

本機 npm login 或 granular write token 都是 bearer credential。granular
token 可以縮小 package scope、權限與有效期限，但仍可能被複製、需要
輪替；啟用 bypass 2FA 時還會降低帳號層級的保護。把它放在 repository
secret 也會使 workflow 的信任面變成可重放的秘密。

npm Trusted Publishing 使用 GitHub Actions OIDC，把信任限制在 package、
repository、workflow filename 與可選的 environment，執行時才交換
短效憑證。它不需要長期 npm token，並在公開 package 的 GitHub Actions
發布時產生 provenance。這直接消除了目前本機失效 token 的長期維護
問題。

Staged publishing 的安全性更高，因為發布後仍需維護者批准；但它與
AI 在完成所有 deterministic gates 後自動發布的目標衝突。對 ReviewReady，
直接 Trusted Publishing 加上 GitHub release environment required reviewer、
protected main、immutable release/tag 檢查，是目前安全與自動化之間最
合理的平衡。若未來決定移除 reviewer，那是明確的安全降級，不是認證
最佳化。

## 決策

1. GitHub：維持 browser login + Windows keyring + Git Credential Manager。
   不使用 insecure-storage，不把 token 寫入 PATH、repository、腳本
   或永久環境變數。
2. npm：使用 Trusted Publishing，綁定：
   @ahoooooo/reviewready、ahoooooooo/reviewready、
   .github/workflows/release-publish.yml、release environment，並
   只允許 npm publish。
3. npm package 已設定為 Require two-factor authentication and disallow
   tokens。這不會阻止 OIDC publisher，但會阻止傳統 token 進行 package
   publish；本次設定回應為 HTTP 200 且 npm exit code 為 0。
4. 一次性 npm browser login 只用來建立 trust relationship；完成後登出
   並移除本機 npm credential。之後本機 npm whoami 不再是發布健康檢查；
   發布健康檢查改由 GitHub Actions 的 OIDC workflow 與 registry evidence
   完成。
5. AI 可以在已授權的 repository/task scope 內執行例行 commit、push、PR
   更新與通過 gates 的整合流程；它不能繞過 GitHub environment、2FA、
   ruleset、immutable tag 或 npm 的 provider controls。這是維護流程授權，
   不是把 LLM 變成 ReviewReady 的 readiness 或 merge authority。

## 可證偽的完成條件

以下條件區分「外部控制已配置」與「發布證據已完成」：

- npm trust github 的設定與 workflow 完全相符；
- package publishing access 已禁止傳統 token（已完成）；
- 本機 publish credential 已移除；
- 一次受控 release workflow 能以 OIDC 通過，且不需要 NPM_TOKEN；
- provenance 的 workflow、repository、branch 與 release commit 與
  審核 artifact 一致。

目前狀態為「外部控制已配置、v1.0.11 release evidence 已完成」；受控
workflow 已以 OIDC 發布並核對 provenance、exact tarball、GitHub release、
tags 與 clean-room install。這只證明本次發布鏈路，不把一次成功擴張成
永久不變的外部平台保證。

## 主要來源

- GitHub CLI authentication：
  https://cli.github.com/manual/gh_auth_login
- GitHub CLI environment：
  https://cli.github.com/manual/gh_help_environment
- npm Trusted Publishing：
  https://docs.npmjs.com/trusted-publishers/
- npm access tokens：
  https://docs.npmjs.com/about-access-tokens/
- npm publishing access and 2FA：
  https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/
- npm trust CLI：
  https://docs.npmjs.com/cli/v11/commands/npm-trust/

上述官方來源於 2026-08-17 研究；平台頁面與 live 設定需在發布前重新
核對。
