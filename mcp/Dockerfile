FROM node:22-alpine
WORKDIR /mcp
COPY mcp/package.json mcp/proxy.js mcp/server.mjs ./
EXPOSE 3002
CMD ["node", "server.mjs"]
