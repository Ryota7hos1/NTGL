#!/bin/sh
cd "$(dirname "$0")" && echo "Open http://localhost:8765" && python3 -m http.server 8765
