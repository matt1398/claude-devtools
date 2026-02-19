#!/bin/bash
# Fix chrome-sandbox permissions for SUID sandbox on Linux
# See: https://github.com/electron/electron/issues/17972

SANDBOX_PATH="/opt/${productFilename}/chrome-sandbox"

if [ -f "$SANDBOX_PATH" ]; then
  chown root:root "$SANDBOX_PATH"
  chmod 4755 "$SANDBOX_PATH"
fi
