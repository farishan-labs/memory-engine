#!/usr/bin/env bash
# scan-secrets.sh — block commits containing likely secrets.
# Usage: scan-secrets.sh [path]   (defaults to cwd)
# Exit 0 = clean, 1 = secrets found.
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

# Collect candidate text from staged diff (if in git) plus working tree files.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git diff --cached -- . > "$TMP" 2>/dev/null || true
  git diff -- . >> "$TMP" 2>/dev/null || true
else
  # fallback: grep all text files
  find . -type f -not -path './.git/*' -print0 2>/dev/null \
    | xargs -0 grep -I -l '' 2>/dev/null | head -1000 > "$TMP.list" || true
fi

PATTERNS=(
  'AKIA[0-9A-Z]{16}'                      # AWS access key
  'AIza[0-9A-Za-z_-]{35}'                 # Google API key
  'ghp_[0-9A-Za-z]{36}'                   # GitHub PAT
  'github_pat_[0-9A-Za-z_]{82}'           # GitHub fine-grained PAT
  'sk-[0-9A-Za-z]{20,}'                   # OpenAI/Stripe-style
  'xox[baprs]-[0-9A-Za-z-]{10,}'          # Slack tokens
  '-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----'
  '(?i)(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'\''][^"'\'' ]{8,}'
)

FOUND=0
for p in "${PATTERNS[@]}"; do
  if grep -nP "$p" "$TMP" >/dev/null 2>&1; then
    echo "SECRET DETECTED (pattern: $p):" >&2
    grep -nP "$p" "$TMP" >&2 || true
    FOUND=1
  fi
done

# High-entropy token heuristic: 32+ char base64-ish runs (best effort)
if grep -oE '[A-Za-z0-9+/]{32,}={0,2}' "$TMP" | grep -q .; then
  # only flag if adjacent to key-like context
  if grep -nP '(key|token|secret|password).{0,20}[A-Za-z0-9+/]{32,}' "$TMP" >/dev/null 2>&1; then
    echo "HIGH-ENTROPY SECRET SUSPECTED:" >&2
    grep -nP '(key|token|secret|password).{0,20}[A-Za-z0-9+/]{32,}' "$TMP" >&2 || true
    FOUND=1
  fi
fi

if [ "$FOUND" -ne 0 ]; then
  echo "scan-secrets: BLOCKED. Remove secrets before committing." >&2
  exit 1
fi
echo "scan-secrets: clean."
exit 0