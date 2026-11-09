#!/usr/bin/env bash
# Packs the generated data/ folder into ri-data.tar.gz for copying to a host.
# The archive holds restricted settlement data: keep it out of git and share it only over a private channel.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f data/public/summary.json ] && [ -f data/restricted/settlements.json ] || {
  echo "data/ is incomplete. Generate it first (see README)." >&2
  exit 1
}

umask 077
COPYFILE_DISABLE=1 tar --exclude='.DS_Store' -czf ri-data.tar.gz data
echo "Created ri-data.tar.gz ($(du -h ri-data.tar.gz | cut -f1))"
shasum -a 256 ri-data.tar.gz
