# ProspectMind API — Express + BullMQ worker (same process) + Puppeteer.
# Puppeteer needs a real Chrome + its shared libraries, so this can't be a
# slim serverless function image — Cloud Run runs it as a normal container.

FROM node:24-slim

# Chrome's runtime dependencies (the standard Puppeteer Debian list) + fonts
# so rendered pages don't fall back to tofu boxes for non-Latin scripts.
# xvfb + x11vnc give Puppeteer's headless:false ("Live LinkedIn Login") a
# virtual display to render onto and a way to stream it out — see
# docker-entrypoint.sh and src/services/scraper/vncBridge.js.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-noto-color-emoji \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
    libxtst6 wget xdg-utils unzip \
    xvfb x11vnc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# `npm ci` runs Puppeteer's postinstall, which downloads its pinned Chrome
# build now, at image-build time — not on every cold start.
RUN npm ci --omit=dev

COPY . .
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
# Puppeteer's headless:false launches (Live LinkedIn Login) render onto this
# virtual display, started by docker-entrypoint.sh before Node boots.
ENV DISPLAY=:99
# Cloud Run injects PORT; server.js already reads process.env.PORT.
EXPOSE 8080

CMD ["./docker-entrypoint.sh"]
