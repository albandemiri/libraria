#!/bin/sh
# Development container entrypoint.
#
# node_modules lives in a named volume (so the host's Windows/macOS modules
# never shadow the Linux ones). A named volume outlives image rebuilds, though,
# so after package-lock.json changes it would keep serving stale dependencies.
# Reinstall whenever the lockfile hash differs from the one we last installed.
set -eu

lock_hash=$(sha256sum package-lock.json | cut -d ' ' -f 1)
stamp=node_modules/.package-lock.sha256

if [ "$(cat "$stamp" 2>/dev/null || true)" != "$lock_hash" ]; then
  echo "package-lock.json changed; running npm ci"
  npm ci --no-audit --no-fund
  echo "$lock_hash" > "$stamp"
fi

npm run migrate
exec npm run dev
