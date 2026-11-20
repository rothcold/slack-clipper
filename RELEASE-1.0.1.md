# Slack Clipper 1.0.1：发布说明与审核步骤

## 此版本的变化

1.0.0 捆绑的 Mozilla Readability 0.6.0 有两处把 HTML 字符串写回 `innerHTML` 的操作。1.0.1 从源代码中移除了这两处写入，没有关闭检查，也没有改用另一个 HTML 解析接口。

- `_grabArticle`：在开始评分前，深拷贝正文子节点作为快照。短文需要重试时，用快照的新副本还原子节点。每次评分仍然独立，解析器仍可选取内容最长的一次。
- `_unwrapNoscriptImages`：如果 `<noscript>` 已经含有单个图片子树，则在文档副本内直接移动这个子树，保留原有的图片属性合并逻辑。如果内容只是看起来像标签的文本，则不解析它。图片本身不会发送到 Slack；可读图注仍可作为正文发送。

原文档不参与上述修改。Slack 消息格式、完整正文分段、目标地址校验和权限没有变化；保存设置不会发送。这个修复不等同于 AMO 已批准本版本。

## 从源码重建

解压 `slack-clipper-source-1.0.1.zip` 到空目录，在 `package.json` 所在目录运行以下命令。需要 Node.js 22.13+ 和 npm；首次安装依赖需要访问 npm 注册表，不需要 Slack 账号、密钥或浏览器配置。验证环境使用 Node.js 24.13.0 和 npm 11.6.2。

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run lint:firefox
```

`artifacts/` 内有 Firefox、Chrome 和源码三个 ZIP。条目顺序和 ZIP 时间戳固定。可用 `sha256sum artifacts/*1.0.1.zip` 与收到的同名文件逐一比对。源码包按 `scripts/source-files.json` 正向清单生成，不包含 `node_modules`、生成的浏览器包、浏览器配置、日志或本机设置。

`src/page.ts` 直接导入 `vendor/readability/Readability.cjs`。`@mozilla/readability@0.6.0` 仅作为开发依赖提供原版对照和类型；构建不修改 `node_modules`，不从网络下载补丁。`vendor/readability/NOTICE.txt` 记录上游版本、提交和文件摘要；`LICENSE.md` 为 Apache 2.0 许可证。要逐字核对差异，在装好依赖后运行（需要 `patch` 和 `cmp`）：

```sh
tmp=$(mktemp)
patch -s -o "$tmp" node_modules/@mozilla/readability/Readability.js < vendor/readability/upstream.patch
cmp "$tmp" vendor/readability/Readability.cjs
rm "$tmp"
```

## 无 Slack 凭据的审核流程

1. 运行上述命令。`web-ext lint` 对整个 Firefox 构建执行检查，使用 `--warnings-as-errors`，预期 0 错误、0 警告、0 提示。
2. 查看 `tests/readability.test.ts`。短文用例触发全部四次评分并从后续尝试找回段落；图片用例覆盖已解析节点和纯文本两种 `<noscript>` 形态。测试禁止给 `innerHTML` 赋值，并在启用脚本的本地固定页面上检查脚本、事件处理器计数及原 DOM 的变更记录。`npm test` 同时检查完整正文分段和异常投递，发送端使用模拟响应。
3. 在一次性 Firefox 配置中，通过 `about:debugging#/runtime/this-firefox` 临时载入 `dist/firefox/manifest.json`。打开普通 HTTP(S) 页面，点击图标。未配置时应只打开设置；关闭设置并再点图标，仍不会发送。输入无效地址，保存应被拒绝。Chrome 可在 `chrome://extensions` 加载 `dist/chrome/` 执行相同检查。

本次验证没有向真实 Slack 发送消息，也没有提供可用的 webhook。审核不需要真实投递。仅当审核者自行决定验证实际送达、且有相应授权时，才使用自己的测试频道和 webhook：保存后回到不含私密信息的网页，主动点击图标，核对频道中的标题、原文链接、全文和分段编号。完成后删除本机设置，并按需在 Slack 撤销 webhook。请勿把 webhook 写入审核意见、截图或源码。
