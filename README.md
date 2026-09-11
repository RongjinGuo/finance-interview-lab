# 财务面试练习室

面向财务管理专业求职者的中文模拟面试工具，提供五类岗位、50道面试题、逐题练习、模拟面试和自评复盘。

账号版采用 Hugging Face Docker Space 运行网页与登录服务，使用独立用户名和密码。练习记录按账号保存在私有 GitHub 仓库，管理员可以创建用户并查看逐题回答。

- 账号版入口：[财务面试练习室](https://rongjin03-finance-interview-lab.hf.space/)
- 源码仓库：[RongjinGuo/finance-interview-lab](https://github.com/RongjinGuo/finance-interview-lab)
- 私有记录仓库：`RongjinGuo/finance-interview-records`，仅授权人员可访问。

输入先保存为本机草稿；页面显示“已同步到云端”时，服务端已经成功推送到私有记录仓库。换设备后登录同一账号即可读取已同步记录。Space 重启会结束登录会话，已保存记录会保留。

原 GitHub Pages 页面与单文件离线版继续使用本机保存，不需要账号；它们的匿名草稿不会自动上传到账号版。

- [使用说明](使用说明.md)
- [部署、账号与后台维护](部署与后台.md)

## 本地运行

需要 Node.js 24 或更新版本。

```sh
npm ci
npm start
```

打开启动输出中的本机网址。这是默认关闭账号功能的本地预览。

`npm run build` 生成单文件离线 HTML；`npm run build:site` 生成原 GitHub Pages 发布目录；`node scripts/build-space.mjs` 将账号版打包到 `space/`，用于部署 Docker Space。

## 检查

```sh
npm test
npm run test:browser
node --test tests/account-browser/*.test.cjs
npx playwright test --config playwright.accounts.config.cjs
```

浏览器测试使用本机 Chrome。账号集成测试使用本地 Git 仓库验证实际保存、跨浏览器恢复和权限隔离。原访客后台的本地 D1 测试仍可运行：`npx playwright test --config playwright.admin.config.cjs`。

账号密码和部署密钥保存在本机凭据文件及 Space Secrets 中，公开源码只包含默认配置。登录信息文件位置与维护步骤见[部署说明](部署与后台.md)。
