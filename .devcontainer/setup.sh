#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
fixture_root="$repository_root/examples/growth-trial"
trial_root="${repository_root}-growth-trial"
node_major="$(node -p 'process.versions.node.split(".")[0]')"

if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 24 )); then
  printf 'Codespaces preparation requires Node.js 24 or later.\n' >&2
  exit 1
fi

validate_exercise() {
  local exercise_root="$1"
  local relative_file
  local symbolic_link
  if [[ -L "$exercise_root" || ! -d "$exercise_root" ]]; then
    printf 'Unsafe exercise path; left untouched: %s\n' "$exercise_root" >&2
    return 1
  fi
  if [[ "$(cd "$exercise_root" && pwd -P)" != "$exercise_root" ]]; then
    printf 'Exercise paths must not contain symbolic links: %s\n' "$exercise_root" >&2
    return 1
  fi
  for relative_file in package.json src/retry.mjs test/retry.test.mjs; do
    if [[ ! -f "$exercise_root/$relative_file" ]]; then
      printf 'Incomplete exercise; back up and move it before retrying: %s\n' "$exercise_root" >&2
      return 1
    fi
  done
  symbolic_link="$(find "$exercise_root/package.json" "$exercise_root/src" "$exercise_root/test" -type l -print -quit)"
  if [[ -n "$symbolic_link" ]]; then
    printf 'Exercise contains a symbolic link; left untouched: %s\n' "$symbolic_link" >&2
    return 1
  fi
}

validate_exercise "$fixture_root"
if [[ -e "$trial_root" || -L "$trial_root" ]]; then
  validate_exercise "$trial_root"
fi

cd "$repository_root"
npm ci
npm run typecheck
npm run package

if [[ -e "$trial_root" || -L "$trial_root" ]]; then
  validate_exercise "$trial_root"
  printf '\nExisting exercise preserved without overwriting: %s\n' "$trial_root"
else
  mkdir "$trial_root"
  cp "$fixture_root/package.json" "$trial_root/"
  cp -R "$fixture_root/src" "$fixture_root/test" "$trial_root/"
  validate_exercise "$trial_root"
  printf '\nFresh exercise prepared: %s\n' "$trial_root"
fi

printf '\nPreparation finished. Pair has not been installed or enabled.\n'
printf 'From the repository terminal, explicitly install the VSIX:\n  npm run codespaces:install\n'
printf '\nThen use File > Open Folder in the same Codespace to open:\n%s\n' "$trial_root"
printf 'Or explicitly run:\n  code --reuse-window %q\n' "$trial_root"
printf '\nIn the exercise terminal, npm test initially has 2 passing and 4 failing tests.\n'
printf 'Follow docs/growth-preview.md for trust, Enable Presence, Start a Session, and @pair /setup.\n'
