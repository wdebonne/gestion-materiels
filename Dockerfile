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

# Copy server package files
COPY package*.json ./

# Install server dependencies
RUN npm install --legacy-peer-deps

# Copy server source
COPY src/ ./src/
COPY tsconfig.json ./

# Build server
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --legacy-peer-deps --omit=dev

# Copy built server
COPY --from=server-builder /app/dist ./dist

# Copy built client to public folder
COPY --from=client-builder /app/client/dist ./public

# Create necessary directories
RUN mkdir -p data uploads backups logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Run the application
CMD ["node", "dist/server.js"]
