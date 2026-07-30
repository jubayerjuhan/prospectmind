# ProspectMind web client — static Vite build, served for Cloud Run.
# VITE_API_URL is baked in at build time (Vite inlines import.meta.env.* into
# the bundle) via client/.env.production.local — Vite loads that file itself,
# so it must NOT also be set as a container ENV here: Vite only fills in vars
# that aren't already present in process.env, and an empty ENV still counts as
# present, silently shadowing the .env file.

FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 8080

# Cloud Run injects PORT; -s enables SPA fallback (matches client/vercel.json's
# rewrite-everything-to-index.html rule) so client-side routes survive a reload.
CMD serve -s dist -l ${PORT:-8080}
