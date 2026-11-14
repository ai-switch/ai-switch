#!/bin/sh
set -eu

if [ -z "${AI_SWITCH_TOKEN:-}" ]; then
  if [ -r /dev/urandom ] && command -v openssl >/dev/null 2>&1; then
    AI_SWITCH_TOKEN="$(openssl rand -hex 32)"
  else
    AI_SWITCH_TOKEN="docker-$(date +%s)-$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  echo "AI_SWITCH_TOKEN was not set; generated a container-local token: ${AI_SWITCH_TOKEN}"
fi

if [ -z "${AI_SWITCH_HOST:-}" ]; then
  AI_SWITCH_HOST=0.0.0.0
fi
if [ -z "${AI_SWITCH_PORT:-}" ]; then
  AI_SWITCH_PORT=19527
fi
if [ -z "${AI_SWITCH_STATIC_DIR:-}" ]; then
  AI_SWITCH_STATIC_DIR=/app/web
fi
export AI_SWITCH_HOST AI_SWITCH_PORT AI_SWITCH_STATIC_DIR AI_SWITCH_TOKEN

# Public access (Tailscale Funnel) means the app shells out to the `tailscale`
# CLI, which needs a daemon to talk to. Userspace networking mode is what makes
# that work in a container with no /dev/net/tun and no elevated capabilities.
if [ -z "${TS_SOCKET:-}" ]; then
  TS_SOCKET="$HOME/.ai-switch/tailscaled.sock"
fi
if [ -z "${TS_STATE_DIR:-}" ]; then
  TS_STATE_DIR="$HOME/.ai-switch/tailscale"
fi
export TS_SOCKET TS_STATE_DIR
mkdir -p "$TS_STATE_DIR"

if command -v tailscaled >/dev/null 2>&1; then
  tailscaled --tun=userspace-networking --socket="$TS_SOCKET" --statedir="$TS_STATE_DIR" &
  # The CLI's first call is what reports status; give tailscaled a moment to
  # create its socket so an early status read does not look like "unavailable".
  for _ in $(seq 1 50); do
    [ -S "$TS_SOCKET" ] && break
    sleep 0.1
  done
else
  echo "tailscaled is not installed; Tailscale public access stays unavailable in this container." >&2
fi

exec /app/ai-switch-server