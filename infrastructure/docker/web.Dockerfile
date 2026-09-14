# Single-stage build: no multi-stage optimisation is needed for this slice
# (YAGNI per controller resolutions), just node:20-slim through `next build`
# and `next start`.
FROM node:20-slim

WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web .

# Next.js inlines NEXT_PUBLIC_* variables into the client bundle at BUILD
# time (webpack/turbopack DefinePlugin substitution), not at container start.
# Supplying this only as a runtime `environment:` entry in compose would
# produce a bundle with an empty string baked in and no error -- the map
# would render blank. It must be an ARG, exported to ENV before `npm run
# build` runs, and docker-compose.yml must pass it via build.args.
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN

RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
