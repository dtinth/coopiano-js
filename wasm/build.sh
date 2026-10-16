#!/usr/bin/env bash
# Compiles coopiano to a standalone WebAssembly module with no JavaScript glue.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src/generated
em++ wasm/coopiano_wasm.cpp -o src/generated/coopiano.wasm \
  -std=c++17 -O3 -flto -msimd128 \
  -sSTANDALONE_WASM --no-entry \
  -sALLOW_MEMORY_GROWTH \
  -sEXPORTED_FUNCTIONS=_malloc,_free
