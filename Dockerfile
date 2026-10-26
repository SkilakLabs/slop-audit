# Public app image. Playwright's own image ships Node 22, Chromium and every
# system library the browser needs, pinned to the same version as package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY bin ./bin
COPY src ./src
RUN mkdir -p /data/out && chown -R pwuser:pwuser /app /data
USER pwuser
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4100/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "bin/slop-audit.js", "serve", "--host", "0.0.0.0", "--port", "4100", "--public", "--out", "/data/out"]
