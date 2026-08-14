#!/bin/sh
set -eu

repository=${DEEPSEEK_HARNESS_REPOSITORY:-srwang0506/deepseek-harness}
release_base=${DEEPSEEK_HARNESS_RELEASE_BASE:-https://github.com/$repository/releases/latest/download}
temporary=$(mktemp -d "${TMPDIR:-/tmp}/deepseek-harness-install.XXXXXX")
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

usage() {
  printf '%s\n' \
    'Usage: install.sh <target>' \
    '' \
    'Targets:' \
    '  macos-app    DeepSeek Harness desktop App for Apple silicon' \
    '  macos-cli    DeepSeek Harness CLI for Apple silicon macOS' \
    '  linux-x64    DeepSeek Harness CLI for x86_64 Linux servers' \
    '  linux-arm64  DeepSeek Harness CLI for ARM64 Linux servers'
}

fail() {
  echo "DeepSeek Harness installer: $1" >&2
  exit 1
}

download() {
  download_asset=$1
  case "$release_base" in
    https://*) curl --proto '=https' --tlsv1.2 -fsSL "$release_base/$download_asset" -o "$temporary/$download_asset" ;;
    *) curl -fsSL "$release_base/$download_asset" -o "$temporary/$download_asset" ;;
  esac
}

digest() {
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail 'requires openssl, sha256sum, or shasum for checksum verification.'
  fi
}

verify_asset() {
  verify_name=$1
  expected=$(awk -v asset="$verify_name" '$2 == asset { print $1 }' "$temporary/SHA256SUMS")
  [ -n "$expected" ] || fail "SHA256SUMS has no entry for $verify_name"
  actual=$(digest "$temporary/$verify_name")
  [ "$actual" = "$expected" ] || fail "checksum mismatch for $verify_name"
}

backup_existing() {
  backup_target=$1
  if [ -e "$backup_target" ] || [ -L "$backup_target" ]; then
    backup="$backup_target.backup-$timestamp"
    suffix=0
    while [ -e "$backup" ] || [ -L "$backup" ]; do
      suffix=$((suffix + 1))
      backup="$backup_target.backup-$timestamp-$suffix"
    done
    mv "$backup_target" "$backup"
    echo "Backed up $backup_target to $backup"
  fi
}

install_cli() {
  cli_extracted=$1
  cli_install_root=$2
  cli_bin_dir=${DEEPSEEK_HARNESS_BIN_DIR:-$HOME/.local/bin}
  mkdir -p "$(dirname "$cli_install_root")" "$cli_bin_dir"
  backup_existing "$cli_install_root"
  mv "$cli_extracted" "$cli_install_root"

  installed_launcher="$cli_bin_dir/dsh"
  backup_existing "$installed_launcher"
  ln -s "$cli_install_root/bin/dsh" "$installed_launcher"

  legacy_launcher="$cli_bin_dir/deepseek-harness"
  if [ -L "$legacy_launcher" ]; then backup_existing "$legacy_launcher"; fi
  legacy_typo_launcher="$cli_bin_dir/deeepseek-harness"
  if [ -L "$legacy_typo_launcher" ]; then backup_existing "$legacy_typo_launcher"; fi
  echo "Installed CLI: $installed_launcher"
}

dsh_home() {
  if [ "$system" = Darwin ]; then
    printf '%s' "${DSH_HOME:-$HOME/Library/Application Support/DeepSeek Harness}"
  else
    printf '%s' "${DSH_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/deepseek-harness}"
  fi
}

install_home_patch() {
  home_patch_source=$1
  home_patch_target="$(dsh_home)/cordis.patch.yml"
  mkdir -p "$(dsh_home)"
  backup_existing "$home_patch_target"
  cp "$home_patch_source" "$home_patch_target"
  echo "Installed home patch: $home_patch_target"
}

install_target=${1:-}
if [ "$install_target" = help ] || [ "$install_target" = --help ] || [ "$install_target" = -h ]; then
  usage
  exit 0
