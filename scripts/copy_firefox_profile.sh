#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="${HOME}/.mozilla/firefox"
DEST="${AI_FIREFOX_PROFILE:-${HOME}/.ai-firefox-profile}"

if [[ ! -d "$SRC_ROOT" ]]; then
  echo "Firefox profile directory not found: $SRC_ROOT" >&2
  exit 1
fi

INI_FILE="${SRC_ROOT}/profiles.ini"
if [[ ! -f "$INI_FILE" ]]; then
  echo "profiles.ini not found: $INI_FILE" >&2
  exit 1
fi

DEFAULT_PATH="$(awk -F= '
  /^\[Profile/ { in_profile=1; path=""; def=0; rel=1; next }
  /^\[/ { in_profile=0 }
  in_profile && $1=="Path" { path=$2 }
  in_profile && $1=="Default" { def=$2 }
  in_profile && $1=="IsRelative" { rel=$2 }
  in_profile && path!="" && def=="1" {
    print rel ":" path
    exit
  }
' "$INI_FILE")"

if [[ -z "$DEFAULT_PATH" ]]; then
  echo "Could not find default Firefox profile in $INI_FILE" >&2
  echo "Available profiles:" >&2
  ls -1 "$SRC_ROOT" >&2 || true
  exit 1
fi

IS_RELATIVE="${DEFAULT_PATH%%:*}"
PROFILE_PATH="${DEFAULT_PATH#*:}"

if [[ "$IS_RELATIVE" == "1" ]]; then
  SRC_PROFILE="${SRC_ROOT}/${PROFILE_PATH}"
else
  SRC_PROFILE="${PROFILE_PATH}"
fi

if [[ ! -d "$SRC_PROFILE" ]]; then
  echo "Resolved Firefox profile does not exist: $SRC_PROFILE" >&2
  exit 1
fi

echo "Source profile: $SRC_PROFILE"
echo "Destination:    $DEST"
echo
echo "Close Firefox first before copying."
read -rp "Continue? [y/N] " ans
if [[ "${ans:-N}" != "y" && "${ans:-N}" != "Y" ]]; then
  echo "Cancelled."
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -a "$SRC_PROFILE" "$DEST"

echo
echo "Copied Firefox profile to:"
echo "  $DEST"
echo
echo "Then start your bot and use:"
echo "  use gpt"
echo "or"
echo "  use grok"
