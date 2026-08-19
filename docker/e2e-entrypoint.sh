#!/usr/bin/env bash
# Isolated collaboration e2e, all inside one container.
#
# A throwaway dsh web instance is booted with its whole DSH_HOME under
# $DSH_HOME (default /dsh-home) — a real profile, session store, or preset
# roster is never touched (gap 3). Once it is reachable on 127.0.0.1, the
# host-side validation scripts and the image-inbox paste-bridge browser
# verification run against it (gap 1).
#
# One container is required, not two: dsh web intentionally binds only
# 127.0.0.1 ("--host 0.0.0.0" is rejected as a remote-code-execution risk),
# so the browser must live on the same loopback as the instance.
set -euo pipefail

DSH_HOME="${DSH_HOME:-/dsh-home}"
PROFILE="${PROFILE:-web}"
PORT="${DSH_E2E_PORT:-3081}"
REPO="${REPO:-/app}"
E2E_DIR="${DSH_E2E_DIR:-/tmp/dsh-inbox-e2e}"

export DSH_HOME

# ── 1) profile directory with the collaboration host rows ──────────────────
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
mkdir -p "$PROFILE_DIR"
if [[ ! -f "$PROFILE_DIR/cordis.patch.yml" ]]; then
  cat > "$PROFILE_DIR/cordis.patch.yml" <<'EOF'
- insert:
    - id: collaboration-team
      name: '@dsh-collaboration/team'
    - id: collaboration-image-inbox
      name: '@dsh-collaboration/tool-image-inbox'
EOF
fi

# ── 2) the five packages in the flat module fallback ────────────────────────
MODULES_DIR="$DSH_HOME/profiles/node_modules/@dsh-collaboration"
mkdir -p "$MODULES_DIR"
ln -sfn "$REPO/packages/host/team"                 "$MODULES_DIR/team"
ln -sfn "$REPO/packages/tools/tool-team"           "$MODULES_DIR/tool-team"
ln -sfn "$REPO/packages/tools/tool-model-compare"  "$MODULES_DIR/tool-model-compare"
ln -sfn "$REPO/packages/tools/tool-vision"         "$MODULES_DIR/tool-vision"
ln -sfn "$REPO/packages/tools/tool-image-inbox"    "$MODULES_DIR/tool-image-inbox"

# ── 3) the collaboration preset ─────────────────────────────────────────────
mkdir -p "$DSH_HOME/.agent-presets"
rm -rf "$DSH_HOME/.agent-presets/collaboration"
cp -r "$REPO/config/agent-presets/collaboration" "$DSH_HOME/.agent-presets/collaboration"

# ── 4) default preset = collaboration (isolated home, safe to own) ──────────
printf 'agent-presets:\n  default: collaboration\n' > "$DSH_HOME/settings.yaml"

# ── 4b) placeholder credential: a fresh home has no API key, which makes the
# web app block the composer with a first-run "API 密钥" modal. The suite
# never calls models (verify-image-inbox runs without --send), so a dummy
# DEEPSEEK_API_KEY only satisfies the onboarding check. dsh credentials-local
# insists on owner-only permissions (mode 600).
printf 'DEEPSEEK_API_KEY: "dsh-e2e-placeholder"\n' > "$DSH_HOME/.credentials.yaml"
chmod 600 "$DSH_HOME/.credentials.yaml"

# ── 5) boot the throwaway instance on the loopback ──────────────────────────
echo "[e2e-entrypoint] booting isolated DSH on 127.0.0.1:$PORT (home=$DSH_HOME, profile=$PROFILE)"
# Note: boot via `--profile <name>` with app args following — the `web`
# subcommand rejects parent --profile, and the profile bundles (dsh-web-app)
# already select the web app.
dsh --profile "$PROFILE" --port "$PORT" &
DSH_PID=$!

ready=false
for _ in $(seq 1 90); do
  if node -e "fetch('http://127.0.0.1:$PORT').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "[e2e-entrypoint] dsh did not become ready on 127.0.0.1:$PORT" >&2
  kill "$DSH_PID" 2>/dev/null || true
  exit 1
fi
echo "[e2e-entrypoint] dsh ready; running the e2e suite (DSH_E2E_DIR=$E2E_DIR)"

# ── 6) the suite ────────────────────────────────────────────────────────────
node scripts/e2e-tools.mjs
node scripts/e2e-team-host.mjs
node scripts/e2e-image-inbox.mjs
DSH_E2E_URL="http://127.0.0.1:$PORT" DSH_E2E_DIR="$E2E_DIR" node scripts/verify-image-inbox.mjs
rc=$?

kill "$DSH_PID" 2>/dev/null || true
wait "$DSH_PID" 2>/dev/null || true
exit "$rc"
