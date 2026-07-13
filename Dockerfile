FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEBULA_HOST=0.0.0.0
ENV NEBULA_PORT=8787
ENV NEBULA_DATA_DIR=/data
ENV NEBULA_WEB_DIST=/app/apps/web/dist

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --omit=dev --workspace @nebula/api --workspace @nebula/shared

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY catalog catalog

VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]
