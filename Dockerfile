# Base Image provided by Microsoft with pre-installed browser binaries
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Environment configurations
ENV PORT=7860
ENV NODE_ENV=production

# Instruct Playwright to use the pre-built browsers available in the image
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Set up working directory inside the container
WORKDIR /app

# Copy dependency files first for build cache optimization
COPY package.json ./

# Install production dependencies only (skip devDependencies)
RUN npm install --only=production

# Copy the rest of the application code
COPY . .

# Hugging Face Spaces runs as a non-root container with UID 1000.
# We create a hfuser with UID 1000 if not existing, and grant permissions
# to the app and playwright directory to ensure execution is frictionless.
RUN useradd -u 1000 -m hfuser || true \
    && chown -R 1000:1000 /app \
    && chown -R 1000:1000 /ms-playwright || true

# Run as non-root user
USER 1000

# Expose Port (Hugging Face Spaces listens on 7860)
EXPOSE 7860

# Start server
CMD ["node", "server.js"]
