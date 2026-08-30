# Mail Automation — single process, single SQLite file, no native build step.
# Node >= 22.5 is required for the built-in node:sqlite module.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
RUN npm ci --no-audit --no-fund && npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY .env.example ./
RUN mkdir -p /app/var
VOLUME ["/app/var"]
EXPOSE 8787
ENV PORT=8787 HOST=0.0.0.0 DB_PATH=/app/var/mail-automation.db MAIL_DIR=/app/var/mail
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
