# Luna12TV · 月十二影视

Luna12TV（月十二影视）：面向自己与亲友使用的简洁在线视频聚合搜索与观看平台，无内嵌广告、无商业化功能。基于 [LibreTV](https://github.com/LibreSpark/LibreTV) 定制，保留原项目署名与 AGPL-3.0 许可。基于 Next.js 15（App Router）+ TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

> 🏠 **上游官网**：[LibreTV 官网](https://libretv.is-an.org/)
>
> 🌐 **上游演示站**：[tv.bagiinlink.eu.org](https://tv.bagiinlink.eu.org)（访问密码：`libretv`）
>
> 📖 **上游完整文档**：[文档首页](https://libretv.is-an.org/wiki/) · [架构](https://libretv.is-an.org/wiki/Architecture.html) · [部署](https://libretv.is-an.org/wiki/Deployment.html) · [配置](https://libretv.is-an.org/wiki/Configuration.html) · [数据源](https://libretv.is-an.org/wiki/Data-Sources.html) · [直播 / IPTV](https://libretv.is-an.org/wiki/Live-IPTV.html) · [首页推荐](https://libretv.is-an.org/wiki/Recommendations.html) · [播放器](https://libretv.is-an.org/wiki/Player.html) · [代理与安全](https://libretv.is-an.org/wiki/Proxy-Security.html) · [FAQ](https://libretv.is-an.org/wiki/FAQ.html)
>

<p align="center">
 <a href="https://trendshift.io/repositories/26551?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-26551" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/26551" alt="LibreSpark%2FLibreTV | Trendshift" width="250" height="55"/></a> <a href="https://trendshift.io/repositories/26551?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-26551" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/26551/weekly?language=JavaScript" alt="LibreSpark%2FLibreTV | Trendshift" width="250" height="55"/></a>
</p>

> 安装到桌面或主屏幕时显示为 Luna12TV。个人数据以服务器账号为准，浏览器只保留页面内存状态及视频缓存等设备数据。

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **直播 / IPTV**：M3U 订阅解析，`/live` 页面按分组浏览、搜索频道并站内播放（HLS + HTTP-FLV），支持 XMLTV 节目单（EPG）与频道收藏；直播流经专用长连接代理（`/api/live/stream`）转发
- **账号数据**：历史、进度、搜索、直播收藏及个人设置直接保存到服务器；页面仅使用内存缓存，刷新后重新读取
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
| `PASSWORD` | 共享密码模式必填 | 访问密码；账号模式不使用此密码登录 |
| `AUTH_MODE` | 否 | `password`（默认）共享密码；`account` 使用个人账号，注册必须提供管理员发放的授权码 |
| `BETTER_AUTH_URL` | 账号模式必填 | 站点访问源地址，例如 `https://tv.example.com`，不含路径；本地可用 `http://localhost:8080` |
| `BETTER_AUTH_SECRET` | 账号模式必填 | 至少 32 字符的随机密钥，可用 `openssl rand -hex 32` 生成；更改会使会话失效 |
| `SOURCE_MODE` | 否 | `client`（默认）保留浏览器自配源；`server` 由管理员统一管理点播源，搜索和详情只采用服务器配置 |
| `ADMIN_USERNAME` | 否 | 独立管理员账号名，默认 `admin`；与个人观看账号分开 |
| `ADMIN_PASSWORD` | 后台管理必填 | 独立管理员密码，用于修改共享点播源；与观看密码分开设置，不下发到客户端 |
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

### 个人账号与后台管理

后台默认进入「总览」，随后依次是「首页推荐」「点播源」「分集资料」「账号管理」。总览每 5 秒更新在线账号、正在观看、今日活跃、账号总数、今日与累计观看时长，以及服务器 CPU、内存、数据目录所在磁盘和运行时间。在线与正在观看按账号去重，并排除已过期会话和停用账号。

带宽读取 Linux 服务器主网卡的实际入站、出站速率，包含该网卡上其他服务的流量；页面保留最近两分钟的采样趋势，不持久化带宽曲线。Linux 应用启动后即在后台每 15 秒采样流量，无需打开总览；访问总览时也会更新采样。今日、本月、累计入站和出站字节数及计数基线保存在 `SERVER_DATA_DIR/server-metrics.sqlite`（未配置目录时为 `.data/server-metrics.sqlite`），备份时应一并保留该文件。统计从启用时开始，不补入此前网卡累计值；按北京时间划分日期，跨日采样间隔按时间比例分摊。同一次系统启动下应用重启后可根据持久化计数补计应用停机期间的流量；系统重启、网卡切换或计数回退时保留累计值并重新建立基线，无法确认的间隔不计，页面显示中断次数。首次读取和长时间未采样后须等待下一次采样计算速率；系统不支持时显示暂不可用。总览接口 `/api/admin/overview` 仅允许独立后台管理员会话访问，不缓存响应。

账号模式使用 Better Auth + SQLite，注册必须提供管理员生成的授权码。管理员访问 `/admin`，用 `ADMIN_PASSWORD` 登录，在「授权码管理」生成授权码，在「账号管理」查看账号、启用/停用账号或重置密码。账号管理不依赖 `SOURCE_MODE=server`，与点播源管理可分别使用。 账号列表支持区域滚动，点击账号进入详情；详情展示在线／正在观看／离线状态、最后活跃时间，以及今日和累计观影时长。活动心跳由新版网页和 iOS 客户端后台上报，75 秒未收到心跳判为离线；退出、停用或会话过期也会离线。时长按实际播放的墙钟时间估算，暂停、缓冲、拖动与超过 5 秒的采样空窗不计；2 倍速不翻倍计时，同账号并发观看区间去重，今日按北京时间划分。每次上报最多确认 45 秒，断网不无限补算，未上报的末段可能丢失；无法恢复历史总时长。详情同时展示最后成功登录时间，退出、停用和重置密码后仍保留。旧账号从已有会话补入时间，无可用记录时显示暂无记录。观看与搜索历史按实际行为时间倒序排列，删除旧记录不会使其排到最近记录之前。可分页查看观看历史、搜索历史、分集进度、账号设置、直播收藏、直播历史与有效登录会话。管理员详情包含客户端已隐藏的保留记录及其隐藏时间，只读展示每条记录最后保存的内容，不恢复到客户端；登录会话展示设备、系统、浏览器或 App、IP 与时间，不返回会话令牌。新版 iOS App 在登录时上报产品型号编号，后台映射为具体 iPhone 型号；旧会话及网页未提供的型号不推测，仍显示可识别的设备类别。

启用前，在服务器的 `/etc/libretv/runtime.env`（本地为 `.env.local`）配置：

```dotenv
AUTH_MODE=account
BETTER_AUTH_URL=https://tv.example.com
BETTER_AUTH_SECRET=替换为至少32字符的随机密钥
ADMIN_PASSWORD=替换为独立的管理员密码
SERVER_DATA_DIR=/var/lib/libretv
```

将站点地址替换为实际地址，通过 `openssl rand -hex 32` 生成密钥，然后重启服务。保持已有管理员密码即可继续登录后台，不会自动生成默认用户。先在后台生成授权码，再将授权码私下发给使用者，由使用者在网页或 iOS 自行注册；账号为 3–32 位字母、数字或下划线（忽略大小写），密码为 6–128 位，无需邮箱。

- 观看页面只接受个人账号，旧的共享密码会话在账号模式下不再有观看权限；旧客户端需要增加用户名登录支持后才能使用账号模式。
- 用户在网页右上角账号菜单修改自己的密码，其他设备会退出。管理员停用或重置密码立即撤销该账号的全部会话；停用不删除账号及其已有数据。
- 账号与会话保存到 `SERVER_DATA_DIR/accounts.sqlite`，初次使用自动创建表；发布目录可以更新，数据目录必须保留。依赖 Node.js 22 或更新版本，当前服务器保持 Node.js 22。
- 观看历史、逐集进度、搜索历史、直播收藏/最近观看、个人源订阅和偏好设置直接读写服务器。页面只有内存缓存，不再将这些数据写入 IndexedDB 或 localStorage。
- 播放中每 5 秒保存进度，暂停/切集时立即请求保存；个人设置立即反馈，短时间连续操作合并后后台保存。网页每 20 秒读取其他设备的变更，返回页面或恢复连接时重新读取，账号菜单也可「刷新账号数据」。
- 个人操作先在界面生效，后台保存需要连接服务器。短暂失败静默重试一次，最终无法确认时给轻提示并撤销对应暂存；不会覆盖后续操作，也不会在关闭页面或恢复网络后补传已失败的修改。
- 每批后台写入前读取一次当前版本；遇到真正并发冲突时显示错误并采用服务器最新内容，用户可检查后重试。进度不取最大秒数，主动回看可以正常保存。刷新、切换账号后均重新从服务器加载。
- 页面打开时使用当前内存数据并在后台刷新；并发刷新共享请求，10 秒内普通刷新复用已有数据，手动刷新可强制读取。普通后台读取失败保留页面，不弹登录框，只有 401 才要求重新登录。搜索、首次详情和视频缓冲仍保留必要的加载反馈。
- 旧的个人数据表、离线队列和 localStorage 设置副本会清理；旧数据合并入口已移除。视频分片、下载文件、测速缓存、主题和设置面板位置属于设备数据，继续保留。配置文件仍可手动导出备份或导入到账号。
- 共享密码模式不再保留个人记录；其临时设置只在当前页面有效。需要保存个人数据时应使用个人账号。
- 删除、清空和超出可见条数的淘汰均采用软删除：数据库保留该条最后内容及删除时间，客户端只接收删除标记，不再收到原内容。不会保存每次变化，也没有恢复入口；同一条目再次正常写入时更新内容并清除删除标记。旧版已将原内容清空的记录无法凭空补回。
- SQLite 使用 WAL 日志。运行时备份应使用 SQLite 的在线备份功能；若直接复制数据库文件，须先停止服务再备份整个数据目录，避免漏掉未合并的日志。

### 账号数据同步接口

`POST /api/user/sync` 使用 JSON，请求包含 `protocol: 1`、`accountId`、`cursor` 和 `mutations`。服务端从会话确定用户，`accountId` 仅用于核对客户端是否切错账号，不能用来访问其他用户。

每个操作为 `{id, collection, key, baseVersion, value}`，`id` 是用于重试去重的随机 UUID，`baseVersion` 是该条目最后确认的服务器版本，新条目为 0；`value: null` 表示删除。每批最多 100 项、单项最多约 256KB，请求总长最多 2MB。集合包括 `history`、`progress`、`search`、`preference`、`favorite` 和 `recent`；偏好字段使用明确白名单，公共源配置、权限与缓存不能通过此接口修改。

响应含 `results`（每个操作是否接受及其当前版本）、`records`（游标后的增量记录）、新的 `cursor` 和 `more`。每页最多 500 条；`more=true` 时继续拉取。网页与原生客户端统一采用「服务器快照＋待确认操作」的内存视图，历史、设置和进度立即反馈；约 80ms 内的操作合并为一批，同一条目只提交最终值，完整且身份一致的响应用于更新快照。短暂传输失败最多静默重试一次，保持相同操作 ID，最终失败仅撤销对应的待确认操作，不覆盖后续操作。操作、游标和暂存数据只在当前会话内存中，关闭页面或切换账号后不补传。服务端按账号事务处理、分配版本并保留删除标记，不采用设备时间决定覆盖顺序。

客户端可见上限：观看历史 100 条、搜索历史 10 条、直播最近观看 20 条、逐集进度 5000 条、直播收藏 1000 条；超出上限的记录按集合规则软删除并同步删除标记，原内容仍保存在数据库。

### 统一管理点播源

本地运行在 `.env.local` 配置；当前服务器在 `/etc/libretv/runtime.env` 配置：

```dotenv
PASSWORD=your-viewer-password
SOURCE_MODE=server
ADMIN_PASSWORD=your-separate-admin-password
DEFAULT_SOURCES=[{"name":"示例源","url":"https://example.com/api.php/provide/vod"}]
```

重启后，普通网页 `/` 作为观看客户端，服务器模式下设置中不再显示源管理。管理员进入独立后台 `/admin`，使用 `ADMIN_PASSWORD` 登录后添加、编辑和保存点播源。后台登录无需先登录观看网页；两者使用独立 Cookie，观看密码不能取得管理权限，退出后台不影响观看登录。后台默认账号为 `admin`（可通过 `ADMIN_USERNAME` 修改），密码沿用 `ADMIN_PASSWORD`。右上角账号菜单显示当前管理员，可退出账号。默认勾选「保持登录 30 天」，使用持久化 HttpOnly Cookie；超过一天后再次打开后台会续期为 30 天，不在浏览器存储密码。不勾选时为浏览器会话 Cookie，最多 8 小时；浏览器的恢复会话功能可能保留该 Cookie。已存在的旧会话保持原有效期，下次登录后使用新策略。修改管理员账号名、密码或签名密钥会使旧登录失效。当前仍为单个独立管理员账号。

保存是整份配置替换，点击保存前可核对列表；有未保存改动时可撤销。其他网页每分钟同步一次，原生客户端在启动、返回前台及前台定时刷新中获取配置；搜索、详情和播放不等待普通账号刷新。

首次读取使用 `DEFAULT_SOURCES`；保存后以数据目录的 `sources.json` 为准，环境预置不再覆盖磁盘配置。管理员删除全部源后不会自动恢复预置源。源编号在修改地址时保留，支持客户端稳定引用；新增源生成新编号。请定期备份数据目录，更新应用时保留该目录。当前文件存储适用于单实例部署，不能在多个实例中共享写入同一文件。

服务器模式下，客户端提交的源地址、名称、成人标记和详情页根地址均不能覆盖服务器配置。网页配置更新后直接生效，无须重新安装原生客户端。当前统一管理范围包括**点播源和首页推荐来源**；直播公共源与订阅自动更新尚未统一到后台管理。个人账号模式下，个人直播订阅、收藏和观看记录会随账号同步；共享密码模式仅保留当前页面的临时设置。管理员使用独立密码。

### 管理员查看账号密码

账号管理支持按需查看新建、管理员重置或用户自行修改后的密码。登录验证仍使用原有哈希；额外副本以 AES-256-GCM 加密存入 `accounts.sqlite` 的 `managed_password` 表，并绑定账号编号和当前登录哈希。旧账号只有哈希，不能还原原密码，重新设密后才产生可查看记录。自行改密也会更新副本；记录与当前哈希不一致时禁止显示旧密码。

只有独立后台管理员会话可调用 `POST /api/admin/users/password`（body 为 `{userId}`），普通账号、观看会话和跨站请求不能查看。账号列表只返回是否可查看，不下发密码。密码响应不缓存；界面一次只显示一个账号，30 秒或窗口失去焦点后隐藏，不写浏览器持久化存储。

密钥默认首次设密时在 `SERVER_DATA_DIR/.account-password.key` 自动生成，权限 `0600`，正常发布不会更换。也可用独立的 `ACCOUNT_PASSWORD_KEY`（64 位十六进制）配置。该密钥与 `BETTER_AUTH_SECRET` 分离，轮换登录密钥不会影响已有密文。请妥善备份密钥和账号数据库；丢失密钥后不会自动生成替代密钥，需恢复备份。不要直接切换密钥，已有记录没有自动轮换迁移。管理员重置时登录哈希、密文和会话撤销在同一数据库事务内完成。

管理员和服务器密钥持有者均具备读取权限，授权管理员账号应按此权限范围管理。此功能不能查看管理员自己的 `ADMIN_PASSWORD`。

### 授权码注册与续期

后台「授权码管理」支持每批生成 1–100 个授权码，选择限时授权或无限期；限时提供 1、7、30、90、180、365 天快捷选项及自定义（1–3650 天），默认 30 天。「更多设置」可选择不限兑换期限、生成后 7 天内、30 天内（默认）或自定义最晚兑换时间。生成前显示摘要，生成后可复制全部授权码，并可填写备注。列表按生成时间倒序分页，显示已生成、未使用、已使用、已失效、已作废数量；详情可查看和复制完整授权码、绑定账号、兑换时间、本次授予的截止时间和账号当前截止时间。未使用的码可作废，已使用记录保留；停用账号仍在账号管理操作。

授权码是单次使用的随机凭证，首次兑换后永久绑定账号。注册时用户自行设置账号和密码，创建账号和兑换授权码在同一个 SQLite 事务中完成，并发争用同一码只允许一人成功，失败不遗留账号。码在兑换期限前才能使用；账户授权天数从兑换时起算，提前续期从原截止时间累加，到期后续期从当前时间起算。无限期码兑换后长期有效，仍受管理员停用限制；已有无限期账号再次兑换会被拒绝且不消耗新码。无限期授权与不限兑换期限互相独立。数据库以 0 表示无限期天数、无限期账号截止或不限兑换期限；接口账号状态为 active 且 expiresAt 为 null 表示无限期，unactivated 且 expiresAt 为 null 仍表示未激活。授权码密文和摘要保存在现有 `accounts.sqlite`，使用 `.account-password.key` 加密完整码；备份需同时保留数据库和密钥。码列表不返回明文，只有独立管理员的详情接口可以查看。

既有账号及历史数据保留，切换此版本后同样需要授权码激活。未激活或已到期账号不能登录观看，已存在的 Cookie 也不能继续调用观看和同步 API；站点状态只返回身份与授权状态，不下发资源配置。用户可在网页或 iOS 的「激活 / 续期」用原账号、密码和新码恢复使用，原数据不清空；使用中的账号也可在账号菜单／设置中提前续期。账号被管理员停用时不能通过授权码绕过停用。

新签发的投屏视频地址有效期不会超过账号授权截止时间。已经缓冲、下载或直接从上游取得的数据无法收回。管理员后台使用独立会话，不受观看账号授权期限限制。原后台手动创建观看账号接口返回 410，框架公开注册接口仍关闭，只有带码的受控注册入口开放。

`POST /api/account/register` 接收 `{username,password,code}`；成功后客户端登录取得会话。`POST /api/account/redeem` 支持已登录账号提交 `{code}`，或未登录／到期用户提交 `{username,password,code}`；凭据兑换成功才签发登录 Cookie。`/api/admin/licenses` 仅接受独立管理员会话，GET 返回列表（`offset`）或详情（`id`），POST 生成，PATCH `{id}` 作废未使用的码。所有响应禁止缓存。

### 后台首页推荐管理

后台先以卡片展示推荐来源，点击进入独立编辑页；分类按分组折叠，可搜索、逐项展开、复制和排序。字段映射与高级设置按需展开，底部统一保存，返回来源列表会保留未保存的改动。

所有推荐来源使用同一套可编辑配置，包括预置的豆瓣热门、Bangumi 新番放送、影视热榜。管理员在 `/admin` →「首页推荐」可添加、移除、改名、排序、启停，并设置默认来源。每个来源包含 1–50 个分类接口，可按电影、剧集等分组，逐个编辑接口地址、备用地址和字段映射，测试预览草稿后保存。最多 30 个来源；全部关闭后观看端隐藏推荐。

接口使用公网 HTTP/HTTPS GET 并返回 JSON，无需修改客户端即可接入符合映射规则的新来源。普通 JSON 的示例为 `{"items":[{"id":"1","title":"影片名","cover":"https://example.com/poster.jpg","rating":"8.5"}]}`，对应列表 `items`、片名 `title`、海报 `cover`、编号 `id`、评分 `rating`。后台同时提供苹果 CMS 字段模板。

字段路径支持点号访问嵌套数据（`data.list`、`images.large`）、`*` 展开数组（Bangumi 用 `*.items.*`），以及 `|` 备用字段（`name_cn|name`）。列表路径留空表示顶层数组。片名和海报为必填字段；编号缺省时使用片名去重；评分可省略。支持图床提供 HTTPS 时勾选海报地址升级，Bangumi 预置已开启。可设置顶层分组筛选字段及值，例如 Bangumi 的 `weekday.id` 和 `1` 选择周一。每分类最多显示 100 条，响应最大 2 MB。HTML、XML、需执行脚本或特殊登录签名的接口仍需另外适配。

配置保存在 `SERVER_DATA_DIR/recommendations.json`，首次使用内置预置和 `DEFAULT_RECOMMEND_SOURCE`，保存后以磁盘配置为准。旧版只有名称和开关的三个来源会自动补全原有分类和接口，管理员已有名称、顺序、开关和默认项保持不变。`60S_API_BASE` 用于尚未迁移的热榜默认地址。请随数据目录备份，适用于单实例部署。

`/api/admin/recommendations`（GET / PUT）使用独立后台会话和版本号，冲突返回 409；`/api/admin/recommendations/preview`（POST，`{feed}`）测试草稿但不保存。保存与实际请求均校验公网目标，重定向逐跳验证，不向上游发送观看会话。

网页通过 `/api/status`、iOS 通过 `/api/server/config` 读取显示配置（来源和分类的编号、名称、分组及版本号），不下发上游地址、查询令牌或解析规则。客户端通过 `/api/recommendations/feed?source=编号&feed=分类编号` 获取统一的片名、海报和评分；服务器按当前配置解析，关闭来源后拒绝获取，修改地址或规则后缓存自动失效。网页登录后每分钟同步，iOS 在前台按已有配置刷新周期同步；也可手动刷新。用户已有可用来源的偏好优先，来源停用时临时回退，恢复后沿用原选择。旧 API 保留以兼容旧客户端；首次启用统一接口需更新 iOS 应用，之后修改接口或新增来源无需重新安装。

### 客户端接口（v1）

共享密码模式使用 `ltv_session` Cookie，账号模式使用 Better Auth 签发的会话 Cookie。原生客户端使用持久 Cookie 存储，接收服务端所有 `Set-Cookie` 响应，登录后后续请求携带 Cookie；播放器访问本站代理 manifest、分片和密钥时也必须携带同一 Cookie，不要把本站 Cookie 附加到第三方直连地址。

| 接口 | 请求 | 说明 |
| --- | --- | --- |
| `/api/status` | GET | 无须登录即可获取版本、登录状态、`sourceMode`；匿名响应不含源配置 |
| `/api/auth` | POST `{"password":"观看密码"}`，账号模式为 `{"username":"账号","password":"密码"}` | 验证成功后设置 HttpOnly 会话 Cookie |
| `/api/user/sync` | POST，个人账号登录后使用 | 账号数据版本同步，协议见下方说明 |
| `/api/auth` | DELETE | 清除客户端会话 Cookie |
| `/api/server/config` | GET，已登录 | 返回 `apiVersion: 1`、`revision`、`sources: [{key,name,isAdult}]`，不含源地址 |
| `/api/search` | POST `{"wd":"片名","filterAdult":true}` | server 模式自动搜索服务器全部点播源；可选 `sourceKeys: ["源编号"]` 限定来源 |
| `/api/search?stream=1` | 同上 | NDJSON：逐源 `source` 事件及最终 `done` 事件；也可直接使用普通 JSON 模式 |
| `/api/detail?id=影片ID&sourceKey=源编号` | GET，已登录 | 返回 `episodes`、与地址同序的 `episodeTitles`（无名称时为空字符串）和 `videoInfo`，使用服务器当前源配置 |
| `/api/proxy?url=编码后的播放地址` | GET，已登录 | 代理播放列表、分片及密钥；HLS 播放列表内地址自动重写 |
| `/api/admin/auth` | GET / POST `{"username":"admin","password":"管理员密码","remember":true}` / DELETE | 独立后台会话状态、登录和退出；签发 `ltv_admin_session` HttpOnly Cookie，不接受观看密码 |
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
4. **进度与历史**：个人账号直接保存到服务器数据库，刷新或在其他设备登录后读取；播放时按需获取最新剧集信息。
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
