'use client';

import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { useAuth } from '@/components/auth';

export default function AboutPage() {
  const { accountMode } = useAuth();
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10 space-y-8">
        <section>
          <h1 className="text-xl font-bold text-content mb-3">关于 Luna12TV · 月十二影视</h1>
          <p className="text-sm text-muted leading-relaxed">
            Luna12TV（月十二影视）是一个简洁、无内嵌广告的在线视频搜索与观看平台。输入片名即可在多个点播源中聚合搜索，
            凭授权码注册、无内嵌广告、不存储任何视频文件。所有播放内容均来自第三方公开接口。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">快捷键</h2>
          <ul className="text-sm text-muted space-y-1.5 list-disc list-inside">
            <li><code className="text-accent">空格</code> 播放 / 暂停</li>
            <li><code className="text-accent">←</code> / <code className="text-accent">→</code> 快退 / 快进 5 秒</li>
            <li><code className="text-accent">↑</code> / <code className="text-accent">↓</code> 音量调节</li>
            <li><code className="text-accent">F</code> 切换全屏</li>
            <li><code className="text-accent">Alt + ←/→</code> 上一集 / 下一集</li>
            <li>移动端长按视频可 3 倍速播放</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">隐私与数据</h2>
          <p className="text-sm text-muted leading-relaxed">
            {accountMode ? '账号模式下，搜索历史、观看进度、收藏和个人设置直接保存到本站服务器，页面只保留内存状态。断网时无法保存，也不会在恢复连接后自动补传。删除或清空记录后，客户端不再显示，服务器仍保留该条最后内容与删除标记。视频缓存、下载文件及主题选择保留在设备上。' : '共享密码模式不保存个人记录，设置只在当前页面有效。需要保存个人数据时，请使用管理员分配的个人账号。'}
            聚合搜索请求由服务端代理转发，第三方数据源不会看到你的 IP 地址。
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-content mb-2.5">免责声明</h2>
          <p className="text-sm text-faint leading-relaxed">
            本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力。
            请尊重版权，所有内容的合法性由对应数据源负责。
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
