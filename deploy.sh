#!/bin/bash
# Deploy dutify / customs-calculator. Run as root; every Node/PM2 step runs as the
# unprivileged "apps" user via /usr/local/sbin/as-apps (the app lives in apps' own PM2).
# `npm run build` already copies .next/static and public/ into the standalone output (postbuild).
set -e
cd "$(dirname "$0")"
if [[ $EUID -ne 0 ]]; then echo "deploy.sh: run as root (Node steps switch to 'apps' automatically)" >&2; exit 1; fi

echo "Building (as apps)..."
as-apps npm run build

echo "Fixing ownership..."
apps-perms "$PWD"

echo "Restarting (apps PM2)..."
as-apps pm2 restart customs-calculator --update-env

echo "Done."
