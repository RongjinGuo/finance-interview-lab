FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /home/node/app
COPY --chown=node:node index.html ./index.html
COPY --chown=node:node src ./src
COPY --chown=node:node server ./server
USER node
ENV NODE_ENV=production PORT=7860 HOST=0.0.0.0 GIT_DATA_DIR=/home/node/data
EXPOSE 7860
CMD ["node", "server/main.mjs"]
