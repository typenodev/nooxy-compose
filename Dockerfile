FROM node:22-alpine

WORKDIR /app

# 先装依赖（利用 Zeabur 构建缓存，package.json 变动才重装）
COPY package.json ./
RUN npm install

# 再拷贝源码
COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
