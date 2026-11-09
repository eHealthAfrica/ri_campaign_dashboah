# Build the web app, then run it on a small image with no build tools.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY scripts/gzip-dist.mjs ./scripts/gzip-dist.mjs
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    RI_DATA_DIR=/app/data \
    RI_USERS_FILE=/app/state/users.json \
    RI_SESSION_SECRET_FILE=/app/state/.session-secret
COPY package.json ./
COPY server/app.mjs server/index.mjs ./server/
COPY scripts/add-user.mjs ./scripts/add-user.mjs
COPY --from=build /app/dist ./dist
# Holds logins and the session secret. Data and logins are mounted, never stored in the image.
RUN mkdir -p /app/data /app/state && chown node:node /app/state
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
