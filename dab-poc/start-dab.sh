#!/bin/sh
set -eu
deps=$(find .store -name Microsoft.DataApiBuilder.deps.json)
if [ -z "$deps" ] || [ "$(printf '%s\n' "$deps" | wc -l)" -ne 1 ]; then
  echo "Expected exactly one pinned DAB runtime." >&2
  exit 1
fi
runtime=$(dirname "$deps")
exec dotnet exec --depsfile "$deps" \
  --runtimeconfig "$runtime/Microsoft.DataApiBuilder.runtimeconfig.json" \
  "$runtime/ShopStream.DabHost.dll" start --config dab-config.json --no-https-redirect
