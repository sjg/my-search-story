# 🐳 Use an official Node.js runtime as a parent image
# Using a 'slim' version for a smaller image size
FROM node:20-slim

# Install jq for processing JSON in the generateStory function.
RUN apt-get update && apt-get install -y jq && \
    # Clean up apt cache to keep image small
    rm -rf /var/lib/apt/lists/*

# 📁 Create and change to the app directory
WORKDIR /usr/src/app

# 📦 Copy package.json and package-lock.json
# This takes advantage of Docker's layer caching. If these files don't change,
# Docker won't re-run `npm ci` in subsequent builds.
COPY package*.json ./

# ⚙️ Install app dependencies
# Using "npm ci" is recommended for production as it's faster and uses the lockfile.
# --only=production ensures we don't install devDependencies.
RUN npm ci --only=production

# 🚚 Bundle app source code
COPY . .

# 🚪 Expose the port the app runs on
EXPOSE 3000

# 👤 Switch to a non-root user for security
USER node

# 🚀 Define the command to run your app
CMD [ "npm", "start" ]