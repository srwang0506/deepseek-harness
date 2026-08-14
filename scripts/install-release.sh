#!/bin/sh
set -eu

repository=${DEEPSEEK_HARNESS_REPOSITORY:-srwang0506/deepseek-harness}
release_base=${DEEPSEEK_HARNESS_RELEASE_BASE:-https://github.com/$repository/releases/latest/download}
temporary=$(mktemp -d "${TMPDIR:-/tmp}/deepseek-harness-install.XXXXXX")
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

download() {
  asset=$1
  case "$release_base" in
    https://*) curl --proto '=https' --tlsv1.2 -fsSL "$release_base/$asset" -o "$temporary/$asset" ;;
    *) curl -fsSL "$release_base/$asset" -o "$temporary/$asset" ;;
  esac
}

digest() {
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

verify_asset() {
  asset=$1
  expected=$(awk -v asset="$asset" '$2 == asset { print $1 }' "$temporary/SHA256SUMS")
  [ -n "$expected" ] || {
    echo "DeepSeek Harness installer: SHA256SUMS has no entry for $asset" >&2
    exit 1
  }
  actual=$(digest "$temporary/$asset")
  [ "$actual" = "$expected" ] || {
    echo "DeepSeek Harness installer: checksum mismatch for $asset" >&2
    exit 1
  }
}

backup_existing() {
  target=$1
  if [ -e "$target" ] || [ -L "$target" ]; then
    backup="$target.backup-$timestamp"
    suffix=0
    while [ -e "$backup" ] || [ -L "$backup" ]; do
      suffix=$((suffix + 1))
      backup="$target.backup-$timestamp-$suffix"
    done
    mv "$target" "$backup"
    echo "Backed up $target to $backup"
  fi
}

install_cli() {
  extracted=$1
  install_root=$2
  bin_dir=${DEEPSEEK_HARNESS_BIN_DIR:-$HOME/.local/bin}
  mkdir -p "$(dirname "$install_root")" "$bin_dir"
  backup_existing "$install_root"
  mv "$extracted" "$install_root"

  launcher="$bin_dir/deepseek-harness"
  backup_existing "$launcher"
  ln -s "$install_root/bin/deepseek-harness" "$launcher"

  legacy_launcher="$bin_dir/deeepseek-harness"
  if [ -L "$legacy_launcher" ]; then backup_existing "$legacy_launcher"; fi
  echo "Installed CLI: $launcher"
}

command -v curl >/dev/null 2>&1 || {
  echo 'DeepSeek Harness installer requires curl.' >&2
  exit 1
}

system=$(uname -s)
machine=$(uname -m)
download SHA256SUMS

case "$system:$machine" in
  Darwin:arm64)
    app_asset=deepseek-harness-macos-arm64.zip
    cli_asset=deepseek-harness-cli-macos-arm64.zip
    download "$app_asset"
    download "$cli_asset"
    verify_asset "$app_asset"
    verify_asset "$cli_asset"
    mkdir "$temporary/app" "$temporary/cli"
    unzip -q "$temporary/$app_asset" -d "$temporary/app"
    unzip -q "$temporary/$cli_asset" -d "$temporary/cli"

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

    cli_root=${DEEPSEEK_HARNESS_INSTALL_ROOT:-$HOME/Library/Application Support/DeepSeek Harness CLI}
    legacy_cli="$HOME/Library/Application Support/DeeepSeek Harness CLI"
    if [ "$legacy_cli" != "$cli_root" ] && [ -e "$legacy_cli" ]; then backup_existing "$legacy_cli"; fi
    install_cli "$temporary/cli/DeepSeek Harness CLI" "$cli_root"
    ;;
  Linux:x86_64)
    architecture=x64
    ;;
  Linux:aarch64 | Linux:arm64)
    architecture=arm64
    ;;
  *)
    echo "DeepSeek Harness installer does not support $system $machine." >&2
    exit 1
    ;;
esac

if [ "$system" = Linux ]; then
  cli_asset="deepseek-harness-linux-$architecture.tar.gz"
  download "$cli_asset"
  verify_asset "$cli_asset"
  mkdir "$temporary/cli"
  tar -xzf "$temporary/$cli_asset" -C "$temporary/cli"
  data_home=${XDG_DATA_HOME:-$HOME/.local/share}
  cli_root=${DEEPSEEK_HARNESS_INSTALL_ROOT:-$data_home/deepseek-harness}
  install_cli "$temporary/cli/DeepSeek Harness CLI" "$cli_root"
fi

echo 'DeepSeek Harness installation complete.'
if ! command -v deepseek-harness >/dev/null 2>&1; then
  echo 'Add $HOME/.local/bin to PATH, then run: deepseek-harness --help'
else
  deepseek-harness --help >/dev/null
fi
