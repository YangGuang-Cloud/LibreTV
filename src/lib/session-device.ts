// Hardware identifier facts checked against DeviceKit's public device table:
// https://github.com/devicekit/DeviceKit/blob/master/Source/Device.generated.swift
const iphoneNames: Record<string, string> = {
  'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max', 'iPhone12,8': 'iPhone SE（第二代）',
  'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12', 'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13', 'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max', 'iPhone14,6': 'iPhone SE（第三代）',
  'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus', 'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus', 'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus', 'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max', 'iPhone17,5': 'iPhone 16e',
  'iPhone18,3': 'iPhone 17', 'iPhone18,1': 'iPhone 17 Pro', 'iPhone18,2': 'iPhone 17 Pro Max', 'iPhone18,4': 'iPhone Air', 'iPhone18,5': 'iPhone 17e',
  'iPhone19,2': 'iPhone 18 Pro', 'iPhone19,3': 'iPhone 18 Pro Max', 'iPhone19,7': 'iPhone 18 Pro Max',
};
export function describeSessionDevice(agent: string | null): { name: string; detail: string; exactModel: boolean } {
  const ua = (agent || '').slice(0, 2048);
  const native = /^Luna12TV\/([\d.]{1,30}) \(iOS ([\d.]{1,30}); ((?:iPhone|iPad)\d+,\d+|Simulator|unknown)\)$/.exec(ua);
  if (native) {
    const [, app, os, hardware] = native;
    return { name: iphoneNames[hardware] || (hardware === 'Simulator' ? 'iOS 模拟器' : hardware === 'unknown' ? 'iOS 设备' : hardware),
      detail: `iOS ${os} · Luna12TV ${app}`, exactModel: !!iphoneNames[hardware] };
  }
  const ios = /(?:CPU(?: iPhone)? OS|iPhone OS) ([\d_]+)/.exec(ua)?.[1]?.replaceAll('_', '.');
  const android = /Android ([\d.]+)/.exec(ua)?.[1];
  const mac = /Mac OS X ([\d_]+)/.exec(ua)?.[1]?.replaceAll('_', '.');
  const name = /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua)) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : android ? 'Android 设备' : /Windows/.test(ua) ? 'Windows 电脑'
      : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux 设备' : '未识别设备';
  const platform = ios ? `${name === 'iPad' ? 'iPadOS' : 'iOS'} ${ios}` : name === 'iPad' ? 'iPadOS' : android ? `Android ${android}` : mac ? `macOS ${mac}` : '';
  const browser = /(?:Edg|EdgiOS|EdgA)\/([\d.]+)/.exec(ua) ? 'Edge'
    : /(?:Chrome|CriOS)\/([\d.]+)/.test(ua) ? 'Chrome' : /(?:Firefox|FxiOS)\/([\d.]+)/.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari' : /CFNetwork\//.test(ua) ? '原生客户端' : '';
  return { name, detail: [platform, browser].filter(Boolean).join(' · ') || '未提供系统与客户端信息', exactModel: false };
}
