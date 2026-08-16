# ADR 0012: GitHub 與 npm 的跨專案發布認證

- Status: accepted operational design; npm trust binding pending
- Date: 2026-08-17
- Research: GitHub and npm auth architecture

## Decision

ReviewReady 的本機 GitHub 操作使用 GitHub CLI browser login 儲存在
Windows keyring，並由 Git Credential Manager 提供 HTTPS Git 認證。npm
公開發布使用 GitHub Actions Trusted Publishing 的 OIDC，不使用長期
NPM_TOKEN、NODE_AUTH_TOKEN 或本機 npm publish token。

Trusted Publisher 必須精確綁定 package、repository、workflow filename 與
release environment。GitHub release environment、protected main、active
ruleset 與 immutable release/tag 驗證保留為獨立外部保護。這些保護不能被
AI 或 workflow 以文字、模型輸出或重試繞過。

Trusted Publisher 完成驗證後，npm package 使用 Require two-factor
authentication and disallow tokens。本機的一次性 npm browser login 只
負責建立 trust relationship；之後移除本機 npm credential。Trusted
Publishing 成功的依據是 workflow 的 OIDC、registry provenance 與
release evidence，不是本機 npm whoami。

## Why

GitHub keyring 是跨 repository 的單一本機憑證來源，避免把 token 複製到
每個專案。npm OIDC 則把可發布權限縮到一次 workflow 執行，避免長期 bearer
secret 被複製或忘記輪替。兩者都讓 AI 能執行已授權的維護工作，但不會
改變 ReviewReady 的 deterministic readiness authority。

## Rejected alternatives

- 永久 GH_TOKEN 或 PAT：容易出現在環境、shell、log 或子程序，且權限
  範圍通常比單一 repository 操作更廣。
- 每台電腦保存 npm granular write token：可限縮 scope，但仍是可重放
  的 bearer secret，且有期限與 2FA/bypass 風險。
- 以 SSH key 取代全部 GitHub 認證：適合 Git transport，但不能完整涵蓋
  GitHub CLI API 與 release/environment 操作。
- 直接移除 release reviewer：可減少一次人工互動，但會降低發布保護；
  不是本認證問題的安全修復。
- 把 Trusted Publishing 設成 staged-only：安全性更高，但會把每次發布
  再次變成需要維護者批准的流程；是否採用屬於另外的發布策略決策。

## Non-goals

本 ADR 不授予 ReviewReady、LLM 或 npm workflow 自動判定 PR readiness、
批准或合併的產品權威，也不允許 force-push、刪除 tag/release、修改
ruleset、繞過 2FA 或把秘密寫入 repository。
