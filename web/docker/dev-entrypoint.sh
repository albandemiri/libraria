#!/bin/sh
# Development container entrypoint for the reader website.
#
# web/ and design/ are bind-mounted; each package's node_modules lives in a named
# volume (so the host's Windows/macOS modules never shadow the Linux ones). A named
# volume outlives container rebuilds, so reinstall whenever a lockfile hash differs
# from the one last installed there. `npm run dev` then builds design/dist/tokens.css
# (the predev script) and starts React Router's dev server.
set -eu

# Start as root only to hand the fresh, root-owned volumes to `node` (uid 1000), then
# drop to it, so what the dev server writes into the bind mounts (design/dist,
# web/.react-router) stays editable from the host.
#
# So the bind-mounted design/dist and web/.react-router must be writable by uid 1000
# (the usual first host user). If an older container left them or the node_modules
# volumes owned by root, recover with:
#   docker compose rm -sf web
#   docker volume rm libraria_web_node_modules libraria_design_node_modules
#   sudo chown -R "$(id -u):$(id -g)" design/dist web/.react-router
#   docker compose up -d web
if [ "$(id -u)" = 0 ]; then
  chown node:node /web/node_modules /design/node_modules
  exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node sh "$0" "$@"
fi

install_if_changed() {
  cd "$1"
  lock_hash=$(sha256sum package-lock.json | cut -d ' ' -f 1)
  stamp=node_modules/.package-lock.sha256
  if [ "$(cat "$stamp" 2>/dev/null || true)" != "$lock_hash" ]; then
    echo "$1/package-lock.json changed; running npm ci"
    npm ci --no-audit --no-fund
    echo "$lock_hash" > "$stamp"
  fi
}

install_if_changed /design
install_if_changed /web

cd /web
exec npm run dev -- --host 0.0.0.0 --port 5174
