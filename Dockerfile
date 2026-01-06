FROM node:18-slim

# Chromium 및 필요한 라이브러리 설치
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-nanum \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer 환경변수 설정
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm install --omit=dev

# 앱 코드 복사
COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["npm", "start"]
