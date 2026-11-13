# Codechuman for VS Code

Early, **partial** implementation of [Codechuman IDE #28](https://github.com/bemulima/learning-platform-business/issues/28).

## Implemented in this slice

- A dedicated React webview in the VS Code sidebar (not copied from Next.js).
- A configurable CLI path and workspace root (`~/.codechuman` by default).
- Local checkout listing via `codechuman list --root <path>`.
- Opening an already downloaded task in VS Code.
- Reading cached lesson, task, example files and quiz JSON in the sidebar.
  Files are path-allowlisted, size-bounded and cannot follow symlinks outside
  the local learning cache. Quiz display is read-only, not a scored quiz yet.
- Deterministic JavaScript syntax checks via `codechuman validate-js` and
  explicitly requested public tests via `codechuman validate-public-js`.
- Safe message routing: the webview cannot execute arbitrary shell commands.
- Native Codechuman account sign-in using the existing student Gateway HTTPS
  `POST /api/auth/v1/auth/signin` and refresh endpoint. Access/refresh tokens
  are kept in VS Code `SecretStorage` (partitioned by Gateway origin); the
  password is never saved. Sign-out removes local credentials, even offline.
- Preview command to download an existing TaskInstance through
  `codechuman checkout-remote`. The token is delivered to the CLI through
  stdin, not a shell command, environment variable, or Git remote URL.
- Manual **Sync Active File to Sandbox** command. It resolves the open file
  against the locally cached task manifest (not a webview-supplied sandbox ID),
  then uses existing `ms-gateway` → `ms-go-sandbox` REST endpoints to create or
  update its current text. It requires a server ACK with a workspace revision;
  when atomic workspace is enabled it also sends `Idempotency-Key` and the
  current `X-Sandbox-Fence-Epoch`, and rejects fence conflicts. No Git push.
- Explicitly enabled **auto-sync** for a task. Every editor change is
  debounced by one second, coalesced to its newest buffer and serialized per
  Sandbox; only acknowledged revisions are reported. The mode requires an
  initial **manual, fenced** sync and checks that the server's current fence
  still equals the last acknowledged fence before every write. On drift,
  conflict, offline failure or missing atomic fence, it halts and does not
  blindly retry. Local unsent changes remain in the editor.
- **Sandbox validator diagnostics:** when an acknowledged Sandbox file update
  includes a `validation_result` for that same `workspaceRevision`, the VS Code
  sidebar shows the bounded error list. Existing local lesson files with safe
  paths also receive VS Code **Problems** diagnostics at their reported
  line/column. Stale validator events from another revision are ignored;
  missing validation events are shown as **not run**, never as PASS.
- Security-sensitive settings (`apiBaseUrl`, `cliPath`, `workspaceRoot`) are
  **user-level settings only**; a cloned lesson's `.vscode/settings.json`
  cannot redirect credentials or override the executable.

**Not yet implemented:** Browser/OAuth-only account pairing, Course/Student
lesson selection, the *server-side* Sandbox Git HTTPS export (preview checkout
currently receives HTTP 404 until deployed), cross-device reconciliation,
conflict-free legacy auto-sync, teacher chat via
Dialog/AI Prompt, official Practice Submit, and the complete acceptance suite.
The teacher view explicitly labels missing integration instead of inventing
AI responses. A student's account can sign in only when its existing Auth
account supports email/password.

Public tests run JavaScript on the student's computer under their own OS
account. Students should run only trusted lesson tests; this is not a sandbox.

## Build and test

Requires Node.js and npm for **development only**.

```sh
npm ci
npm test
npm run typecheck
npm run package:vsix
```

The generated `codechuman-vscode-*.vsix` can be installed with **Extensions →
Install from VSIX**. A Marketplace account is not required. The user must
separately install the development version of `codechuman-cli`, until the release
packaging step adds a verified binary installer.

## Sign-in and preview remote checkout

1. In **User Settings**, set `Codechuman: API Base Url` to the HTTPS **origin**
   of the already deployed Codechuman Gateway (for example
   `https://learn.example.org`, without any `/api` suffix). Keep this setting
   out of project/workspace settings.
2. Run **Codechuman: Sign In** in the Command Palette, or open the sidebar and
   choose **Sign in**. The extension prompts for the account's email/password
   using VS Code native input dialogs; nothing is typed into the webview.
3. Once the server implements `POST /api/v1/ide/checkouts` and task-scoped
   Git HTTPS export, use **Codechuman: Checkout TaskInstance (Preview)** with
   the UUID of an already started practice task. It will call the CLI, clone
   immutable starter files, and keep cached lesson materials in the configurable
   `~/.codechuman` workspace. This is not yet end-to-end operational.
4. Open a cached task's source file, edit it, and choose **Codechuman: Sync
   Active File to Sandbox (Manual)**. This sends the **current editor buffer**,
   even if it has not been saved. The request goes directly to the existing
   `/api/sandbox/v1/sandboxes/{sandboxId}/files` route, scoped to the signed-in
   student and the local manifest. The extension reports the server's confirmed
   workspace revision. If the server runs in legacy mode without atomic fencing,
   it warns that concurrent browser/IDE updates can overwrite each other.
5. For tasks with **atomic Sandbox fencing enabled**, a successful manual
   sync establishes the initial revision/fence baseline. Run **Codechuman:
   Enable Auto Sync for Active Task**. Changes made *after enabling* are sent
   after 1 second without Git commits or AI calls. Changes to several files
   are sent serially; if the browser or another IDE updates the Sandbox, auto
   sync stops before overwriting those changes. Use **Codechuman: Disable All
   Auto Sync**, reconcile locally, and perform a new explicit manual sync
   before enabling again. Signing out also disables all auto-sync queues.

**Auto-sync intentionally does not run on legacy Sandbox workspaces** without
an atomic fence. They still support manual sync (with an explicit concurrency
warning). This restriction can be revisited only after a safe multi-writer
contract and recovery behavior are available.

Neither sync mode marks a lesson complete, runs the official validator, or
invokes the AI Teacher. Neither depends on AI credits. Full multi-device
reconciliation and Teacher code-context reads are later slices.

Sandbox may invoke its existing deterministic validation pipeline after a
file mutation. Only such *already returned* validation events are displayed;
this extension does not launch another AI or official Practice validation run.

The extension itself does not call third-party AI providers. The planned AI
teacher continues through Codechuman's own AI Prompt/Dialog services, with
`PLATFORM_SPONSORED` as the default funding mode.

This source currently has no open-source license grant; its public availability
does not authorize redistribution or relicensing.
