#!/usr/bin/env bash
set -euo pipefail

if [[ "${CODESPACES:-}" != "true" ]]; then
  printf 'Run this installation command in the Codespace terminal, not on your local machine.\n' >&2
  exit 1
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
extension_version="$(node -p 'require(process.argv[1]).version' "$repository_root/apps/vscode-extension/package.json")"
artifact="$repository_root/adaptive-pair-$extension_version-stable.vsix"

if [[ ! -f "$artifact" || -L "$artifact" ]]; then
  printf 'A regular built VSIX is required. Run npm run codespaces:setup in the repository first.\n' >&2
  exit 1
fi
if ! command -v code >/dev/null 2>&1; then
  printf 'The VS Code CLI is unavailable. Open this Codespace in VS Code and use its terminal.\n' >&2
  exit 1
fi

exec code --install-extension "$artifact"
