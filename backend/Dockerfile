# Development image: source is bind-mounted by docker-compose, so we only
# need the dependency layer baked in for fast, parity-consistent startup.
FROM node:24-alpine AS dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]


# Production image: compile TypeScript, then ship only runtime deps.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:24-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
