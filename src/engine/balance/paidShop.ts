// 付费商品目录：金币包为可选加速，月卡给温和每日奖励；均不改变模拟数值、不设内容墙。
// 价格为模拟人民币，配合 Mock 支付网关用于第一版验证。

import type { PaidProduct } from '../core/types';

export const PAID_PRODUCT_CATALOG: PaidProduct[] = [
  { id: 'pack-small', kind: 'coin-pack', name: '一小袋金币', priceCny: 6, grantCoins: 500 },
  { id: 'pack-medium', kind: 'coin-pack', name: '金币礼盒', priceCny: 12, grantCoins: 1200 },
  { id: 'pack-large', kind: 'coin-pack', name: '金币宝箱', priceCny: 30, grantCoins: 3500 },
  { id: 'monthly-pass', kind: 'monthly-pass', name: '陪伴礼遇（月卡）', priceCny: 18, passDays: 30, dailyCoins: 60 },
];

export function findPaidProduct(id: string): PaidProduct | undefined {
  return PAID_PRODUCT_CATALOG.find((p) => p.id === id);
}
