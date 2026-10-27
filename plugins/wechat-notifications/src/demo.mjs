import { createHash } from 'node:crypto';

// Entirely invented fixtures. Relative dates keep the demo inside the retention window.
export function demoNotifications(now = Date.now()) {
  return [
    ['周末出游 · 演示', '小夏：周六上午临时有事，我最早下午两点才能出发。'],
    ['周末出游 · 演示', '阿卓：如果一起走，周日我也有空，其他人方便吗？'],
    ['小店网站 · 演示', '林同学：首版先展示菜单和地址，周五看看预览。'],
    ['小店网站 · 演示', '林同学：能不能再加在线下单？第一版不用支付，但店里要收到提醒。'],
    ['摄影交流 · 演示', '小禾：晚上在客厅用手机拍孩子，总是模糊，有什么办法？'],
  ].map(([title, body], index) => ({
    id: `notification-db:${createHash('sha256').update(`synthetic:${index}`).digest('hex')}`,
    title, body, timestamp: new Date(now - (6 - index) * 60_000).toISOString(),
  }));
}
