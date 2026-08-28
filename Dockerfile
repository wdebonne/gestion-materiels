# Build stage for client
FROM node:20-alpine AS client-builder

WORKDIR /app/client

# Copy client package files
COPY client/package*.json ./

# Install client dependencies
RUN npm install --legacy-peer-deps

# Copy client source
COPY client/ ./

# Build client
RUN npm run build

# Build stage for server
FROM node:20-alpine AS server-builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy server package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN npm install --legacy-peer-deps --include=dev

# Copy server source
COPY src/ ./src/
COPY tsconfig.json ./

# Build server with tsc. The image was built with esbuild, which strips types
# without checking them: production was the only place where the code was never
# type-checked. The server now compiles clean, so a type error must stop the
# build here rather than surface as a runtime crash in the town hall.
RUN npm run build:server

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Install production dependencies only
COPY package*.json ./
RUN npm install --legacy-peer-deps --omit=dev

# Copy built server
COPY --from=server-builder /app/dist ./dist

# Copy built client to correct location (server expects ../client/dist from dist/)
COPY --from=client-builder /app/client/dist ./client/dist

# Create necessary directories
RUN mkdir -p data uploads backups logs plugins

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check (use 127.0.0.1 to avoid IPv6 issues)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1

# Run the application
CMD ["node", "dist/server.js"]
