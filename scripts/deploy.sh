#!/usr/bin/env bash
# Deploy dist/ to my.circlecare.app (Namecheap) without breaking open tabs.
#
# A tab opened before a deploy still asks for the old hashed chunks in assets/.
# The old `rsync --delete dist/` removed them at once, so those tabs hit 404s
# ("Failed to fetch dynamically imported module", PostHog issue 01a1b184).
# Now:
#   1. assets/ is uploaded first, WITHOUT --delete (old chunks stay).
#   2. everything else (HTML, .htaccess, images) is mirrored WITH --delete, as before,
#      but assets/ is excluded from that pass. HTML goes last, so no page ever points
#      at a chunk that is not on the server yet.
#   3. old assets are pruned: only files older than KEEP_DAYS that are NOT part of
#      the build just uploaded. The current build is never touched.
#
# DEST=host:path or a local directory (for testing). Default is the live server.
# Usage: scripts/deploy.sh            (expects a fresh dist/; `npm run deploy` builds first)
set -euo pipefail

DEST="${DEST:-namecheap:~/my.circlecare.app}"
KEEP_DAYS="${KEEP_DAYS:-7}"
cd "$(dirname "$0")/.."

[ -f dist/index.html ] && [ -d dist/assets ] || { echo "dist/ missing; run the build first" >&2; exit 1; }

echo "1/3 assets (no delete) -> $DEST/assets/"
rsync -avz dist/assets/ "$DEST/assets/"

echo "2/3 site (delete, assets excluded) -> $DEST/"
rsync -avz --delete --exclude .well-known --exclude /assets/ dist/ "$DEST/"

echo "3/3 prune assets older than ${KEEP_DAYS} days not in this build"
# Keep list = this build's asset names, sent on stdin; delete only what is old AND absent.
PRUNE='set -e
dir="$1"; days="$2"; keep="$(mktemp)"
cat > "$keep"
[ -s "$keep" ] || { echo "empty keep list, prune skipped" >&2; rm -f "$keep"; exit 1; }
cd "$dir/assets"
find . -maxdepth 1 -type f -mtime +"$days" -print | sed "s|^\./||" | grep -vxF -f "$keep" | while IFS= read -r f; do
  rm -f -- "$f"; echo "  pruned $f"
done
rm -f "$keep"'

if [[ "$DEST" == *:* ]]; then
  host="${DEST%%:*}"; rpath="${DEST#*:}"
  ls -1 dist/assets | ssh "$host" "sh -c '$PRUNE' prune $rpath $KEEP_DAYS"
else
  ls -1 dist/assets | sh -c "$PRUNE" prune "$DEST" "$KEEP_DAYS"
fi
echo "done"
