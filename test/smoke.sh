#!/usr/bin/env bash
# Non-destructive smoke tests for the memory CLI
set -euo pipefail
MEM="${1:-memory}"

echo "== status =="
"$MEM" status >/dev/null

echo "== list-adapters =="
"$MEM" list-adapters | grep -q '^optmem$'

echo "== wake (first part) =="
"$MEM" wake | head -1 >/dev/null

echo "== recall =="
"$MEM" recall "memory" >/dev/null

echo "== version =="
"$MEM" --version | grep -q '^memory '

echo "ALL MEMORY SMOKE TESTS PASSED"
