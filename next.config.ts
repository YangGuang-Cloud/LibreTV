import type { NextConfig } from 'next';
import fs from 'node:fs';
import path from 'node:path';

/** 版本号以 package.json 为单一来源，构建时注入 process.env.APP_VERSION（/api/status 使用） */
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const nextConfig: NextConfig = {
  // 自动部署使用 standalone 独立运行包（STANDALONE_BUILD=1）；
  // 本地默认使用 next start，故按环境切换
  output: process.env.STANDALONE_BUILD === '1' ? 'standalone' : undefined,
  serverExternalPackages: ['better-sqlite3'],
  // SQLite 使用运行时选择的原生绑定，独立运行包须携带各平台预编译文件。
  outputFileTracingIncludes: { '/api/**': ['./node_modules/better-sqlite3/prebuilds/*.node'] },
  reactStrictMode: true,
  env: { APP_VERSION: readAppVersion(), APP_BUILD_ID: process.env.APP_BUILD_ID || 'local' },
  // 采集站/豆瓣等上游地址在运行时由用户配置，构建期无法枚举，关闭图片优化改用 <img>
  images: { unoptimized: true },
};

export default nextConfig;
