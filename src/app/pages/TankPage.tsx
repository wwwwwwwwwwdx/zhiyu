import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createEngine } from '../../engine/engine';
import { EQUIPMENT_CATALOG, FISH_CATALOG, PLANT_CATALOG } from '../../engine/balance/catalog';
import { ENVIRONMENT_CATALOG, DEFAULT_ENVIRONMENT } from '../../engine/balance/environments';
import { TANK_SHAPE_CATALOG, DEFAULT_TANK_SHAPE } from '../../engine/balance/tankShapes';
import { RARE_VARIANT_CATALOG } from '../../engine/biology/variants';
import { ACHIEVEMENT_CATALOG } from '../../engine/progression/achievements';
import { PAID_PRODUCT_CATALOG } from '../../engine/balance/paidShop';
import { MockPaymentGateway } from '../../payment/MockPaymentGateway';
import { TIME_SCALE, LIMIT } from '../../engine/balance/constants';
import { saveGame, loadGame } from '../../persistence/saveRepository';
import { migratePersistedState } from '../../persistence/migrate';
import type { Engine, Snapshot, CommandResult, PersistedState } from '../../engine/core/types';
import { Renderer } from '../../render/Renderer';
import GuideOverlay from '../components/GuideOverlay';
import { exportProceduralFishGLTF } from '../../render/proceduralTestAsset';
import { CanvasRecorder, downloadBlob } from '../../render/CanvasRecorder';
import { track } from '../analytics/tracker';

const fmt = (v: number) => v.toFixed(3);

// 水质状态：正常/注意/危险，用柔和状态点表达，用户无需理解专业数值
type WaterStatus = 'ok' | 'warn' | 'danger';
const STATUS_TEXT: Record<WaterStatus, string> = { ok: '正常', warn: '注意', danger: '危险' };
const MAX_OFFLINE_GAME_SECONDS = 8 * 60 * 60; // 离线推演封顶 8 游戏小时
const AUTOSAVE_MS = 15000;
// 礼遇商品没有 3D 模型，用专门的插画图标；其余商品缩略图由 glb 离屏渲染得到
const GIFT_ICONS: Record<string, string> = {
  'pack-small': '/icons/coin-bag.png',
  'pack-medium': '/icons/coin-box.png',
  'pack-large': '/icons/coin-chest.png',
  'monthly-pass': '/icons/month-card.png',
};

