#!/bin/sh
# How the container starts (Dockerfile CMD, and the dockerCommand in ../render-tryout.yaml). A host's disk (Render, Fly,
# Railway) is mounted at $DATA_DIR owned by root: hand it to the app's user, then run as that user, never as root.
set -e
mkdir -p "$DATA_DIR"
[ "$(stat -c %U "$DATA_DIR")" = node ] || chown -R node:node "$DATA_DIR"
exec setpriv --reuid=node --regid=node --init-groups node --disable-warning=ExperimentalWarning server/index.js
