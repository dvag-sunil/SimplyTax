#!/bin/bash
set -e

npm install
mkdir -p eric-linux

curl -sc /tmp/cookie "https://drive.google.com/uc?export=download&id=14hLB570eNKQ6vN6fI2mfKW_T2oTWWDkr" -o /tmp/gdrive_page.html
CONFIRM=$(grep -o 'confirm=[a-zA-Z0-9_-]*' /tmp/gdrive_page.html | head -1 | cut -d= -f2)
curl -Lb /tmp/cookie "https://drive.google.com/uc?export=download&confirm=${CONFIRM}&id=14hLB570eNKQ6vN6fI2mfKW_T2oTWWDkr" -o /tmp/eric-linux.zip
unzip -q /tmp/eric-linux.zip -d eric-linux

echo "ERiC package unzipped. Contents of eric-linux:"
find eric-linux -maxdepth 4