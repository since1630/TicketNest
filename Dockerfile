# FROM node:18

# x86 비트를 위함
FROM --platform=linux/amd64 node:18

WORKDIR /app

# 첫 번째 . 은 Dockerfil이 위치한 디렉토리, 두 번째 . 은 전체 파일을 가리킴. 즉, "Dockerfile의 위치에서 전체 파일을 선택해 /app 에 복사한다." 라는 뜻
COPY . .

RUN npm i

RUN npm install pm2 -g

# ts파일을 js파일로 컴파일 하기 위해 사용
RUN npm run build

# ORM 마이그레이션
# RUN npm run migration:run

# 프로덕션 환경에선 최적화를 위해 dist 폴더안에 있는 main.js 파일을 실행할거임. 그렇기 때문에 .env 파일도 dist폴더 안에 있어야함.
COPY .env /app/dist

# 프로덕션 환경에선 최적화를 위해 main.ts 파일을 실행하는것이 아니라 js 파일을 실행한다. "-i","max" 는 사용할 코어수가 최대라는 뜻이다.
ENTRYPOINT [ "pm2-runtime","start","/app/dist/main.js","-i","max"]