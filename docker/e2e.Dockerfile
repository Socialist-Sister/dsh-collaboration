# dsh-collaboration e2e image — one container runs the whole suite:
#
#   - a throwaway DeepSeek Harness web instance whose whole DSH_HOME lives
#     inside the container (/dsh-home). It never touches a real profile or
#     session store, so destructive verification cannot pollute a user's
#     environment.
#   - the host-side validation scripts plus the browser verification of the
#     image-inbox paste bridge, driven against the instance on the loopback.
#
# A single container is required because dsh web binds only 127.0.0.1
# ("--host 0.0.0.0" is rejected as a remote-code-execution risk), so the
# browser must share the loopback with the instance.
#
# The base image ships Node and the playwright-bundled chromium that
# verify-image-inbox.mjs drives via `channel: 'chromium'` on non-Windows.
# The tag matches the repo's playwright-core ^1.62.1 devDependency.

FROM mcr.microsoft.com/playwright:v1.62.1-noble

# pnpm pinned to the repo's packageManager, and the same dsh version the
# suite targets (the deployments this project is tested against).
RUN npm install -g pnpm@9.15.0 @deepseek-ai/dsh@0.1.0-rc.6

WORKDIR /app

# The repo is baked in (deterministic builds, no runtime mounts needed).
# node_modules and other host-local dirs are excluded via .dockerignore.
COPY . .

# Frozen lockfile + build every package (lib/ outputs the e2e scripts import).
RUN pnpm install --frozen-lockfile \
 && pnpm build

COPY docker/e2e-entrypoint.sh /usr/local/bin/e2e-entrypoint.sh
RUN chmod +x /usr/local/bin/e2e-entrypoint.sh

CMD ["/usr/local/bin/e2e-entrypoint.sh"]
