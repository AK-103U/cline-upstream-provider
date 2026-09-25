<p align="center">
  <img src="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/icon.png" width="96" alt="cline-upstream-provider">
</p>

<h1 align="center">cline-upstream-provider</h1>

<p align="center">
  <a href="https://github.com/AK-103U/cline-upstream-provider/blob/main/README.en.md">English</a> · 中文
</p>

<p align="center">
实时显示 Cline 本次请求实际路由到的模型提供商。
</p>

## 安装与配置

### DeepSeek Harness

侧边栏 **插件** → **添加插件**，填入包名：

```text
@ak-103u/cline-upstream-provider
```

命令行安装：

```bash
dsh plugin --profile web add @ak-103u/cline-upstream-provider
```


安装后在输入框下方展示路由链路（如 `deepseek → alibaba`）。支持厂商 Logo 与品牌色渲染，状态随会话隔离，适配亮/暗色主题，无路由数据时不占位。

### pi

通过 npm 安装：

```bash
pi install npm:@ak-103u/cline-upstream-provider
```

底栏右上角展示实际路由链（如 `deepseek (planner) → baseten`），不影响次行 Token、缓存、费用与吞吐统计；支持通过 `/cline-route` 命令直接打印当前路由详情。
## 效果预览

<p align="center"><strong>DeepSeek Harness</strong> — 输入框下方一行</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/docs/preview-dsh-dark.svg">
    <img alt="DeepSeek Harness 路由预览" src="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/docs/preview-dsh-light.svg">
  </picture>
</p>

<p align="center"><strong>pi</strong> — 底栏右上角</p>

<p align="center">
  <img alt="pi 状态栏预览" src="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/docs/preview-pi-dark.svg">
</p>

---

MIT · [LICENSE](https://github.com/AK-103U/cline-upstream-provider/blob/main/LICENSE)