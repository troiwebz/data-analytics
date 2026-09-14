FROM node:22-alpine
WORKDIR /app
COPY lib.js /lib.js
COPY server/hunt-server.js /app/hunt-server.js
ENV PORT=8787 DATA_FILE=/data/hunt-data.json
VOLUME /data
EXPOSE 8787
CMD ["node", "hunt-server.js"]
