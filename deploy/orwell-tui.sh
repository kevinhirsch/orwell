#!/usr/bin/env bash
#
# deploy/orwell-tui.sh — shared whiptail helpers for Orwell's deploy / maintenance scripts.
#
# SOURCE this file (do not exec it): `. "<dir>/orwell-tui.sh"`. It defines a small set of
# whiptail wrappers plus the `tui_active` gate, and changes NO shell options — the caller keeps
# its own `set -euo pipefail`. When whiptail is absent, or stdin/stdout is not a TTY, or the
# caller sets ORWELL_NONINTERACTIVE=1, `tui_active` returns non-zero and every caller falls back
# to its plain-text prompt. The TUI is therefore ALWAYS optional: automation, CI, and the
# host→container `pct exec` bridge (no PTY) all keep working exactly as before.
#
# Note: deploy/orwell.sh (the curl-bootstrapped one-liner installer) intentionally keeps its OWN
# inline copies of these helpers — it must remain a single standalone file with no sibling to
# source. This library serves the scripts that run from the checkout: the `orwell` control-panel
# menu and the update / doctor / reset / restore maintenance scripts.

# Title shown on every dialog (override per-script via ORWELL_TUI_TITLE before/after sourcing).
ORWELL_TUI_TITLE="${ORWELL_TUI_TITLE:-Orwell}"

# True only when it is safe to draw dialogs: a real TTY on both ends, whiptail present, and the
# caller has not forced non-interactive mode. Every wt_* helper below assumes this passed first.
tui_active() {
  [[ -t 0 && -t 1 ]] && command -v whiptail >/dev/null 2>&1 \
    && [[ -z "${ORWELL_NONINTERACTIVE:-}" ]]
}

# wt_msgbox "text" [height] [width] — an OK-to-dismiss informational box.
wt_msgbox() { whiptail --title "$ORWELL_TUI_TITLE" --msgbox "$1" "${2:-12}" "${3:-72}"; }

# wt_yesno "text" [extra whiptail args, e.g. --defaultno] — exit 0 = Yes, non-zero = No/Esc.
wt_yesno() {
  local text="$1"; shift
  whiptail --title "$ORWELL_TUI_TITLE" "$@" --yesno "$text" 14 72
}

# wt_input VAR "prompt" "default" — sets VAR to the entry (default if left blank). 1 on Cancel.
wt_input() {
  local __var="$1" __val
  __val="$(whiptail --title "$ORWELL_TUI_TITLE" --inputbox "$2" 10 72 "$3" 3>&1 1>&2 2>&3)" || return 1
  printf -v "$__var" '%s' "${__val:-$3}"
}

# wt_password VAR "prompt" — sets VAR to the hidden entry (may be empty). 1 on Cancel.
wt_password() {
  local __var="$1" __val
  __val="$(whiptail --title "$ORWELL_TUI_TITLE" --passwordbox "$2" 11 72 3>&1 1>&2 2>&3)" || return 1
  printf -v "$__var" '%s' "$__val"
}

# wt_menu VAR "prompt" tag1 item1 [tag2 item2 ...] — sets VAR to the chosen tag. 1 on Cancel.
wt_menu() {
  local __var="$1" __prompt="$2"; shift 2
  local __rows=$(( $# / 2 )) __vis __sel
  __vis=$(( __rows > 10 ? 10 : __rows ))
  __sel="$(whiptail --title "$ORWELL_TUI_TITLE" --menu "$__prompt" 20 76 "$__vis" "$@" 3>&1 1>&2 2>&3)" || return 1
  printf -v "$__var" '%s' "$__sel"
}

# wt_confirm_phrase "PHRASE" "warning text" — the double gate for a destructive action: a scary
# yes/no (defaulting to No), then the operator must type PHRASE verbatim. 0 only on both.
wt_confirm_phrase() {
  local phrase="$1" text="$2" typed
  whiptail --title "$ORWELL_TUI_TITLE" --defaultno --yesno "$text" 18 74 || return 1
  typed="$(whiptail --title "$ORWELL_TUI_TITLE" --inputbox "Type ${phrase} to confirm:" 9 60 "" 3>&1 1>&2 2>&3)" || return 1
  [[ "$typed" == "$phrase" ]]
}

# wt_textbox FILE — scrollable view of a file (command output, a log tail, etc.).
wt_textbox() { whiptail --title "$ORWELL_TUI_TITLE" --scrolltext --textbox "$1" 24 90; }