export default function TankPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [offlineEvents, setOfflineEvents] = useState<string[] | null>(null);
  const [lightOn, setLightOn] = useState(true);
  const [fps, setFps] = useState(0);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const recorderRef = useRef<CanvasRecorder | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  // 游戏化 UI：商店与水质都收进按需弹出的抽屉，默认不占用画面
  const [panel, setPanel] = useState<null | 'shop' | 'water' | 'collection'>(null);
  const [shopTab, setShopTab] = useState<'fish' | 'plant' | 'equipment' | 'gift'>('fish');
  // 商店缩略图：由渲染层用真实 glb 模型离屏渲染得到，key 为 specId
  const [shopIcons, setShopIcons] = useState<Record<string, string>>({});
  const [environmentId, setEnvironmentId] = useState<string>(DEFAULT_ENVIRONMENT);
  const [tankShapeId, setTankShapeId] = useState<string>(DEFAULT_TANK_SHAPE);

  // 越高越差 / 越低越差的状态判定
  const highBand = (v: number, warnAt: number, dangerAt: number): WaterStatus =>
    v >= dangerAt ? 'danger' : v >= warnAt ? 'warn' : 'ok';
  const lowBand = (v: number, warnAt: number, dangerAt: number): WaterStatus =>
    v <= dangerAt ? 'danger' : v <= warnAt ? 'warn' : 'ok';

  // 开始/停止录制，停止后下载 webm
  async function toggleRecord(): Promise<void> {
    const canvas = mountRef.current?.querySelector('canvas') ?? null;
    if (!canvas) return;
    if (!CanvasRecorder.isSupported()) {
      setNotice('当前浏览器不支持视频录制，请使用最新版 Chromium 浏览器');
      return;
    }
    if (!recorderRef.current) recorderRef.current = new CanvasRecorder();
    const recorder = recorderRef.current;
    try {
      if (recorder.isRecording) {
        const blob = await recorder.stop();
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        downloadBlob(blob, `zhiyu-${stamp}.webm`);
        setIsRecording(false);
      } else {
        recorder.start(canvas, 30);
        setRecordSeconds(0);
        setIsRecording(true);
      }
    } catch (e) {
      setIsRecording(false);
      setNotice((e as Error).message);
    }
  }

  // 录制计时
  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  // 进入/退出全屏：用浏览器 Fullscreen API，Esc 原生退出，监听变化同步 UI
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      setTimeout(() => rendererRef.current?.resize(), 50);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      const root = mountRef.current?.parentElement;
      root?.requestFullscreen().catch(() => setNotice('当前浏览器不支持全屏'));
    }
  }

  // 每秒刷新一次性能读数
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (rendererRef.current) setFps(rendererRef.current.getPerformance().fps);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  function changeQuality(tier: 'high' | 'medium' | 'low'): void {
    rendererRef.current?.setQuality(tier);
    setQuality(tier);
  }

  // 切换放置环境：引擎记录（影响光照/爆藻），渲染层更新背景
  function changeEnvironment(id: string): void {
    const result = engineRef.current?.setEnvironment(id);
    if (result && !result.ok) {
      setNotice(result.reason ?? '切换失败');
      return;
    }
    rendererRef.current?.applyEnvironment(id);
    setEnvironmentId(id);
    setSnapshot(engineRef.current?.getSnapshot() ?? null);
  }

  // 切换鱼缸形状：引擎校验容量，渲染层重建几何
  function changeTankShape(id: string): void {
    const result = engineRef.current?.setTankShape(id);
    if (result && !result.ok) {
      setNotice(result.reason ?? '切换失败');
      return;
    }
    rendererRef.current?.applyTankShape(id);
    setTankShapeId(id);
    setSnapshot(engineRef.current?.getSnapshot() ?? null);
  }

  function run(cmd: () => CommandResult): void {
    const result = cmd();
    if (!result.ok) setNotice(result.reason ?? '操作失败');
    setSnapshot(engineRef.current?.getSnapshot() ?? null);
  }

  // 模拟付费购买：走 Mock 支付网关，成功后刷新快照，失败提示原因
  async function runPurchase(productId: string): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    const result = await engine.purchaseProduct(productId, new MockPaymentGateway());
    if (!result.ok) setNotice(result.reason ?? '支付失败');
    setSnapshot(engine.getSnapshot());
  }

  // M2 管线验证：用程序化生成的 glTF 替换低模占位，验证加载往返与降级
  async function verifyModelPipeline(): Promise<void> {
    const renderer = rendererRef.current;
    if (!renderer) return;
    try {
      const uri = await exportProceduralFishGLTF();
      const result = await renderer.setFishAsset(uri);
      if (!result.ok) setNotice(result.reason ?? 'glTF 切换失败');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  // 加载 Blender 自制并导出的正式 glTF 资产
  async function loadBuiltInFish(): Promise<void> {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const result = await renderer.setFishAsset('/models/fish/guppy.glb');
    if (!result.ok) setNotice(result.reason ?? '模型加载失败');
  }

  // 按鱼种批量加载全部 glb 模型，替换锥体占位；失败的鱼种保留占位
  async function loadAllFishModels(): Promise<void> {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const result = await renderer.loadFishModels(FISH_CATALOG.map((f) => f.id));
    if (result.failed.length > 0) {
      setNotice(`部分模型加载失败：${result.failed.join('、')}`);
    }
  }

  // 导出当前存档为 JSON 文件，便于备份与数据查看
  function exportSave(): void {
    const engine = engineRef.current;
    if (!engine) return;
    const data = engine.getPersistedState(Date.now());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(blob, `zhiyu-save-${stamp}.json`);
  }

  useEffect(() => {
    let disposed = false;
    let renderer: Renderer | null = null;
    let saveTimer = 0;

    const flushSave = () => {
      saveGame(engineRef.current!.getPersistedState(Date.now())).catch(() => undefined);
    };

    (async () => {
      // 读取/迁移失败时降级为新引擎，保证页面可玩，而不是静默崩溃
      let saved: PersistedState | undefined;
      try {
        const rawSaved = await loadGame();
        saved = rawSaved ? migratePersistedState(rawSaved) : undefined;
      } catch {
        saved = undefined;
        if (!disposed) setNotice('存档读取失败，已为你开启新鱼缸');
      }
      let engine: Engine;
      if (saved) {
        engine = createEngine(saved);
        const awayRealSeconds = Math.max(0, (Date.now() - saved.savedAt) / 1000);
        const awayGameSeconds = Math.min(awayRealSeconds * TIME_SCALE, MAX_OFFLINE_GAME_SECONDS);
        if (awayGameSeconds > 60) {
          const result = engine.fastForward(awayGameSeconds);
          if (!disposed && result.events.length > 0) setOfflineEvents(result.events);
        }
      } else {
        engine = createEngine();
      }
      if (disposed) return;

      engineRef.current = engine;
      setSnapshot(engine.getSnapshot());
      track('session_start');

      renderer = new Renderer(mountRef.current!);
      rendererRef.current = renderer;
      // 应用存档中的放置环境
      const savedEnv = saved?.environment;
      if (savedEnv) {
        renderer.applyEnvironment(savedEnv);
        setEnvironmentId(savedEnv);
      }
      const savedShape = saved?.tankShape;
      if (savedShape) {
        renderer.applyTankShape(savedShape);
        setTankShapeId(savedShape);
      }
      let uiAccumulator = 0;
      renderer.start((dt) => {
        const snap = engine.advance(dt);
        renderer!.update(snap, performance.now());
        uiAccumulator += dt;
        if (uiAccumulator >= 0.25) {
          uiAccumulator = 0;
          setSnapshot(engine.getSnapshot());
          if (snap.events.length > 0) setEventLog((prev) => [...snap.events, ...prev].slice(0, 8));
        }
      });

      saveTimer = window.setInterval(flushSave, AUTOSAVE_MS);

      // 加载鱼/水草/装备模型；全部就绪后统一离屏渲染商品缩略图，做到商店所见即所得
      const r = renderer;
      Promise.all([
        r.loadFishModels(FISH_CATALOG.map((f) => f.id)),
        r.loadPlantModels(PLANT_CATALOG.map((p) => p.id)),
        r.loadEquipmentModels(EQUIPMENT_CATALOG.map((e) => e.id)),
      ])
        .then(async ([fishResult, plantResult, equipResult]) => {
          if (disposed) return;
          const failed = [...fishResult.failed, ...plantResult.failed, ...equipResult.failed];
          if (failed.length > 0) {
            setNotice(`部分模型加载失败：${failed.join('、')}`);
          }
          const icons = await r.buildShopIcons();
          if (!disposed) setShopIcons(icons);
        })
        .catch(() => undefined);
    })();

    document.addEventListener('visibilitychange', flushSave);
    window.addEventListener('beforeunload', flushSave);
    const onResize = () => renderer?.resize();
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      window.clearInterval(saveTimer);
      document.removeEventListener('visibilitychange', flushSave);
      document.removeEventListener('beforeunload', flushSave);
      window.removeEventListener('resize', onResize);
      renderer?.dispose();
      rendererRef.current = null;
      if (recorderRef.current?.isRecording) {
        recorderRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  // 水质详情行数据
  const waterRows: Array<[string, string, WaterStatus]> = snapshot
    ? (() => {
        const w = snapshot.water;
        const tempStatus: WaterStatus =
          w.temp < LIMIT.tempMin || w.temp > LIMIT.tempMax ? 'danger'
            : w.temp < 22 || w.temp > 28 ? 'warn' : 'ok';
        // pH 接近中性最佳，偏离越大越危险
        const phStatus: WaterStatus =
          w.ph < 6.2 || w.ph > 7.8 ? 'danger' : w.ph < 6.5 || w.ph > 7.5 ? 'warn' : 'ok';
        return [
          ['NH3 氨氮', fmt(w.nh3), highBand(w.nh3, LIMIT.nh3Danger / 2, LIMIT.nh3Danger)],
          ['NO2 亚硝酸盐', fmt(w.no2), highBand(w.no2, LIMIT.no2Danger / 2, LIMIT.no2Danger)],
          ['NO3 硝酸盐', fmt(w.no3), highBand(w.no3, LIMIT.no3Danger / 2, LIMIT.no3Danger)],
          ['细菌 B1/B2', `${w.b1.toFixed(2)} / ${w.b2.toFixed(2)}`, lowBand(Math.min(w.b1, w.b2), 5, 1)],
          ['溶氧 O2', w.o2.toFixed(2), lowBand(w.o2, 6, 4)],
          ['CO2 二氧化碳', w.co2.toFixed(2), highBand(w.co2, 1, 2)],
          ['pH 酸碱度', w.ph.toFixed(2), phStatus],
          ['藻类', w.algae.toFixed(2), highBand(w.algae, 1, 2)],
          ['水温', `${w.temp.toFixed(1)} ℃`, tempStatus],
        ];
      })()
    : [];

  return (
    <div style={{ position: 'relative', height: '100vh', width: isFullscreen ? '100vw' : '100%', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* 顶部返回与金币，轻量胶囊、不抢画面 */}
      <Link to="/" className="top-back pill glass">← 知鱼</Link>
      <div className="coin-pill pill glass">{snapshot?.coins ?? 0} 金币</div>

      {/* 新手引导 */}
      {snapshot && engineRef.current && (
        <GuideOverlay
          engine={engineRef.current}
          snapshot={snapshot}
          onChanged={() => setSnapshot(engineRef.current?.getSnapshot() ?? null)}
        />
      )}

      {/* 离线回归摘要 */}
      {offlineEvents && (
        <div className="offline-card glass">
          <h3>你离开期间</h3>
          <ul>
            {offlineEvents.map((e, i) => <li key={`${e}-${i}`}>{e}</li>)}
          </ul>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setOfflineEvents(null)}>
            知道了
          </button>
        </div>
      )}

      {/* 柔和提示，自动出现而非弹窗 */}
      {notice && <div className="toast notice" onClick={() => setNotice(null)}>{notice}</div>}

      {/* 商店抽屉：鱼/水草/装备三个分类，按需打开、看完即收 */}
      {panel === 'shop' && (
        <>
          <div className="overlay-mask" onClick={() => setPanel(null)} />
          <div className="drawer glass">
            <div className="drawer-title">
              <h2>逛一逛</h2>
              <button className="btn btn-ghost" onClick={() => setPanel(null)}>✕</button>
            </div>
            <div className="tabs">
              <button className={shopTab === 'fish' ? 'tab active' : 'tab'} onClick={() => setShopTab('fish')}>小鱼</button>
              <button className={shopTab === 'plant' ? 'tab active' : 'tab'} onClick={() => setShopTab('plant')}>水草</button>
              <button className={shopTab === 'equipment' ? 'tab active' : 'tab'} onClick={() => setShopTab('equipment')}>装备</button>
              <button className={shopTab === 'gift' ? 'tab active' : 'tab'} onClick={() => setShopTab('gift')}>礼遇</button>
            </div>

            {shopTab === 'fish' && (
              <div className="shop-grid">
                {FISH_CATALOG.map((spec) => (
                  <div className="shelf" key={spec.id}>
                    <div className="shelf-thumb">
                      {shopIcons[spec.id]
                        ? <img src={shopIcons[spec.id]} alt={spec.name} draggable={false} />
                        : <span className="shelf-loading">…</span>}
                    </div>
                    <div className="shelf-body">
                      <div className="name">{spec.name}</div>
                      <div className="meta">{spec.idealTemp[0]}-{spec.idealTemp[1]}℃ · 群游 {spec.minSchool} 条</div>
                      <div className="shelf-foot">
                        <span className="price">{spec.price} 金</span>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => { track('buy_fish', { spec: spec.id }); run(() => engineRef.current!.buyFish(spec.id)); }}
                        >带回家</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {shopTab === 'plant' && (
              <div className="shop-grid">
                {PLANT_CATALOG.map((spec) => (
                  <div className="shelf" key={spec.id}>
                    <div className="shelf-thumb">
                      {shopIcons[spec.id]
                        ? <img src={shopIcons[spec.id]} alt={spec.name} draggable={false} />
                        : <span className="shelf-loading">…</span>}
                    </div>
                    <div className="shelf-body">
                      <div className="name">{spec.name}</div>
                      <div className="meta">光照 {spec.lightNeed} · CO2 {spec.co2Need}</div>
                      <div className="shelf-foot">
                        <span className="price">{spec.price} 金</span>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => { track('buy_plant', { spec: spec.id }); run(() => engineRef.current!.buyPlant(spec.id)); }}
                        >种一棵</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {shopTab === 'equipment' && (
              <div className="shop-grid">
                {EQUIPMENT_CATALOG.map((spec) => {
                  const owned = snapshot?.ownedEquipment.includes(spec.id);
                  const isInstalled = snapshot?.installed[spec.type] === spec.id;
                  return (
                    <div className={`shelf${isInstalled ? ' equipped' : ''}`} key={spec.id}>
                      <div className="shelf-thumb">
                        {shopIcons[spec.id]
                          ? <img src={shopIcons[spec.id]} alt={spec.name} draggable={false} />
                          : <span className="shelf-loading">…</span>}
                        {isInstalled && <span className="shelf-badge">使用中</span>}
                      </div>
                      <div className="shelf-body">
                        <div className="name">{spec.name}</div>
                        <div className="meta">{isInstalled ? '正在使用' : owned ? '已拥有' : '尚未拥有'}</div>
                        <div className="shelf-foot">
                          <span className="price">{spec.price} 金</span>
                          {isInstalled ? <span className="in-use">使用中</span>
                            : owned ? (
                              <button
                                className="btn btn-sm"
                                onClick={() => { track('install_equipment', { spec: spec.id }); run(() => engineRef.current!.installEquipment(spec.id)); }}
                              >装上</button>
                            ) : (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => { track('buy_equipment', { spec: spec.id }); run(() => engineRef.current!.buyEquipment(spec.id)); }}
                              >购买</button>
                            )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {shopTab === 'gift' && (
              <>
                {snapshot?.monthlyPass && snapshot.monthlyPass.expireGameTime > snapshot.gameTime && (
                  <div className="pass-status">月卡生效中，每日可领额外金币</div>
                )}
                <div className="shop-grid">
                  {PAID_PRODUCT_CATALOG.map((p) => {
                    const passActive = p.kind === 'monthly-pass' &&
                      !!snapshot && snapshot.monthlyPass.expireGameTime > snapshot.gameTime;
                    return (
                      <div className={`shelf${passActive ? ' equipped' : ''}`} key={p.id}>
                        <div className="shelf-thumb">
                          <img src={GIFT_ICONS[p.id]} alt={p.name} draggable={false} />
                          {passActive && <span className="shelf-badge">生效中</span>}
                        </div>
                        <div className="shelf-body">
                          <div className="name">{p.name}</div>
                          <div className="meta">
                            {p.kind === 'coin-pack'
                              ? `立即获得 ${p.grantCoins} 金币`
                              : `${p.passDays} 游戏日 · 每日 ${p.dailyCoins} 金币`}
                          </div>
                          <div className="shelf-foot">
                            <span className="price">¥{p.priceCny}</span>
                            {passActive ? <span className="in-use">生效中</span>
                              : (
                                <button className="btn btn-primary btn-sm" onClick={() => runPurchase(p.id)}>
                                  {p.kind === 'coin-pack' ? '购买' : '开通'}
                                </button>
                              )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* 水质抽屉：默认只在这里看专业参数，降低常态信息密度 */}
      {panel === 'water' && (
        <>
          <div className="overlay-mask" onClick={() => setPanel(null)} />
          <div className="drawer glass">
            <div className="drawer-title">
              <h2>水质详情</h2>
              <button className="btn btn-ghost" onClick={() => setPanel(null)}>✕</button>
            </div>

            {/* 放置环境：轻量切换，窗台会有持续阳光 */}
            <h3 style={{ fontSize: 13, margin: '4px 0 8px', color: 'var(--ink-soft)' }}>放在哪里</h3>
            <div className="quality-mini" style={{ marginBottom: 14 }}>
              {ENVIRONMENT_CATALOG.map((env) => (
                <button
                  key={env.id}
                  className={environmentId === env.id ? 'on' : ''}
                  onClick={() => changeEnvironment(env.id)}
                >{env.name}</button>
              ))}
            </div>

            {/* 鱼缸形状：长方/正方/圆柱，小缸容量更小 */}
            <h3 style={{ fontSize: 13, margin: '4px 0 8px', color: 'var(--ink-soft)' }}>鱼缸形状</h3>
            <div className="quality-mini" style={{ marginBottom: 14 }}>
              {TANK_SHAPE_CATALOG.map((shape) => (
                <button
                  key={shape.id}
                  className={tankShapeId === shape.id ? 'on' : ''}
                  onClick={() => changeTankShape(shape.id)}
                >{shape.name}</button>
              ))}
            </div>

            {waterRows.map(([k, v, st]) => (
              <div className="water-row" key={k}>
                <span className="label">
                  <span className={`dot ${st}`} title={STATUS_TEXT[st]} />
                  {k}
                </span>
                <span className="value">{v}</span>
              </div>
            ))}

            {/* 近期事件轻时间线 */}
            <h3 style={{ fontSize: 13, margin: '18px 0 8px', color: 'var(--ink-soft)' }}>近期动态</h3>
            <ul className="event-list">
              {eventLog.length === 0
                ? <li>风平浪静，没有特别的事</li>
                : eventLog.map((e, i) => (
                  <li
                    key={`${e}-${i}`}
                    className={/警告|超标|不足|离开|寿终/.test(e) ? 'alert' : e.startsWith('提示') ? 'hint' : ''}
                  >{e}</li>
                ))}
            </ul>

            {/* 开发/画质工具，收在底部不占主界面 */}
            <div className="tools-row">
              <button className="btn" onClick={loadAllFishModels}>加载全部鱼模型</button>
              <button className="btn" onClick={loadBuiltInFish}>加载自制孔雀鱼</button>
              <button className="btn" onClick={verifyModelPipeline}>切换 glTF 模型</button>
              <button className="btn" onClick={exportSave}>导出存档</button>
            </div>
            <div className="quality-mini" style={{ marginTop: 12 }}>
              <span>FPS {fps} ·</span>
              {(['high', 'medium', 'low'] as const).map((t) => (
                <button key={t} className={quality === t ? 'on' : ''} onClick={() => changeQuality(t)}>
                  {t === 'high' ? '高' : t === 'medium' ? '中' : '低'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 图鉴抽屉：自然发现记录，已发现显示名称、未发现为问号，不做任务清单 */}
      {panel === 'collection' && snapshot && (
        <>
          <div className="overlay-mask" onClick={() => setPanel(null)} />
          <div className="drawer glass">
            <div className="drawer-title">
              <h2>我的图鉴</h2>
              <button className="btn btn-ghost" onClick={() => setPanel(null)}>✕</button>
            </div>

            <h3 className="collection-heading">
              成就 · {snapshot.achievement.unlocked.length}/{ACHIEVEMENT_CATALOG.length}
            </h3>
            <div className="collection-grid">
              {ACHIEVEMENT_CATALOG.map((a) => {
                const on = snapshot.achievement.unlocked.includes(a.id);
                return (
                  <div key={a.id} className={on ? 'collection-item' : 'collection-item locked'}>
                    <div className="ci-thumb">
                      <svg viewBox="0 0 24 24" width="26" height="26"
                        fill={on ? '#e0a83a' : '#b8c4cc'}
                        stroke={on ? '#b07f1f' : '#9aa6ae'} strokeWidth="1">
                        <path d="M7 3h10v3h4v3c0 2.2-1.8 4-4 4h-.42A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 7.42 13H7c-2.2 0-4-1.8-4-4V6h4V3zm0 5H5.5c0 1.1.9 2 2 2V8zm10 0v2c1.1 0 2-.9 2-2H17z"/>
                      </svg>
                    </div>
                    <div className="ci-text">
                      <div className="ci-name">{on ? a.name : '？'}</div>
                      <div className="ci-meta">{on ? a.description : '尚未达成'}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <h3 className="collection-heading">
              小鱼 · {snapshot.collection.fish.length}/{FISH_CATALOG.length}
            </h3>
            <div className="collection-grid">
              {FISH_CATALOG.map((f) => {
                const on = snapshot.collection.fish.includes(f.id);
                return (
                  <div key={f.id} className={on ? 'collection-item' : 'collection-item locked'}>
                    <div className="ci-thumb">
                      {on && shopIcons[f.id]
                        ? <img src={shopIcons[f.id]} alt={f.name} draggable={false} />
                        : <span className="ci-q">？</span>}
                    </div>
                    <div className="ci-text">
                      <div className="ci-name">{on ? f.name : '？'}</div>
                      <div className="ci-meta">{on ? `适合 ${f.idealTemp[0]}-${f.idealTemp[1]}℃` : '尚未遇见'}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <h3 className="collection-heading">
              稀有品系 · {snapshot.collection.variants.length}/{RARE_VARIANT_CATALOG.length}
            </h3>
            <div className="collection-grid">
              {RARE_VARIANT_CATALOG.map((v) => {
                const on = snapshot.collection.variants.includes(v.id);
                const hex = '#' + v.color.toString(16).padStart(6, '0');
                return (
                  <div key={v.id} className={on ? 'collection-item' : 'collection-item locked'}>
                    <div className="ci-thumb" style={on ? { boxShadow: `inset 0 0 0 2px ${hex}` } : undefined}>
                      {on && shopIcons[v.baseSpecId]
                        ? <img src={shopIcons[v.baseSpecId]} alt={v.name} draggable={false} />
                        : <span className="ci-q">？</span>}
                    </div>
                    <div className="ci-text">
                      <div className="ci-name">{on ? v.name : '？'}</div>
                      <div className="ci-meta">{on ? '已收藏' : '等待惊喜'}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <h3 className="collection-heading">
              水草 · {snapshot.collection.plants.length}/{PLANT_CATALOG.length}
            </h3>
            <div className="collection-grid">
              {PLANT_CATALOG.map((p) => {
                const on = snapshot.collection.plants.includes(p.id);
                return (
                  <div key={p.id} className={on ? 'collection-item' : 'collection-item locked'}>
                    <div className="ci-thumb">
                      {on && shopIcons[p.id]
                        ? <img src={shopIcons[p.id]} alt={p.name} draggable={false} />
                        : <span className="ci-q">？</span>}
                    </div>
                    <div className="ci-text">
                      <div className="ci-name">{on ? p.name : '？'}</div>
                      <div className="ci-meta">{on ? '已种植' : '尚未种植'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 底部浮动操作坞：核心陪伴动作一屏可达，全屏时隐藏 */}
      {!isFullscreen && (
        <div className="dock glass">
          <button className="btn-icon" onClick={() => { track('feed'); run(() => engineRef.current!.feed(1)); }}>喂食</button>
          <button className="btn-icon" onClick={() => { track('water_change'); run(() => engineRef.current!.changeWater(1 / 3)); }}>换水</button>
          <button
            className={lightOn ? 'btn-icon active' : 'btn-icon'}
            onClick={() => {
              const next = !lightOn;
              setLightOn(next);
              track('toggle_light', { on: next });
              engineRef.current?.setLight(next);
            }}
          >{lightOn ? '关灯' : '开灯'}</button>
          <span className="dock-divider" />
          <button id="guide-shop-btn" className="btn-icon" onClick={() => setPanel('shop')}>商店</button>
          <button className="btn-icon" onClick={() => setPanel('collection')}>图鉴</button>
          <button className="btn-icon" onClick={() => setPanel('water')}>水质</button>
          <span className="dock-divider" />
          <button className={isRecording ? 'btn-icon active' : 'btn-icon'} onClick={toggleRecord}>
            {isRecording ? `${recordSeconds}s` : '录制'}
          </button>
          <button className="btn-icon" onClick={() => { track('enter_fullscreen'); toggleFullscreen(); }}>全屏</button>
        </div>
      )}
      {isFullscreen && (
        <button className="exit-fs btn glass" onClick={toggleFullscreen}>退出全屏（Esc）</button>
      )}
    </div>
  );
}
