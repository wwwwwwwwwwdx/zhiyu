import { describe, it, expect } from 'vitest';
import { MockPaymentGateway } from '../src/payment/MockPaymentGateway';

describe('模拟支付网关', () => {
  it('成功支付返回交易号', async () => {
    const gw = new MockPaymentGateway({ delayMs: 10 });
    const r = await gw.purchase('pack-small');
    expect(r.ok).toBe(true);
    expect(r.transactionId).toContain('mock-pack-small');
  });

  it('多次购买交易号递增不重复', async () => {
    const gw = new MockPaymentGateway({ delayMs: 1 });
    const a = await gw.purchase('pack-small');
    const b = await gw.purchase('pack-small');
    expect(a.transactionId).not.toBe(b.transactionId);
  });

  it('配置失败时返回失败结果', async () => {
    const gw = new MockPaymentGateway({ delayMs: 1, fail: true });
    const r = await gw.purchase('pack-small');
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
