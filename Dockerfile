FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm install
RUN npm run build

EXPOSE 8080
CMD ["node", "dist/index.js"]
