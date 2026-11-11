FROM node:22-bookworm-slim

WORKDIR /app

# Install build tools required for native C++ modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package descriptors
COPY package*.json ./

# Install dependencies (with fallback for cross-platform lockfile compatibility)
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source code
COPY . .

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "backend/src/server.js"]
