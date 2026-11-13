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

**Not yet implemented:** Codechuman account login, Course/Student lesson selection,
the Sandbox Git HTTPS export, live file sync, teacher chat via Dialog/AI Prompt,
official Practice Submit, and the complete acceptance suite. The teacher view
explicitly labels this missing integration instead of inventing AI responses.

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

This source currently has no open-source license grant; its public availability
does not authorize redistribution or relicensing.
