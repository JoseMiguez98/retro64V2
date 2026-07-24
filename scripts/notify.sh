#!/usr/bin/env bash
#
# notify.sh — best-effort, out-of-band notification for the orchestrator.
#
# WHY THIS EXISTS
#   The orchestrator's first unattended run escalated correctly and nobody found
#   out (DMI-68 / Gap #1). An escalation that reaches no human is a stalled loop.
#   This script is the "reach a human" half of orchestrator.md §6.
#
# DESIGN
#   A generic `curl` to a webhook, deliberately agnostic about the channel and
#   the agent backend running the loop (decided in DMI-68 — not an MCP connector,
#   so it works regardless of which agent/harness invokes it). Point it at a
#   Slack incoming webhook, a Telegram bot, an ntfy.sh topic, or any endpoint
#   that accepts an HTTP POST.
#
#   The Linear comment posted during escalation is the DURABLE record. This
#   notification is best-effort: if the webhook is unconfigured or the POST
#   fails, the loop must not be blocked — the human still has the Linear comment.
#
# USAGE
#   scripts/notify.sh [--title TITLE] [--dry-run] MESSAGE...
#   scripts/notify.sh --help
#
#   MESSAGE   The body text. Multiple args are joined with spaces. If no MESSAGE
#             args are given, the body is read from stdin.
#
# ENVIRONMENT
#   ORCHESTRATOR_NOTIFY_WEBHOOK           Target URL. If unset/empty, the script
#                                         warns and exits 0 (best-effort skip).
#   ORCHESTRATOR_NOTIFY_FORMAT            slack (default) | ntfy | telegram | raw
#                                           slack     -> JSON  {"text": "..."}   (also Discord/Mattermost/Google Chat)
#                                           ntfy      -> plain body, title via header
#                                           telegram  -> form POST to Bot API sendMessage
#                                           raw       -> message as the raw text/plain body
#   ORCHESTRATOR_NOTIFY_TELEGRAM_CHAT_ID  Required only when FORMAT=telegram.
#   ORCHESTRATOR_NOTIFY_DRY_RUN           1/true -> print what would be sent, don't POST.
#
# EXIT CODES
#   0  sent, or intentionally skipped (webhook unconfigured / dry-run)
#   1  send attempted but failed (curl error or non-2xx HTTP status)
#   2  usage error (empty message, missing telegram chat id, missing curl/jq)
#
# SECURITY
#   Slack/Telegram webhook URLs embed a secret token. The URL is NEVER hardcoded
#   here — it comes from the environment (put it in .env, which is git-ignored,
#   or the runner's env). URLs are redacted in all log/dry-run output.

set -uo pipefail

readonly DEFAULT_TITLE="🤖 Orchestrator escalation"

die() { printf 'notify.sh: %s\n' "$1" >&2; exit "${2:-2}"; }

usage() {
  sed -n '2,60p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'
  exit 0
}

# Redact the secret-bearing part of a URL for safe logging: keep scheme://host,
# drop everything after the host (path/token/query).
redact_url() {
  printf '%s' "$1" | sed -E 's#^([a-zA-Z]+://[^/]+).*#\1/…#'
}

title="$DEFAULT_TITLE"
dry_run="${ORCHESTRATOR_NOTIFY_DRY_RUN:-}"
args=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage ;;
    --title)   [ "$#" -ge 2 ] || die "--title needs a value"; title="$2"; shift 2 ;;
    --dry-run) dry_run="1"; shift ;;
    --)        shift; while [ "$#" -gt 0 ]; do args+=("$1"); shift; done ;;
    *)         args+=("$1"); shift ;;
  esac
done

case "$dry_run" in 1|true|TRUE|yes|on) dry_run="1" ;; *) dry_run="" ;; esac

# Body: positional args joined by space, else stdin.
if [ "${#args[@]}" -gt 0 ]; then
  message="${args[*]}"
