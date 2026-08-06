#!/bin/bash
set -e

npm install
echo "=== Current directory ==="
pwd
echo "=== Contents of node_modules (top level) ==="
ls node_modules | head -20
echo "=== Does koffi exist here? ==="
ls -la node_modules/koffi 2>&1 || echo "NOT FOUND at node_modules/koffi"
mkdir -p eric-linux

pip install --quiet gdown
gdown "https://drive.google.com/uc?id=14hLB570eNKQ6vN6fI2mfKW_T2oTWWDkr" -O /tmp/eric-linux.zip

ls -la /tmp/eric-linux.zip

unzip -q /tmp/eric-linux.zip -d eric-linux
echo "ERiC package unzipped. Contents of eric-linux:"
find eric-linux -maxdepth 4