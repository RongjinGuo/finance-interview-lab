# 财务面试练习室

面向财务管理专业求职者的中文模拟面试工具，提供五类岗位、50道面试题、逐题练习、模拟面试和自评复盘。

前端使用 GitHub Pages，访问后台使用 Cloudflare Workers 与 D1。离线版本保留单文件用法。面试回答保存在浏览器中；在线部署可记录来源 IP 和大致地区，由管理员登录查看。

- [使用说明](使用说明.md)
- [部署与访问后台](部署与后台.md)

## 本地运行

需要 Node.js 24 或更新版本。

```sh
npm ci
npm start
```

打开启动输出中的本机网址。`npm run build` 生成不联网记录访问的离线 HTML；`npm run build:site` 生成 GitHub Pages 发布目录。

## 检查

```sh
npm test
npm run test:browser
```

浏览器测试使用本机 Chrome。后台测试使用本地 D1 模拟环境：`npx playwright test --config playwright.admin.config.cjs`。

管理员密码、Cloudflare 令牌和访问数据不进入仓库。线上后台的密码以 Cloudflare Secret 保存，D1 数据库只通过受保护的后台接口读取。
