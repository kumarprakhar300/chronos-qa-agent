# --- Stage 1: Builder ---
FROM node:20-slim AS builder
WORKDIR /app

# Copy root and workspace package files
COPY package.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install all dependencies (npm workspaces automatically orchestrates links)
RUN npm install

# Copy project source files
COPY backend ./backend
COPY frontend ./frontend

# Compile frontend and backend TypeScript/Vite bundles
RUN npm run build

# --- Stage 2: Runner ---
# Use the official Microsoft Playwright image that has browsers and libs pre-installed
FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app

# Copy built bundles, assets, and node modules
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Set production env variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose port (Render/Railway overrides this automatically)
EXPOSE 3001

# Start the unified backend server which serves the static frontend
CMD ["npm", "start"]
