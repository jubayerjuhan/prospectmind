#!/bin/sh
# Starts a virtual display + VNC server so Puppeteer can run a real, visible
# (headless:false) Chrome inside the container for the "Live LinkedIn Login"
# feature, then hands off to the actual Node process. x11vnc is bound to
# 127.0.0.1 only — the only thing that can reach it is our own Node process
# (server/src/services/scraper/vncBridge.js), never the outside network.
set -e

Xvfb :99 -screen 0 1280x920x24 -nolisten tcp &
sleep 1
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 -bg -o /var/log/x11vnc.log

exec node src/server.js
