# Use the official Apify Node.js base image (Node 18 LTS)
FROM apify/actor-node:18

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy the rest of the source code
COPY . ./

# Set the default command
CMD ["node", "src/main.js"]
