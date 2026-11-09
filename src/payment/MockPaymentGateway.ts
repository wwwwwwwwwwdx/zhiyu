// 模拟支付网关：第一版无真实支付环境，用它完整走通下单、支付、失败与发货流程。
// 未来接微信/支付宝时，只需新增一个实现 PaymentGateway 的类，引擎与 UI 无需改动。

import type { PaymentGateway, PaymentResult } from '../engine/core/types';

export interface MockOptions {
  delayMs?: number;
  fail?: boolean; // 置 true 时模拟支付失败，用于测试失败分支
}

export class MockPaymentGateway implements PaymentGateway {
  private seq = 0;

  constructor(private readonly options: MockOptions = {}) {}

  purchase(productId: string): Promise<PaymentResult> {
    const delay = this.options.delayMs ?? 300;
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.options.fail) {
          resolve({ ok: false, reason: '支付未完成' });
          return;
        }
        this.seq += 1;
        resolve({ ok: true, transactionId: `mock-${productId}-${this.seq}` });
      }, delay);
    });
  }
}
