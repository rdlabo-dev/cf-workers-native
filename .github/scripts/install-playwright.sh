#!/usr/bin/env bash
set -euo pipefail

# The Azure Ubuntu mirror can spend the entire job budget downloading WebKit
# dependencies. Use Ubuntu's archive while retaining apt's signature checks.
if [[ "${RUNNER_OS:-}" == "Linux" ]]; then
  # Playwright's dependencies come from Ubuntu. A failing Microsoft feed on
  # hosted images otherwise aborts apt-get update before installation starts.
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    paused=()
    restore_feeds() {
      local source
      for source in "${paused[@]}"; do
        sudo mv -- "$source.playwright-disabled" "$source"
      done
    }
    trap restore_feeds EXIT
    for source in /etc/apt/sources.list.d/microsoft-prod.{list,sources}; do
      if [[ -f "$source" && ! -e "$source.playwright-disabled" ]]; then
        sudo mv -- "$source" "$source.playwright-disabled"
        paused+=("$source")
      fi
    done
  fi
  # Hosted images also use mirror+file URIs. Updating only .sources leaves
  # that indirection free to select Azure again.
  if [[ -f /etc/apt/apt-mirrors.txt ]]; then
    printf '%s\n' 'https://archive.ubuntu.com/ubuntu/' |
      sudo tee /etc/apt/apt-mirrors.txt >/dev/null
  fi
  for sources in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    if [[ -f "$sources" ]]; then
      sudo sed -i \
        's|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g; s|https://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
        "$sources"
    fi
  done
fi

npx playwright install --with-deps "$@"
