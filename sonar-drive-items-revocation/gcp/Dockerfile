# Runtime image only: the release zip holds this file next to the bundled server.mjs.
FROM gcr.io/distroless/nodejs22-debian13:nonroot
WORKDIR /app
COPY server.mjs /app/server.mjs
ENV NODE_ENV=production
CMD ["/app/server.mjs"]
