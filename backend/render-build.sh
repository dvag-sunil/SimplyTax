#!/bin/bash
set -e

npm install
echo "=== Current directory ==="
pwd
echo "=== Where node_modules ended up ==="
find / -maxdepth 6 -type d -name "koffi" 2>/dev/null
mkdir -p eric-linux

pip install --quiet gdown
gdown "https://drive.google.com/uc?id=14hLB570eNKQ6vN6fI2mfKW_T2oTWWDkr" -O /tmp/eric-linux.zip

ls -la /tmp/eric-linux.zip

unzip -q /tmp/eric-linux.zip -d eric-linux
echo "ERiC package unzipped. Contents of eric-linux:"
find eric-linux -maxdepth 4