# 二维码依赖

| 包 | 固定版本 | 用途 | 许可证 | 来源 |
| --- | --- | --- | --- | --- |
| jsqr | 1.4.0 | 浏览器摄像头画面解码 | MIT | https://github.com/cozmo/jsQR |
| qrcode-generator | 1.4.4 | Pages Function 生成 SVG | MIT | https://github.com/kazuhikoarase/qrcode-generator |

本源码包声明 npm 依赖，未包含下载得到的第三方源码。部署时 `npm install` 下载原包；构建将 jsQR 浏览器分发文件复制到 `public/assets/jsQR.js`。请保留原包中的许可证及版权声明。

Wrangler 沿用原项目的 `^4.20.0` 开发工具依赖，用于本地开发和部署。
