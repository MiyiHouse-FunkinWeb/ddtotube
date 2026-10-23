FROM node:20-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/MiyiHouse-FunkinWeb/ddtotube /app && chown -R node:node /app
WORKDIR /app
USER node
RUN npm install --omit=dev
ENV PORT=7860 DATA_DIR=/app/data
EXPOSE 7860
CMD ["node", "server.js"]
