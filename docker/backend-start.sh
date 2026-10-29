#!/usr/bin/env bash
set -euo pipefail
cd /convex
source ./read_credentials.sh
umask 077
./generate_admin_key.sh > /convex/data/admin-key
if [ ! -s /convex/data/mcp-secret ]; then
  openssl rand -hex 32 > /convex/data/mcp-secret
fi
exec ./run_backend.sh
