# 阿里云自动部署

当前服务器使用 Ubuntu 24.04 + Node 22 + systemd 直接运行应用。
推送到 `main` 后，GitHub Actions 运行检查、通过 `STANDALONE_BUILD=1` 构建 Linux x64 standalone 包，上传并切换运行版本。
也可以在 Actions → Deploy Aliyun → Run workflow 手动发布 `main`。

## 当前状态

服务器专用账号已建立并通过 SSH 验证。GitHub `production` 环境已创建，配置了主机地址、主机公钥，并限定只有 `main` 能部署。
部署专用私钥已按用户授权保存到 `DEPLOY_SSH_KEY`（Base64 编码），首次自动部署、线上构建编号和页面检查已通过。
以后推送到 `main` 即可自动发布；运行记录见 GitHub Actions 的 `Deploy Aliyun`。

配置完成于 2026-10-15，线上提交为 `9416c7c`。投屏专用播放接口已上线；实际手机到接收端的投屏仍需真机验证。

## 一次性配置

1. 在本机生成专用密钥（不要使用个人常用 SSH 私钥）：

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/libretv_actions -C libretv-actions
   ```

   自动任务使用无口令专用密钥。私钥只保存到 GitHub Secret，不提交仓库、不粘贴到聊天。

2. 在可信的阿里云 Workbench 会话里，将本目录的 `bootstrap.sh`、`install-release.py` 和上述 `.pub` 公钥上传到同一个目录。运行：

   ```bash
   sudo bash bootstrap.sh ./libretv_actions.pub
   ```

   脚本创建独立的 `libretv-deploy` 账号，只授权它通过固定部署程序切换 LibreTV。
   部署程序由 root 持有，只接受 40 位提交 SHA，应用仍以 `libretv` 用户运行。
   SSH 公钥禁止端口转发、PTY 和代理转发；不会修改现有 admin 的登录方式。

3. 在 GitHub 仓库 `YangGuang-Cloud/LibreTV` 的 Settings → Environments 创建 `production`：

   - Environment variable `DEPLOY_HOST`：`47.117.118.220`
   - Environment secret `DEPLOY_SSH_KEY`：专用私钥文件的 Base64 单行编码（避免网页表单破坏换行），工作流会解码后使用。
   - Environment secret `DEPLOY_KNOWN_HOSTS`：`47.117.118.220 ssh-ed25519 公钥内容`。
     公钥内容取自第 2 步在可信服务器控制台打印的服务器 host key，不是部署账号的公钥。
   - Deployment branches 限定为 `main`。若希望推送后全自动，不设置 required reviewers。

   云防火墙需要允许 GitHub 托管 runner 访问 TCP 22；如已有来源 IP 限制，需按实际网络策略配置。

4. 将本次代码（包含投屏修复、构建编号和部署流程）提交并推送到 `main`，查看 Actions 结果。
   GitHub Secrets 尚未配置时，构建仍可执行，但部署步骤会明确报缺少配置，不会修改线上服务。

## 发布和回滚

- 验证 lint、类型、单元测试和回滚测试，再在 Ubuntu 24.04/Node 22 构建。
- 构建包作为 GitHub artifact 保留 7 天；SSH 严格验证已配置的服务器主机密钥。
- 服务停止前完成上传、解压和基本检查。切换需要短暂重启，不是零停机发布。
- `/api/status` 必须返回与提交 SHA 一致的 `buildId`，并且 `passwordRequired=true`。
- 健康检查失败或启动失败会切回旧目录并重启；部署任务仍标为失败。
- 同一时刻只部署一个版本，正在发布时不会因新推送被取消。
- 密码文件 `/etc/libretv/runtime.env`、数据 `/var/lib/libretv`、nginx 和证书不在发布包内。
- 旧版本保留在 `/opt/libretv/releases`，首次安装目录另存为 `runtime-backup-*`；暂不自动清理。
  后续可在确认当前 `runtime` 链接和保留版本后清理，避免磁盘逐渐用满。
- 自检只验证应用启动、提交编号及密码配置，不替代真机投屏或实际视频源播放测试。
- 此流程只更新服务器和网页。iOS 客户端仍需 Xcode 编译安装。

## 本地验证

```bash
python3 -m unittest discover -s scripts/deploy -p 'test_*.py'
bash -n scripts/deploy/bootstrap.sh
npm test
npm run typecheck
```