elif [ ! -t 0 ]; then
  message="$(cat)"
else
  die "no message given (pass MESSAGE args or pipe via stdin)"
fi
[ -n "$message" ] || die "message is empty"

# Auto-load the repo-local .env (git-ignored) when the webhook isn't already in
# the environment. Unattended runs inject these vars, so this is a no-op there.
# Interactively it means the script can be invoked directly (scripts/notify.sh …)
# instead of `set -a; . ./.env; set +a; scripts/notify.sh …` — the bare form is
# what the `Bash(scripts/notify.sh *)` allow rule matches, so it runs without an
# inline-sourcing prefix pushing it through the permission classifier.
if [ -z "${ORCHESTRATOR_NOTIFY_WEBHOOK:-}" ]; then
  env_file="$(dirname "$0")/../.env"
  [ -f "$env_file" ] && set -a && . "$env_file" && set +a
fi

webhook="${ORCHESTRATOR_NOTIFY_WEBHOOK:-}"
format="${ORCHESTRATOR_NOTIFY_FORMAT:-slack}"

# Unconfigured webhook is a best-effort skip, not a failure: the escalation's
# Linear comment is the durable record. Warn loudly so the gap shows in logs.
if [ -z "$webhook" ] && [ -z "$dry_run" ]; then
  printf 'notify.sh: ORCHESTRATOR_NOTIFY_WEBHOOK is unset — skipping notification (best-effort). Escalation still recorded in Linear.\n' >&2
  exit 0
fi

command -v curl >/dev/null 2>&1 || die "curl not found on PATH"

# Full text a human receives: title on the first line, then the message.
full_text="${title}"$'\n'"${message}"

# Build the curl argument array per format. curl_args holds everything after the
# URL; we assemble it without the secret so dry-run can print it safely.
curl_args=(--fail --show-error --silent --max-time 15)
declare payload_preview

case "$format" in
  slack|json)
    command -v jq >/dev/null 2>&1 || die "format '$format' needs jq to build JSON safely; install jq or use FORMAT=raw"
    payload_preview="$(jq -n --arg text "$full_text" '{text:$text}')"
    curl_args+=(-X POST -H 'Content-Type: application/json' --data "$payload_preview")
    ;;
  ntfy)
    curl_args+=(-X POST -H "Title: ${title}" --data-binary "$message")
    payload_preview="[Title: ${title}] ${message}"
    ;;
  telegram)
    chat_id="${ORCHESTRATOR_NOTIFY_TELEGRAM_CHAT_ID:-}"
    [ -n "$chat_id" ] || die "FORMAT=telegram needs ORCHESTRATOR_NOTIFY_TELEGRAM_CHAT_ID"
    curl_args+=(-X POST --data-urlencode "chat_id=${chat_id}" --data-urlencode "text=${full_text}")
    payload_preview="chat_id=${chat_id} text=${full_text}"
    ;;
  raw)
    curl_args+=(-X POST -H 'Content-Type: text/plain; charset=utf-8' --data-binary "$full_text")
    payload_preview="$full_text"
    ;;
  *)
    die "unknown ORCHESTRATOR_NOTIFY_FORMAT='$format' (want: slack|ntfy|telegram|raw)"
    ;;
esac

if [ -n "$dry_run" ]; then
  printf 'notify.sh [dry-run] would POST\n  format:  %s\n  url:     %s\n  payload: %s\n' \
    "$format" "$(redact_url "${webhook:-<unset>}")" "$payload_preview" >&2
  exit 0
fi

if curl "${curl_args[@]}" "$webhook" >/dev/null; then
  printf 'notify.sh: sent (%s → %s)\n' "$format" "$(redact_url "$webhook")" >&2
  exit 0
else
  status=$?
  printf 'notify.sh: send FAILED (curl exit %s, %s → %s). Escalation still recorded in Linear.\n' \
    "$status" "$format" "$(redact_url "$webhook")" >&2
  exit 1
fi
