# LibreTV

LibreTV Next.js 迁移版：免费在线视频聚合搜索与观看平台。基于 Next.js 15（App Router）+ TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

> 🏠 **官网**：[LibreTV 官网](https://libretv.is-an.org/)
>
> 🌐 **演示站**：[tv.bagiinlink.eu.org](https://tv.bagiinlink.eu.org)（访问密码：`libretv`）
>
> 📖 **完整文档**：[文档首页](https://libretv.is-an.org/wiki/) · [架构](https://libretv.is-an.org/wiki/Architecture.html) · [部署](https://libretv.is-an.org/wiki/Deployment.html) · [配置](https://libretv.is-an.org/wiki/Configuration.html) · [数据源](https://libretv.is-an.org/wiki/Data-Sources.html) · [直播 / IPTV](https://libretv.is-an.org/wiki/Live-IPTV.html) · [首页推荐](https://libretv.is-an.org/wiki/Recommendations.html) · [播放器](https://libretv.is-an.org/wiki/Player.html) · [代理与安全](https://libretv.is-an.org/wiki/Proxy-Security.html) · [FAQ](https://libretv.is-an.org/wiki/FAQ.html)
>

<p align="center">
 <a href="https://trendshift.io/repositories/26551?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-26551" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/26551" alt="LibreSpark%2FLibreTV | Trendshift" width="250" height="55"/></a> <a href="https://trendshift.io/repositories/26551?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-26551" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/26551/weekly?language=JavaScript" alt="LibreSpark%2FLibreTV | Trendshift" width="250" height="55"/></a>
</p>

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **直播 / IPTV**：M3U 订阅解析，`/live` 页面按分组浏览、搜索频道并站内播放（HLS + HTTP-FLV），支持 XMLTV 节目单（EPG）与频道收藏；直播流经专用长连接代理（`/api/live/stream`）转发
- **进度同步**：播放进度与观看历史存于本机 IndexedDB，精确到秒的续播
- **换源测速**：跨源搜索同名资源并测速排序，一键切换保留集数位置
- **源测试与订阅**：一键探活点播源与直播源（支持批量测活）；搜索时自动记录各源健康度，连续失败的源按阶梯时长自动停用（30 分钟 → 24 小时 → 长期），可一键恢复；订阅远程源列表（一份 LibreTV-SourceList JSON 可同时下发点播源与直播源，也可直接填 TVBOX 配置地址，自动导入其中可直接使用的接口），可导出分享
- **首页推荐**：豆瓣（电影/剧集分类浏览）、Bangumi 新番放送表或影视榜单（豆瓣周榜 + 百度热播，经 60s API），设置中切换；均服务端直连 + 缓存，Bangumi/榜单免 key 免配置（`60S_API_BASE` 可指向自部署 60s 实例）
- **PWA**：可安装到桌面 / 主屏幕，亮暗双主题无首屏闪烁

## 部署

### 当前服务器部署

当前使用阿里云 Ubuntu 24.04 + Node.js 22 + systemd 直接运行应用。
推送到 `main` 后，GitHub Actions 自动检查、构建独立运行包并部署到服务器，详见[自动部署说明](scripts/deploy/README.md)。

服务器运行配置位于 `/etc/libretv/runtime.env`，持久化数据位于 `/var/lib/libretv`，与应用发布目录分开保存。

> 对外部署请使用 HTTPS，保护访问密码和管理员密码。会话 cookie 的 `Secure` 默认按 `x-forwarded-proto` 自动推导，也可用 `COOKIE_SECURE` 显式覆盖。反向代理应正确设置协议头，并覆盖客户端传入的 IP 转发头，避免登录限流被伪造 IP 绕过。

### 手动运行

```bash
npm install
PASSWORD=your-password npm run build
PASSWORD=your-password npm start   # 监听 8080
```

手机或其他局域网设备连接时，运行 `npm run start:lan`（开发时用 `npm run dev:lan`），明确监听 `0.0.0.0:8080`。客户端填写 `http://Mac的局域网IP:8080`，不能填写 `127.0.0.1` 或 `0.0.0.0`。设备需连接同一局域网，Mac 保持开机且服务器运行；如 macOS 询问是否允许入站连接，请允许。IP 变化后需更新客户端地址。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PASSWORD` | 是 | 访问密码；未设置时站点会提示管理员配置 |
| `SOURCE_MODE` | 否 | `client`（默认）保留浏览器自配源；`server` 由管理员统一管理点播源，搜索和详情只采用服务器配置 |
| `ADMIN_PASSWORD` | server 模式管理时必填 | 独立管理员密码，用于修改共享点播源；与观看密码分开设置，不下发到客户端 |
| `SERVER_DATA_DIR` | 否 | 服务器点播源持久化目录，默认 `.data`；当前服务器使用 `/var/lib/libretv`，更新应用时须保留 |
| `PROXY_SECRET` | 否 | 会话/代理签名密钥；不设置时从 PASSWORD 派生（多实例部署建议显式设置） |
| `DEFAULT_SOURCES` | 否 | 预置采集站（JSON 数组），用户端自动出现且默认勾选，详见[配置文档](https://libretv.is-an.org/wiki/Configuration.html) |
| `REQUEST_TIMEOUT` | 否 | 代理上游请求超时（毫秒），默认 8000 |
| `MAX_RETRIES` | 否 | 代理请求重试次数，默认 1 |
| `SEARCH_MAX_PAGES` | 否 | 每个搜索源最多抓取的页数（1-50，默认 5）。第一页会读取源站 `pagecount`，实际页数 = min(源站总页数，该值)；页间并行请求，单页失败只丢该页 |
| `SEARCH_SOURCE_TIMEOUT_MS` | 否 | 单个搜索源的总死线（毫秒，3s-60s，默认 10000）：该源所有分页请求须在时限内完成，到点中断并将其标记为「超时」；健康度自动停用也以此为超时判定依据 |
| `USER_AGENT` | 否 | 代理请求使用的 UA（豆瓣封面防盗链等场景），默认 Chrome UA |
| `FALLBACK_CORS_PROXY` | 否 | 豆瓣推荐数据直连被拒时降级使用的 CORS 代理地址 |
| `COOKIE_SECURE` | 否 | 显式覆盖会话 cookie 的 `Secure` 标记（`true` / `false`）；默认按请求协议自动推导。反向代理未正确传递 `x-forwarded-proto` 导致 HTTPS 下登录失效时，设为 `true` 可解 |
| `60S_API_BASE` | 否 | 影视榜单推荐源（60s API）实例地址，默认 `https://60s.crystelf.top`；有限流，高频使用可[自部署](https://github.com/vikiboss/60s) |
| `DEFAULT_LIVE_SOURCES` | 否 | 预置直播源（M3U 订阅），JSON 数组：`[{"name":"源名","url":"https://.../list.m3u","epg":"https://.../epg.xml.gz"}]`，`epg` 为可选的 XMLTV 节目单地址 |
| `DEFAULT_SUBSCRIPTIONS` | 否 | 预置数据源订阅（LibreTV-SourceList JSON 链接，也接受 TVBOX 配置地址），JSON 数组：`["https://.../sources.json", {"url":"https://.../list.json","name":"名称"}]`。首次访问自动导入点播源与直播源，之后每 24h 静默刷新；用户删除后不再自动加回 |
| `DEFAULT_RECOMMEND_SOURCE` | 否 | 首页推荐数据源的默认值（`douban` / `bangumi` / `hot-list`，出厂默认 `hot-list`）；仅对未在设置中主动选择过的用户生效，用户的选择始终优先 |
| `LIVE_ALLOW_PRIVATE` | 否 | 设为 `1` 时允许直播流代理访问内网/保留地址（自建 IPTV 场景），默认关闭以维持 SSRF 防护 |

## 服务器 + 原生客户端

本仓库继续提供 Next.js 服务端和网页客户端。iOS / tvOS 客户端建议建独立 Git 仓库，使用 Swift + SwiftUI + AVKit，通过下列 HTTP 接口连接此服务；无须复制或运行 Node.js 代码。

### 统一管理点播源

本地运行在 `.env.local` 配置；当前服务器在 `/etc/libretv/runtime.env` 配置：

```dotenv
PASSWORD=your-viewer-password
SOURCE_MODE=server
ADMIN_PASSWORD=your-separate-admin-password
DEFAULT_SOURCES=[{"name":"示例源","url":"https://example.com/api.php/provide/vod"}]
```

重启后，普通网页 `/` 作为观看客户端，服务器模式下设置中不再显示源管理。管理员进入独立后台 `/admin`，使用 `ADMIN_PASSWORD` 登录后添加、编辑和保存点播源。后台登录无需先登录观看网页；两者使用独立 Cookie，观看密码不能取得管理权限，退出后台不影响观看登录。后台会话有效期为 8 小时。

保存是整份配置替换，点击保存前可核对列表；有未保存改动时可撤销。其他网页每分钟同步一次，原生客户端在启动、返回前台或搜索前重新获取配置。

首次读取使用 `DEFAULT_SOURCES`；保存后以数据目录的 `sources.json` 为准，环境预置不再覆盖磁盘配置。管理员删除全部源后不会自动恢复预置源。源编号在修改地址时保留，支持客户端稳定引用；新增源生成新编号。请定期备份数据目录，更新应用时保留该目录。当前文件存储适用于单实例部署，不能在多个实例中共享写入同一文件。

服务器模式下，客户端提交的源地址、名称、成人标记和详情页根地址均不能覆盖服务器配置。网页配置更新后直接生效，无须重新安装原生客户端。当前统一管理范围为**点播源**；直播源、订阅自动更新、每人独立账号与跨设备观看记录尚未迁移到服务器，观看记录仍由客户端保存。现阶段以共享观看密码登录，管理员使用独立密码。

### 客户端接口（v1）

以下接口使用现有 `ltv_session` Cookie 鉴权。原生客户端使用持久 Cookie 存储，登录后后续请求携带 Cookie；播放器访问本站代理 manifest、分片和密钥时也必须携带同一 Cookie，不要把本站 Cookie 附加到第三方直连地址。

| 接口 | 请求 | 说明 |
| --- | --- | --- |
| `/api/status` | GET | 无须登录即可获取版本、登录状态、`sourceMode`；匿名响应不含源配置 |
| `/api/auth` | POST `{"password":"观看密码"}` | 验证成功后设置 HttpOnly 会话 Cookie |
| `/api/auth` | DELETE | 清除客户端会话 Cookie |
| `/api/server/config` | GET，已登录 | 返回 `apiVersion: 1`、`revision`、`sources: [{key,name,isAdult}]`，不含源地址 |
| `/api/search` | POST `{"wd":"片名","filterAdult":true}` | server 模式自动搜索服务器全部点播源；可选 `sourceKeys: ["源编号"]` 限定来源 |
| `/api/search?stream=1` | 同上 | NDJSON：逐源 `source` 事件及最终 `done` 事件；也可直接使用普通 JSON 模式 |
| `/api/detail?id=影片ID&sourceKey=源编号` | GET，已登录 | 返回 `episodes`、与地址同序的 `episodeTitles`（无名称时为空字符串）和 `videoInfo`，使用服务器当前源配置 |
| `/api/proxy?url=编码后的播放地址` | GET，已登录 | 代理播放列表、分片及密钥；HLS 播放列表内地址自动重写 |
| `/api/admin/auth` | GET / POST `{"password":"管理员密码"}` / DELETE | 独立后台会话状态、登录和退出；签发 `ltv_admin_session` HttpOnly Cookie，不接受观看密码 |
| `/api/admin/sources` | GET / PUT，后台会话 Cookie | 管理员读取/保存共享源，普通客户端不调用；PUT body 为 `{sources,revision}`，旧版本返回 409 |
| `/api/admin/episodes` | GET / POST，后台会话 Cookie | 后台搜索节目、读取/修改分集资料、查询和导入公开节目资料；不接受观看会话 |

### 分集标题补充

`server` 模式下，后台的“分集资料”页面可搜索当前资源源里的节目，手动编辑每集标题，也可从 Bangumi 或 TVmaze 查询并导入。显示优先级为手动修正、源里的真实标题、补充资料；纯“第01集”标签视为没有标题。客户端仍读取 `episodeTitles`，新增 `episodeTitleOrigins` 和 `episodeAttributions` 用于来源说明。

缺失标题时默认尝试自动匹配。自动匹配须片名和年份明确、候选唯一、源编号为连续正篇集序、资料集数一致；不猜译名，也不把特别篇、上下集、合并版按数组位置硬套。TVmaze 后续季目前需在后台指定季数导入，国剧和综艺的中文资料覆盖有限，查不到时可以手动填写。设置 `EPISODE_METADATA_AUTO=false` 可关闭全局自动查询，每部节目也可单独停用。外部查询有超时和失败缓存，查询失败不影响播放。

分集资料保存在 `SERVER_DATA_DIR/episode-metadata.json`（本机默认 `.data/episode-metadata.json`），与点播源共用持久化目录。保存采用版本检查和原子写入。资料绑定当前源、节目以及分集地址顺序；播放列表变化时旧资料暂停使用，后台核对后重新保存。后台修改后，重新打开影片详情即可获取，原始详情缓存不会覆盖新标题。

公开节目资料来自 [Bangumi API](https://bangumi.github.io/api/) 和 [TVmaze API](https://www.tvmaze.com/api)。使用 TVmaze 补充名称的页面保留 TVmaze 来源链接及 CC BY-SA 标注；客户端展示补充名称时应同时展示 `episodeAttributions`。自动查询仅获取公开节目和分集资料，不分析或下载视频内容。

原生客户端只需让用户设置服务器地址和观看密码。401 表示登录失效；503 表示未配置观看密码；源编号失效时重新获取配置后重试。访问同一局域网服务器时，使用服务器的局域网地址，不能使用手机上的 `localhost`。开发时可用 `npm run dev -- --hostname 0.0.0.0`；公开部署使用生产构建、HTTPS 和可靠的反向代理。iOS 本地开发还需要按实际连接方式配置本地网络权限及 HTTP 开发例外，正式部署使用 HTTPS。

## 使用说明

1. **添加点播源**：设置 → 源管理 → 点播源 → 添加 API，填入 Apple CMS 采集站地址（如 `https://example.com/api.php/provide/vod`），可选填详情页地址（部分源需要爬详情页提取播放地址）。
2. **搜索**：勾选点播源后输入片名；搜索通过服务端聚合，个别源失败不影响整体结果。
3. **播放**：详情弹窗选择剧集进入 `/watch`；支持快捷键（空格/←→/↑↓/F/Alt+←→）、移动端长按 3 倍速、自动连播、换源测速。观看/暂停时后续分片自动缓存到本地（设置可关），播放页可「下载本集」（TS/MP4）离线观看。
4. **进度与历史**：自动保存在本设备 IndexedDB，仅定位信息入库，播放时自动同步最新剧集。
5. **配置迁移**：设置 → 数据 → 配置导入导出（兼容旧版 LibreTV-Settings JSON 的历史记录迁移）。

## 直播 / IPTV

1. **添加直播源**：设置 → 源管理 → 直播源 → 填入 M3U/M3U8 地址（可选填 XMLTV 节目单地址），添加后自动探活并显示频道数量；也可在「源管理 → 数据源订阅」中与点播源一起订阅导入；部署者还可用 `DEFAULT_LIVE_SOURCES` 环境变量预置。
2. **观看**：进入「直播」页，按分组标签筛选或搜索频道，点击即播；支持 HLS（m3u8）与 HTTP-FLV 两种直播流，直连失败自动走代理通道重试。
3. **节目单**：频道带 `tvg-id` 且订阅配置了 EPG 地址时，展示当前/接下来节目与播放进度。
4. **收藏与导出**：频道可收藏；订阅可一键导出为标准 M3U 文件，供 PotPlayer / VLC 等外部播放器使用。

完整说明见 [直播 / IPTV 文档](https://libretv.is-an.org/wiki/Live-IPTV.html)。

> ⚠️ 项目不内置任何频道源，也不存储、不制作任何直播内容，仅提供第三方公开播放列表的解析与播放能力，内容的合法性由对应数据源负责。内网自建源默认被 SSRF 防护拦截，自部署者可显式设置 `LIVE_ALLOW_PRIVATE=1` 放行。

## 数据源订阅 / 分享

数据源（点播源 + 直播源）可以 **导出为一份 JSON → 托管到公开 URL → 他人在「设置 → 源管理 → 数据源订阅」里填入该 URL 订阅**。

托管地址没有特殊要求，可用 [npoint.io](https://www.npoint.io/) 免费托管 JSON（粘贴内容即可得到一个公开 URL），Gist、对象存储、任意静态托管同样可用。

### 订阅格式（LibreTV-SourceList JSON）

```json
{
  "name": "我的源列表",
  "version": 2,
  "sources": [
    {
      "name": "示例点播源",
      "url": "https://example.com/api.php/provide/vod",
      "detail": "https://example.com",
      "isAdult": false
    }
  ],
  "liveSources": [
    {
      "name": "示例直播源",
      "url": "https://example.com/list.m3u",
      "epg": "https://example.com/epg.xml.gz"
    }
  ]
}
```

**字段说明**：

| 字段 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | 顶层 | string | 否 | 列表名称，订阅后显示在订阅条目上；缺省时显示订阅地址主机名 |
| `version` | 顶层 | number | 否 | 格式版本，当前为 `2`（新增 `liveSources`）；导入端目前忽略该字段 |
| `sources` | 顶层 | array | 否 | **点播源**数组（Apple CMS 采集站），最多 100 个，超出部分截断 |
| `sources[].name` | 项 | string | 否 | 源显示名；缺省时使用 URL 主机名 |
| `sources[].url` | 项 | string | **是** | Apple CMS 采集接口地址（公网 http/https），结尾 `/` 自动去除 |
| `sources[].detail` | 项 | string | 否 | 详情页根地址，用于列表接口拿不到播放地址、需要爬详情页提取 m3u8 的源 |
| `sources[].isAdult` | 项 | boolean | 否 | 成人内容标记，默认 `false`。标记为 `true` 的源名称旁显示 **(18+)** 徽章；设置中的「成人内容过滤」开启（默认开启）时该源不可勾选、不参与搜索，需先关闭过滤才能启用 |
| `liveSources` | 顶层 | array | 否 | **直播源**数组（M3U 播放列表），最多 50 个，超出部分截断 |
| `liveSources[].name` | 项 | string | 否 | 源显示名；缺省时使用 URL 主机名 |
| `liveSources[].url` | 项 | string | **是** | M3U 播放列表地址（http/https） |
| `liveSources[].epg` | 项 | string | 否 | XMLTV 节目单地址（`xml` / `xml.gz`），用于 `/live` 页展示节目单；地址非法时只丢弃该字段、保留整条源 |

**兼容与限制**：

- 只写 `sources` 的老订阅照常可用（纯点播），只写 `liveSources` 则是纯直播订阅；两者都缺时提示「订阅内容格式不正确」；裸数组 `[{ "name": "...", "url": "..." }]` 视为点播源；
- 按 `url` 去重（先到先得）；非 http(s) 地址会被过滤；**点播源**另需为公网地址（内网/回环/保留地址会被静默过滤），**直播源**在部署者设置 `LIVE_ALLOW_PRIVATE=1` 时可使用内网自建源地址；
- 订阅由**服务端**拉取（拉取前经过 SSRF 校验），因此订阅地址**无需配置 CORS**，Gist、对象存储、任意静态托管均可。

### 兼容 TVBOX 配置

订阅地址也可以直接填 **TVBOX 配置**（形如 `{"sites": [...], "lives": [...], "parses": [...]}`）：服务端按内容结构自动识别格式，无需手动选择。

- **点播源**：导入 `sites` 中 `type: 1` 的 JSON 接口（即 Apple CMS 采集站）；部分共享配置省略 `type` 或写成 `0`，但地址命中 `api.php/provide/vod` 时同样导入；站点自身标记 `searchable: 0`（不可搜索）时跳过；
- **直播源**：导入 `lives` 中 `type: 0`（或省略）的 M3U 播放列表，`epg` 字段一并带上；txt 频道列表与单仓 JSON 不支持；
- **Spider 类站点会跳过**：`type: 3` 的 Spider（`csp_*` / `.jar` / `.js` / `.py`）需要 TVBOX 自身的 Spider 引擎才能运行，Node 侧无法执行；XML 接口、外链 JSON 同理。被跳过的条目不影响其余导入，导入结果会如实提示，如「已同步 8 个点播源、2 个直播源（TVBOX 配置）；跳过 96 个不可用条目（Spider 引擎 92、XML 接口 4）」；
- TVBOX 配置常含上百条站点且以 Spider 为主，**只导入个位数到十几个属正常现象**；
- **格式容错**：配置里的 `//` 注释、尾随逗号、字符串内未转义的换行会自动修正后再解析（共享配置中很常见，TVBOX 客户端用的 fastjson 同样容忍这些写法）；
- 其他限制：订阅地址需直接返回 JSON（Base64 / 压缩包装的分享链接不支持）；TVBOX「多仓」配置（顶层为 `urls` 数组）不支持，请填单仓配置；地址公网校验、去重与数量上限与上方格式完全一致。

### 订阅行为

- **订阅**：设置 → 源管理 → 数据源订阅 → 填入订阅地址 → 「订阅」，导入的点播源自动勾选、直播源自动启用，均带「订阅」标识，条目上显示「点播 N · 直播 M」；
- **同步**：订阅条目上的 **⟳** 手动强制同步，整体替换该订阅名下的点播源与直播源；
- **管理边界**：订阅源以远端列表为准，单独编辑会在下次同步时被覆盖，单独移除会在重新同步时恢复；如需调整请改远端列表，或直接删除整个订阅。删除订阅时点播源全部移除；直播源为**多归属共享**——同一 M3U 可被多个订阅引用（名称/EPG 以首次导入为准），删除订阅或远端列表中移除该源后再同步，都只摘除本订阅的引用，仅当不再被任何订阅引用时才移除该源，手动添加的源不受同步影响，**收藏的频道始终保留**；
- **导出分享**：设置 → 源管理 → 数据源订阅 → 「导出数据源」，把当前全部点播源与直播源（预置 + 手动 + 订阅，按 URL 去重）导出为上述 JSON；也可用「发布为链接」，把当前**已勾选启用**的源一键上传到公开粘贴板（paste.rs，失败自动降级 0x0.st），直接返回可填入订阅框的 URL，无需自备托管。注意：发布的内容**公开可读**，且每次发布生成新链接、不支持覆盖更新，需长期稳定请用导出 + 自行托管。

> 订阅由服务端拉取（经过 SSRF 校验），因此订阅地址无需配置 CORS。完整说明见 [数据源文档](https://libretv.is-an.org/wiki/Data-Sources.html)。

## 开发

```bash
npm install
PASSWORD=dev-password npm run dev   # http://localhost:8080
npm test                            # 核心库单元测试（cms-parser / m3u8 / ssrf）
npm run typecheck
```

测试范围、发布流程与文档结构见 [开发文档](https://libretv.is-an.org/wiki/Development.html)。

## 发布新版本

版本号以 `package.json` 为单一来源。需要升级版本号时，运行 `npm version patch`（或 `minor` / `major`），随代码一起提交并推送到 `main`。

GitHub Actions 的 `Deploy Aliyun` 流程会在检查通过后自动构建并部署；也可以手动触发。发布不依赖版本标签。部署、备份范围与自动回滚机制见[自动部署说明](scripts/deploy/README.md)。

## 安全说明

- 密码只保存在服务端环境变量中，前端不持有任何可重放凭证。
- 登录接口有 IP 速率限制（10 次 / 10 分钟）。
- 代理内置 SSRF 防护：拒绝内网/保留地址（含 DNS 解析后校验），仅放行 http(s)。
- 实际 socket 连接使用安全 DNS lookup，防止预检与连接间 DNS 重绑定；每次重定向重新校验。
- 鉴权代理内容使用 `private, no-store`，仅匿名图片白名单的成功图片允许公共缓存。
- 未登录的状态接口不下发源和订阅地址；管理员源配置接口另需 `ADMIN_PASSWORD`。
- 未登录会话仅允许代理图片类目标（豆瓣封面防盗链需要）。

## 衍生作品

| 项目 | 说明 |
| --- | --- |
| [OrionTV](https://github.com/orion-lib/OrionTV) | Apple TV / Android TV 客户端（React Native TVOS + Expo），配合 MoonTV 使用 |
| [LunaTV](https://github.com/MoonTechLab/LunaTV) | 影视聚合站（Next.js），支持 Redis / Upstash 等多存储后端 |
| [Selene-TV](https://github.com/MoonTechLab/Selene-TV) | Android TV（Leanback）客户端，Kotlin + Compose，对接 MoonTV / Helios |
| [EchoTV](https://github.com/hoowhoami/EchoTV) | Flutter 全平台客户端（已归档） |
| [WarHutTV](https://github.com/OuOumm/WarHutTV) | Go + React 的自托管影视聚合站 |
| [DecoTV](https://github.com/Decohererk/DecoTV) | 聚合播放站（原 KatelyaTV） |
| [Joyflix](https://github.com/jeffernn/Joyflix-Mac-Objective-C) | macOS 原生影视聚合客户端（Objective-C） |
| [MoonCakeTV](https://github.com/MoonCakeTV/MoonCakeTV) | 影视聚合搜索站（Next.js），文件存储、一键脚本部署 |
| [OrangeTV](https://github.com/djteang/OrangeTV) | 跨平台影视聚合播放器（Next.js），Kvrocks/Redis/Upstash 多存储与多端同步 |

> 旧版 LibreTV（静态 HTML + Express）完整代码见 [backup-2025 分支](https://github.com/LibreSpark/LibreTV/tree/backup-2025)。

## 免责声明

本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力，内容的合法性由对应数据源负责。

☕ 觉得有用的话，可以到 [AFDIAN](https://afdian.com/a/veehub) 请我喝杯咖啡。
