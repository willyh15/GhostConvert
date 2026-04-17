# Dockerfile
FROM node:20-alpine

WORKDIR /usr/src/app

# Install deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy rest of app
COPY . .

ENV NODE_ENV=production

# Ensure tmp dirs exist (used by converters)
RUN mkdir -p tmp/input tmp/output

# App listens on PORT or 3000 in src/server.js; container port is 3000
EXPOSE 3000

CMD ["node", "src/server.js"]