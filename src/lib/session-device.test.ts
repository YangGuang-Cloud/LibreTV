import { expect, it } from 'vitest';
import { describeSessionDevice } from './session-device';
it('原生客户端硬件编号映射到准确型号，不把编号代数当作商品名称', () => {
  expect(describeSessionDevice('Luna12TV/2.16.18 (iOS 26.1; iPhone18,1)')).toEqual({ name: 'iPhone 17 Pro', detail: 'iOS 26.1 · Luna12TV 2.16.18', exactModel: true });
  expect(describeSessionDevice('Luna12TV/2.16.18 (iOS 27.0; iPhone19,2)').name).toBe('iPhone 18 Pro');
});
it('未知型号与模拟器保留真实信息，不猜测具体型号', () => {
  expect(describeSessionDevice('Luna12TV/2.16.18 (iOS 27.0; iPhone99,1)')).toMatchObject({ name: 'iPhone99,1', exactModel: false });
  expect(describeSessionDevice('Luna12TV/2.16.18 (iOS 27.0; Simulator)').name).toBe('iOS 模拟器');
  expect(describeSessionDevice(null)).toMatchObject({ name: '未识别设备', exactModel: false });
});
it('网页版区分设备、系统与浏览器，但不会虚构 iPhone 的具体型号', () => {
  expect(describeSessionDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1'))
    .toEqual({ name: 'iPhone', detail: 'iOS 18.6 · Safari', exactModel: false });
  expect(describeSessionDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) CriOS/140.0 Mobile/15E148 Safari/604.1').detail).toBe('iOS 18.6 · Chrome');
  expect(describeSessionDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0').name).toBe('Windows 电脑');
  expect(describeSessionDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Edg/140.0.0.0').detail).toBe('Edge');
});

it('iPad 桌面模式的 Safari 不误判成 Mac 或 macOS', () => {
  expect(describeSessionDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'))
    .toEqual({ name: 'iPad', detail: 'iPadOS · Safari', exactModel: false });
});
