FROM ghcr.io/puppeteer/puppeteer:21.6.0

WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm install

# 앱 코드 복사
COPY . .

# 포트 설정
ENV PORT=10000
EXPOSE 10000

# 실행
CMD ["npm", "start"]
