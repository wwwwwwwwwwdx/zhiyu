import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { MockPaymentGateway } from '../src/payment/MockPaymentGateway';
import { DAILY_REWARD_COINS, GAME_DAY } from '../src/engine/balance/constants';
import type { Engine } from '../src/engine/core/types';

function cycledEngine(): Engine {
  const engine = createEngine();
  engine.startCycling();
  engine.fastForward(60 * 60 * 2);
  return engine;
}

describe('付费点与免费产出', () => {
  it('进入新游戏日发放免费每日陪伴奖励', () => {
    const engine = createEngine();
    const before = engine.getSnapshot().coins;
    engine.fastForward(GAME_DAY);
    const snap = engine.getSnapshot();
    expect(snap.coins).toBe(before + DAILY_REWARD_COINS);
    expect(snap.lastDailyRewardDay).toBe(1);
  });

  it('金币包支付成功后立即发放金币', async () => {
    const engine = createEngine();
    const before = engine.getSnapshot().coins;
    const r = await engine.purchaseProduct('pack-small', new MockPaymentGateway());
    expect(r.ok).toBe(true);
    expect(engine.getSnapshot().coins).toBe(before + 500);
  });

  it('支付失败不发货', async () => {
    const engine = createEngine();
    const before = engine.getSnapshot().coins;
    const r = await engine.purchaseProduct('pack-small', new MockPaymentGateway({ fail: true }));
    expect(r.ok).toBe(false);
    expect(engine.getSnapshot().coins).toBe(before);
  });

  it('月卡开通后记录到期时间', async () => {
    const engine = createEngine();
    await engine.purchaseProduct('monthly-pass', new MockPaymentGateway());
    expect(engine.getSnapshot().monthlyPass.expireGameTime).toBe(30 * GAME_DAY);
  });

  it('月卡重复购买在到期时间上顺延', async () => {
    const engine = createEngine();
    await engine.purchaseProduct('monthly-pass', new MockPaymentGateway());
    await engine.purchaseProduct('monthly-pass', new MockPaymentGateway());
    expect(engine.getSnapshot().monthlyPass.expireGameTime).toBe(60 * GAME_DAY);
  });

  it('月卡生效期间跨日同时领取免费与月卡奖励', async () => {
    const engine = createEngine();
    await engine.purchaseProduct('monthly-pass', new MockPaymentGateway());
    const before = engine.getSnapshot().coins;
    engine.fastForward(GAME_DAY);
    expect(engine.getSnapshot().coins).toBe(before + DAILY_REWARD_COINS + 60);
  });

  it('买鱼触发成就并发放金币奖励', () => {
    const engine = cycledEngine();
    const before = engine.getSnapshot().coins;
    const r = engine.buyFish('guppy');
    expect(r.ok).toBe(true);
    expect(engine.getSnapshot().coins).toBe(before - 12 + 20);
  });

  it('不存在的商品被拒绝', async () => {
    const engine = createEngine();
    const r = await engine.purchaseProduct('nope', new MockPaymentGateway());
    expect(r.ok).toBe(false);
  });
});
