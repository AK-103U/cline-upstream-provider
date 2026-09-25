<p align="center">
  <img src="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/icon.png" width="96" alt="cline-upstream-provider">
</p>

<h1 align="center">cline-upstream-provider</h1>

<p align="center">
  English · <a href="README.md">中文</a>
</p>

<p align="center">
Shows which model provider this Cline request actually routed to.
</p>

## Install and configure

### DeepSeek Harness

Sidebar **Plugins** → **Add plugin**, and enter the package name:

```text
@ak-103u/cline-upstream-provider
```

Or install it from the command line:

```bash
dsh plugin --profile web add @ak-103u/cline-upstream-provider
```


Once installed, the routing chain shows under the composer (for example `deepseek → alibaba`), with vendor marks and brand colours, scoped per session, following the light/dark theme, and taking no space while there is no routing data.

### pi

Install it from npm:

```bash
pi install npm:@ak-103u/cline-upstream-provider
```

The footer shows the real routing chain top-right (for example `deepseek (planner) → baseten`) without disturbing the token, cache, cost and throughput figures on the line below; `/cline-route` prints the current chain on demand.       
## Preview

<p align="center"><strong>DeepSeek Harness</strong> — one line under the composer</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/docs/preview-dsh-dark.en.svg">
    <img alt="DeepSeek Harness routing preview" src="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/docs/preview-dsh-light.en.svg">
  </picture>
</p>

<p align="center"><strong>pi</strong> — top-right of the footer</p>

<p align="center">
  <img alt="pi status line preview" src="https://raw.githubusercontent.com/AK-103U/cline-upstream-provider/main/docs/preview-pi-dark.en.svg">
</p>

---

MIT · [LICENSE](https://github.com/AK-103U/cline-upstream-provider/blob/main/LICENSE)