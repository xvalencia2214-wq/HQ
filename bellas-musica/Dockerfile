FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# the only runtime package: the Claude library for Don Chuy (dev tools are left out)
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY public ./public
COPY start.sh ./
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TRUST_PROXY=1 BUSINESS_TZ=America/Chicago BACKUP_DIR=/data/backups
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./start.sh"]
