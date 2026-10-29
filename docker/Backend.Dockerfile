FROM ghcr.io/convex/convex-backend:latest
COPY docker/backend-start.sh /convex/backend-start.sh
RUN chmod +x /convex/backend-start.sh
ENTRYPOINT ["/convex/backend-start.sh"]
