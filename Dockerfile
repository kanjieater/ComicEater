FROM sitespeedio/node:ubuntu-22-04-nodejs-20.11.1

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary packages
RUN apt-get update && \
    apt-get install -y \
    p7zip-full \
    imagemagick \
    unrar \
    curl \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi-dev \
    libxtst-dev \
    libnss3 \
    libcups2 \
    libxss1 \
    libxrandr2 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    libgbm1 \
    build-essential \
    pkg-config \
    libwebp-dev \
    && apt-get clean

WORKDIR /app

COPY package.json yarn.lock ./

RUN corepack enable && yarn -v

RUN yarn set version stable && \
    yarn install

ARG PUID=1000
ARG PGID=1000
RUN groupadd -g $PGID appgroup && \
    useradd -u $PUID -g $PGID -m appuser

# TODO Combine apt with above
# RUN apt update && apt -y install locales && locale-gen en_US.UTF-8
# ENV LANG en_US.UTF-8
# ENV LANGUAGE en_US:en
# ENV LC_ALL en_US.UTF-8

COPY . .

# Default command
CMD ["yarn", "main"]

