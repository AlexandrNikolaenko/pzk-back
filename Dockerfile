FROM node:alpine as build

WORKDIR /usr/src/app
RUN npm install --global pm2
COPY package.json /usr/src/app
RUN npm install
COPY . /usr/src/app

EXPOSE 5000

CMD ["pm2-runtime", "server.js"]