#!/bin/bash
set -e

npm install
mkdir -p eric-linux

curl -sc /tmp/cookie "https://drive.google.com/uc?export=download&id=14hLB570eNKQ6vN6fI2mfKW_T2oTWWDkr" -o /tmp/gdrive_page.html

PAGE_SIZE=$(wc -c < /tmp/gdrive_page.html)
echo "First download attempt returned $PAGE_SIZE bytes"

if [ "$PAGE_SIZE" -lt 100000 ]; then
  echo "=== This is too small to be the real file - here is what Google actually sent: ==="
  cat /tmp/gdrive_page.html
  echo "=== end of page content ==="
  exit 1
fi

unzip -q /tmp/gdrive_page.html -d eric-linux
echo "ERiC package unzipped. Contents of eric-linux:"
find eric-linux -maxdepth 4