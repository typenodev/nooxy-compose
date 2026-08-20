# Nooxy Docker 一键部署版

基于 [Nooxy](https://github.com/draphy/nooxy) 的 Docker 快速部署方案，将 Notion 页面转化为独立网站，并**自带密码保护功能**。

## ✨ 特性

- 🚀 **零构建部署**：使用 `node:22-alpine` 镜像，启动时自动安装依赖。
- 🔒 **密码保护**：内置单密码 Cookie 门禁，通过环境变量一键开启/关闭。
- 🎨 **深度定制**：默认注入 CSS 隐藏 Notion 顶部栏和冗余按钮，保持页面纯净。
- 🔗 **URL 清理**：自动去除 Notion 链接中的 `?pvs=` 追踪参数。
- 📦 **代码外置**：核心逻辑抽离为 `server.mjs`，修改后重启容器即可生效。

## 🚀 快速开始

1. 克隆或下载本仓库文件到服务器：
   ```bash
   mkdir nooxy-site && cd nooxy-site
   # 将 docker-compose.yml, server.mjs 放入此目录
