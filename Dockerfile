FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js /app/httpApp.js /app/conversionService.js /app/rateLimiter.js /app/agentDiscovery.js ./
COPY --from=build /app/validation ./validation
COPY --from=build /app/currencies.json ./currencies.json
COPY --from=build /app/i18n ./i18n

ENV NODE_ENV=production
ENV APP_PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
