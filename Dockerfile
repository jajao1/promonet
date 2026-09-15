FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache fontconfig ttf-dejavu
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node bot ./bot
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node site ./site
RUN node scripts/offer-card-smoke.mjs
USER node
EXPOSE 3000
CMD ["node", "bot/server.mjs"]
