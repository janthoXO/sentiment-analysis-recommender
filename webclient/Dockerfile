# Stage 1: Build the React application
FROM node:20-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy dependency definitions
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (caching the store)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Build the application
RUN pnpm run build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine AS runner

# Copy built assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port (default nginx port)
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
