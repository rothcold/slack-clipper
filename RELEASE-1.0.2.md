# Slack Clipper 1.0.2：正文格式修复与审核步骤

1.0.1 把解析结果转换成一个文本字符串，因此丢失了标题、列表编号、超链接目标、文字强调和命令缩进。1.0.2 改为从 DOM 节点提取结构，根据 Slack 原生 `rich_text` 类型构造消息，不把网页 HTML 或原始 Markdown 当成 Slack 标记。

## 用户可见的变化

- GitHub 仓库首页识别出 README 的 `article.markdown-body.entry-content[itemprop="text"]` 时，直接读取其可见内容，不从仓库导航推测正文。其他页面继续使用带 DOM 修复的 Mozilla Readability。
- 标题在独立段落中加粗。保留粗体、斜体、可见链接文字和 HTTP(S) 目标，以及有序/无序列表、子列表、引用、行内代码和代码块。命令中的空格、制表符及空行不再被压平。
- 单个选区按实际起止节点切取，不携带选区外的文字。脚本、表单、模板、明确隐藏的节点及复制按钮不进入正文。相对链接根据原网页的基准地址解析。页面提供的 `<!channel>`、`<@U123>` 或星号只是文字，不会生成提醒或样式。危险协议只保留标签文字。
- 在发出第一条前计算全部消息。每段都保留标题、原文链接和序号；长代码仍为代码块，链接续段保留目标，长列表跨消息保留编号。格式过密、超过 16 条消息，或正文超过 240,000 个 UTF-16 单元时整篇拒发，不截断。确认计数、遇错即停、不自动重试和工具栏触发规则不变。

这不是页面截图。Slack 没有 HTML 标题层级；字体、颜色、精确布局、语法着色和表格样式不复制。图片不上传。一个列表项里的多个段落或代码块会展开为顺序段落；跨块的同一项不会多生成编号。Readability 仍可能将普通页面的辅助内容排除在正文外。扩展不推断被其他元素遮挡的文字，也不抓取未加载的页面。

## 无需凭据的审核方法

1. 将 `slack-clipper-source-1.0.2.zip` 解压到空目录，用 Node.js 22.13+ 和 npm 执行以下命令。构建只打包清单内的文件，不读取浏览器配置或凭据。

   ```sh
   npm ci
   npm run lint
   npm run typecheck
   npm test
   npm run build
   npm run lint:firefox
   ```

2. `tests/fixtures/github-readme.html` 是本地编写的代表性样本。`tests/format.test.ts` 直接检查最终消息：两个独立加粗标题 `Security Model` 与 `Performance & Multiplexing`、从 3 开始的编号、嵌套项目、解析后的完整链接、代码的四个空格及制表符。测试还检查字面提及、不安全链接、隐藏内容、选区边界和长格式内容拼回后的完整性。
3. `npm test` 的发送测试使用模拟响应，不连接 Slack。可在一次性 Firefox 配置中临时加载 `dist/firefox/manifest.json`；Chrome 选择「加载已解压的扩展程序」并打开 `dist/chrome/`。首次点击只打开设置，保存设置本身不会发送。安装、权限、限制及凭据删除说明见 [README](README.md)。
4. `artifacts/` 中的 Firefox、Chrome 和源码 ZIP 均带 `1.0.2` 版本号。`npm run lint:firefox` 使用 `--warnings-as-errors`。原 Readability 补丁、出处和许可证仍在 `vendor/readability/`，没有修改 `node_modules` 或绕过检查。

本次验证不提供或使用真实凭据，也不向 Slack 投递消息。模拟测试验证的是发送的数据结构，不是某一版本 Slack 客户端的最终外观。审核不需要真实频道。如审核者另行决定核对客户端显示，仅使用自己获授权的专用测试频道和 webhook，不要在源码或审核反馈中粘贴该地址。

Slack 官方依据：[Incoming Webhooks 可使用消息布局块](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)、[富文本块](https://docs.slack.dev/reference/block-kit/blocks/rich-text-block/)、[富文本样式与链接示例](https://docs.slack.dev/block-kit/formatting-with-rich-text/)、[列表的 indent 和 offset](https://docs.slack.dev/reference/block-kit/block-elements/rich-text-list-element/)。
