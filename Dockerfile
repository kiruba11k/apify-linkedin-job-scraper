# Use Apify's Puppeteer + Chrome base image (Node 18)
FROM apify/actor-node-puppeteer-chrome:20
# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --include=dev

# Copy source
COPY . ./

# Run the actor
CMD ["node", "src/main.js"]