fi
if [ -z "$install_target" ]; then
  usage >&2
  fail 'choose one installation target; desktop and CLI installations are separate.'
fi
if [ "$#" -ne 1 ]; then fail 'accepts exactly one installation target.'; fi

system=$(uname -s)
machine=$(uname -m)
case "$install_target" in
  macos-app)
    [ "$system:$machine" = Darwin:arm64 ] \
      || fail "macos-app requires Apple silicon macOS; detected $system $machine."
    asset=deepseek-harness-macos-arm64.zip
    ;;
  macos-cli)
    [ "$system:$machine" = Darwin:arm64 ] \
      || fail "macos-cli requires Apple silicon macOS; detected $system $machine."
    asset=deepseek-harness-cli-macos-arm64.zip
    ;;
  linux-x64)
    [ "$system:$machine" = Linux:x86_64 ] \
      || fail "linux-x64 requires x86_64 Linux; detected $system $machine."
    asset=deepseek-harness-linux-x64.tar.gz
    ;;
  linux-arm64)
    case "$system:$machine" in
      Linux:aarch64 | Linux:arm64) ;;
      *) fail "linux-arm64 requires ARM64 Linux; detected $system $machine." ;;
    esac
    asset=deepseek-harness-linux-arm64.tar.gz
    ;;
  *)
    usage >&2
    fail "unknown installation target $install_target"
    ;;
esac

command -v curl >/dev/null 2>&1 || fail 'requires curl.'
download SHA256SUMS
download "$asset"
verify_asset "$asset"

case "$install_target" in
  macos-app)
    command -v unzip >/dev/null 2>&1 || fail 'macos-app requires unzip.'
    mkdir "$temporary/app"
    unzip -q "$temporary/$asset" -d "$temporary/app"
    app_dir=${DEEPSEEK_HARNESS_APP_DIR:-/Applications}
    if ! mkdir -p "$app_dir" 2>/dev/null || [ ! -w "$app_dir" ]; then
      app_dir=$HOME/Applications
      mkdir -p "$app_dir"
    fi
    app_target="$app_dir/DeepSeek Harness.app"
    backup_existing "$app_target"
    backup_existing "$app_dir/DeeepSeek Harness.app"
    mv "$temporary/app/DeepSeek Harness.app" "$app_target"
    echo "Installed App: $app_target"
    ;;
  macos-cli)
    command -v unzip >/dev/null 2>&1 || fail 'macos-cli requires unzip.'
    mkdir "$temporary/cli"
    unzip -q "$temporary/$asset" -d "$temporary/cli"
    cli_root=${DEEPSEEK_HARNESS_INSTALL_ROOT:-$HOME/Library/Application Support/DeepSeek Harness CLI}
    legacy_cli="$HOME/Library/Application Support/DeeepSeek Harness CLI"
    if [ "$legacy_cli" != "$cli_root" ] && [ -e "$legacy_cli" ]; then backup_existing "$legacy_cli"; fi
    install_cli "$temporary/cli/DeepSeek Harness CLI" "$cli_root"
    install_home_patch "$cli_root/config/cordis.patch.yml"
    ;;
  linux-x64 | linux-arm64)
    command -v tar >/dev/null 2>&1 || fail "$install_target requires tar."
    mkdir "$temporary/cli"
    tar -xzf "$temporary/$asset" -C "$temporary/cli"
    data_home=${XDG_DATA_HOME:-$HOME/.local/share}
    cli_root=${DEEPSEEK_HARNESS_INSTALL_ROOT:-$data_home/deepseek-harness}
    install_cli "$temporary/cli/DeepSeek Harness CLI" "$cli_root"
    install_home_patch "$cli_root/config/cordis.patch.yml"
    ;;
esac

echo "DeepSeek Harness $install_target installation complete."
if [ "$install_target" != macos-app ]; then
  "$installed_launcher" --help >/dev/null
  if ! command -v dsh >/dev/null 2>&1; then
    echo 'Add $HOME/.local/bin to PATH, then run: dsh --help'
  fi
fi
