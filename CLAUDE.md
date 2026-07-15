@orchestrator.md

## Claude Code specifics

- Use `claude --resume <session_id>` to continue an interrupted session rather
  than starting a fresh one when picking a ticket back up mid-work.
- `.claude/settings.json` is the source of truth for pre-granted bash
  permissions — see `orchestrator.md` §0 for what must be present before an
  unattended run.