#!/usr/bin/env bash
set -euo pipefail

# Install Kitchen into Cursor Cloud Agent discovery paths.
# Prefers this checkout, then a sibling skills checkout, then clones
# ralphbibera/skills. Copies (does not symlink) so plugin loading and
# temporary clones both work.

SKILLS_REPO="${SKILLS_REPO:-ralphbibera/skills}"
PLUGIN_HOME="${CURSOR_PLUGIN_HOME:-$HOME/.cursor/plugins/local/kitchen}"
SKILLS_HOME="${CURSOR_SKILLS_DIR:-$HOME/.cursor/skills}"

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$here/.." && pwd)"

die() {
  printf 'install-kitchen-plugin: %s\n' "$*" >&2
  exit 1
}

is_kitchen() {
  [[ -f "$1/plugin.json" && -d "$1/skills/poteto-mode" ]]
}

copy_tree() {
  local src="$1" dest="$2"
  mkdir -p "$dest"
  tar -C "$src" --exclude=node_modules --exclude=.git -cf - . | tar -C "$dest" -xf -
}

staging="$(mktemp -d)"
trap 'rm -rf -- "$staging"' EXIT

resolve_kitchen() {
  if [[ -n "${1:-}" ]]; then
    is_kitchen "$1" || die "not a Kitchen plugin directory: $1"
    (cd "$1" && pwd)
    return
  fi
  if [[ -n "${KITCHEN_PLUGIN_DIR:-}" ]]; then
    is_kitchen "$KITCHEN_PLUGIN_DIR" || die "KITCHEN_PLUGIN_DIR is not a Kitchen plugin directory"
    (cd "$KITCHEN_PLUGIN_DIR" && pwd)
    return
  fi
  if is_kitchen "$repo_root/plugins/kitchen"; then
    (cd "$repo_root/plugins/kitchen" && pwd)
    return
  fi
  local sibling
  sibling="$(cd -- "$repo_root/.." && pwd)/skills/plugins/kitchen"
  if is_kitchen "$sibling"; then
    (cd "$sibling" && pwd)
    return
  fi
  local clone="$staging/ralphbibera-skills"
  mkdir -p "$clone"
  if command -v gh >/dev/null 2>&1; then
    gh repo clone "$SKILLS_REPO" "$clone" -- --depth 1
  else
    GIT_TERMINAL_PROMPT=0 git clone --depth 1 "https://github.com/${SKILLS_REPO}.git" "$clone"
  fi
  is_kitchen "$clone/plugins/kitchen" || die "cloned $SKILLS_REPO but plugins/kitchen is missing"
  (cd "$clone/plugins/kitchen" && pwd)
}

kitchen="$(resolve_kitchen "${1:-}")"
mkdir -p "$staging/plugin"
copy_tree "$kitchen" "$staging/plugin"
mkdir -p "$(dirname "$PLUGIN_HOME")" "$SKILLS_HOME"
rm -rf "$PLUGIN_HOME"
mv "$staging/plugin" "$PLUGIN_HOME"

shopt -s nullglob
count=0
for skill in "$PLUGIN_HOME"/skills/*/; do
  name="$(basename "$skill")"
  rm -rf "$SKILLS_HOME/$name"
  mkdir -p "$SKILLS_HOME/$name"
  copy_tree "$skill" "$SKILLS_HOME/$name"
  count=$((count + 1))
done
[[ -f "$PLUGIN_HOME/plugin.json" ]] || die "plugin.json missing after install"
[[ -f "$SKILLS_HOME/poteto-mode/SKILL.md" ]] || die "poteto-mode was not installed"
[[ "$count" -gt 0 ]] || die "no skills installed"
printf 'Installed Kitchen (%d skills) to %s and %s\n' "$count" "$PLUGIN_HOME" "$SKILLS_HOME"
