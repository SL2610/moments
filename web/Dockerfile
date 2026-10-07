FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked at build time (change requires a rebuild).
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ARG NEXT_PUBLIC_DEMO_SELFIE_UPLOAD="false"
ARG NEXT_PUBLIC_MAX_PHOTO_MB="30"
ARG NEXT_PUBLIC_EVENT_NAME="Your Names Here"
ARG NEXT_PUBLIC_EVENT_DATE="DD.MM.YYYY"
ARG NEXT_PUBLIC_PUBLIC_URL="https://your-domain.example.com"
ENV NEXT_PUBLIC_PUBLIC_URL=$NEXT_PUBLIC_PUBLIC_URL \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_DEMO_SELFIE_UPLOAD=$NEXT_PUBLIC_DEMO_SELFIE_UPLOAD \
    NEXT_PUBLIC_MAX_PHOTO_MB=$NEXT_PUBLIC_MAX_PHOTO_MB \
    NEXT_PUBLIC_EVENT_NAME=$NEXT_PUBLIC_EVENT_NAME \
    NEXT_PUBLIC_EVENT_DATE=$NEXT_PUBLIC_EVENT_DATE \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
