#!/bin/bash
set -e

# Edge-AUI Framework - Phase 1: Environment Setup and Core Infrastructure
echo "========================================================"
echo "Initializing Edge-AUI Framework Environment (Phase 1)..."
echo "========================================================"

# 1. Verify Node.js Environment
echo "[1/6] Checking Node.js runtime..."
if ! command -v node &> /dev/null; then
    echo "Error: Node.js (v18+) is required. Please install Node.js."
    exit 1
fi
NODE_VERSION=$(node -v)
echo "Found Node.js $NODE_VERSION"

# 2. Check and Configure Rust & wasm-pack Toolchain
echo "[2/6] Configuring Rust and wasm-pack for the Deterministic Gate (Fast Brain)..."
if ! command -v rustup &> /dev/null; then
    echo "Error: rustup is not installed. Please install rustup (https://rustup.rs)."
    exit 1
fi

rustup target add wasm32-unknown-unknown

if ! command -v wasm-pack &> /dev/null; then
    echo "Installing wasm-pack CLI..."
    cargo install wasm-pack
else
    echo "wasm-pack already installed: $(wasm-pack --version)"
fi

# 3. Install Node.js Dependencies
echo "[3/6] Installing npm dependencies (ONNX Runtime Web, Vite, plugins)..."
npm install

# 4. Compile the Rust WebAssembly Fast Brain Module
echo "[4/6] Compiling Rust wasm-vectorizer module with wasm-pack..."
cd wasm-vectorizer
wasm-pack build --target web --out-dir pkg
cd ..

# 5. Verify Directory Layout & Structure
echo "[5/6] Ensuring core directory structure..."
mkdir -p src/types
mkdir -p src/core/telemetry
mkdir -p src/workers/wasm-gate
mkdir -p src/workers/onnx-gate

# 6. Typecheck and Build Verification
echo "[6/6] Verifying TypeScript contracts and production bundling..."
npm run typecheck
npm run build

echo "========================================================"
echo "Phase 1 Core Infrastructure setup complete!"
echo "WASM Fast Brain and ONNX Slow Brain gates are ready."
echo "Run 'npm run dev' to start the interactive test harness."
echo "========================================================"