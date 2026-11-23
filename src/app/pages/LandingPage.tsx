import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applyThemeToDom, readTheme, saveTheme, THEME_OPTIONS, type UiTheme } from '../theme';

// 首页：濠梁之辩的水墨开场。
// 背景是一段 5 秒的水墨短片（桥上人俯看、桥下锦鲤缓游），播完停在末帧，
// 再由本组件淡入题字、印章、引文与入口。
// 视频加载失败、自动播放被拦、或系统开启减弱动态效果时，直接落到 poster 定格画面。
//
// 霓虹皮：一段同主题的 5 秒短片。首帧就是上面那张静帧，所以视频没到时
// 画面已经是它，不存在黑场；两套皮走完全相同的播放/跳过/兜底逻辑。
// 短片左上角同样带「AI生成」，与水墨片一样靠 CSS 裁掉顶部 8%。

const VIDEO_SRC = '/videos/landing.mp4';
const POSTER_SRC = '/videos/landing-poster.jpg';
const CYBER_VIDEO_SRC = '/videos/landing-cyber.mp4';
const CYBER_POSTER_SRC = '/videos/landing-cyber.jpg';
// 自动播放被浏览器拦下时不会触发 ended，用兜底计时保证入口一定出现
const INTRO_FALLBACK_MS = 6500;

export default function LandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const [videoReady, setVideoReady] = useState(false);
  const [resting, setResting] = useState(false);
  const [skipped, setSkipped] = useState(false);
  // 皮相：首页也要能切，切完带进鱼缸（存 localStorage，main.tsx 首帧已挂好 data-theme）
  const [theme, setThemeState] = useState<UiTheme>(() => readTheme());
  const isInk = theme === 'ink';
  const videoSrc = isInk ? VIDEO_SRC : CYBER_VIDEO_SRC;
  const posterSrc = isInk ? POSTER_SRC : CYBER_POSTER_SRC;
  // 减弱动态效果时连视频都不放：只留 poster 定格（autoPlay 也要一并关掉，
  // 否则浏览器仍会自动播，pause 已经来不及）
  const [reduceMotion] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false),
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const el = video; // 闭包内固定非空引用，避免 TS 认为 ref.current 可能变 null
    // iOS/Chrome 的自动播放前提是静音，属性不一定生效，这里再设一次
    el.muted = true;

    if (reduceMotion) {
      setResting(true);
      return undefined;
    }

    let disposed = false;
    let started = false;   // 视频是否真正开播过
    let unlocked = false;  // 是否已拿到用户手势
    let fallbackId = 0;

    function unbindUnlock(): void {
      (['pointerdown', 'touchstart', 'click'] as const).forEach((e) =>
        window.removeEventListener(e, onUserGesture, true));
    }

    // 用户首次交互：浏览器自动播放限制已解除，重试播放
    function onUserGesture(): void {
      if (disposed || unlocked) return;
      unlocked = true;
      unbindUnlock();
      el.play().catch(() => {
        // 用户手势后仍失败（加载问题等）才落静帧兜底
        if (!disposed) setResting(true);
      });
    }

    function bindUnlock(): void {
      if (unlocked) return;
      (['pointerdown', 'touchstart', 'click'] as const).forEach((e) =>
        window.addEventListener(e, onUserGesture, { capture: true, passive: true }));
    }

    // 视频真正开播：撤销兜底计时，收起可能已显示的静帧 UI
    function onPlaying(): void {
      started = true;
      window.clearTimeout(fallbackId);
      if (!disposed) {
        setVideoReady(true);
        setResting(false);
      }
    }

    function attemptPlay(): void {
      el.play().catch((err: unknown) => {
        if (disposed) return;
        // 用 name 判断而非 instanceof：DOMException 跨 realm/某些 WebView 下 instanceof 不可靠
        const name = (err as { name?: string } | null)?.name;
        if (name === 'NotAllowedError') {
          // 移动端首次进入没有用户手势，play() 被自动播放策略拦下。
          // 切主题之所以能播，正因为那一下点击解除了限制——这里等任意交互补播，
          // 而不是立刻 setResting(true) 永久停在静帧。
          bindUnlock();
        } else {
          setResting(true);
        }
      });
    }

    video.addEventListener('playing', onPlaying);
    // 缓存命中时 canplay 可能在 React 绑定 onCanPlay 前就触发，
    // 那样 videoReady 永远为 false、视频停在 opacity:0，只看见 poster 静帧
    if (video.readyState >= 3) setVideoReady(true);

    // 兜底：始终保证入口一定出现；视频真开播后由 onPlaying 撤销
    fallbackId = window.setTimeout(() => {
      if (!disposed && !started) setResting(true);
    }, INTRO_FALLBACK_MS);

    if (video.readyState >= 3) attemptPlay();
    else video.addEventListener('canplay', attemptPlay, { once: true });

    return () => {
      disposed = true;
      window.clearTimeout(fallbackId);
      unbindUnlock();
      video.removeEventListener('canplay', attemptPlay);
      video.removeEventListener('playing', onPlaying);
    };
  }, [reduceMotion, theme]);

  // 换皮：入场状态清空，让水墨/霓虹各自从头走一遍
  const changeTheme = (next: UiTheme): void => {
    if (next === theme) return;
    setThemeState(next);
    saveTheme(next);
    applyThemeToDom(next);
    setResting(false);
    setSkipped(false);
    setVideoReady(false);
  };

  const skip = (): void => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05);
    }
    setSkipped(true);
  };

  const showUi = resting || skipped;

  return (
    <div className={`landing-root${isInk ? '' : ' cyber'}${showUi ? ' is-rest' : ''}`}>
      {/* 背景：poster 垫底，视频加载完成后再淡入，避免黑场 */}
      <div
        className="landing-poster"
        style={{ backgroundImage: `url(${posterSrc})` }}
        aria-hidden="true"
      />
      <video
        key={theme}
        ref={videoRef}
        className={`landing-video${videoReady ? ' is-ready' : ''}`}
        src={videoSrc}
        poster={posterSrc}
        autoPlay={!reduceMotion}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onCanPlay={() => setVideoReady(true)}
        onEnded={() => setResting(true)}
        onError={() => setResting(true)}
      />

      {/* 皮相开关：开场期间也能点，选完直接带进鱼缸 */}
      <div className="landing-skin" role="group" aria-label="界面风格">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={theme === opt.id ? 'on' : ''}
            onClick={() => changeTheme(opt.id)}
            aria-pressed={theme === opt.id}
          >{opt.name}</button>
        ))}
      </div>

      {/* 纸色薄纱 + 四角晕影：把视频收进纸的色调里，也压住画面四边 */}
      <div className="landing-wash" aria-hidden="true" />

      {/* 右侧竖排题名：知鱼；下方朱文印 */}
      <div className={`landing-title-block${showUi ? ' is-in' : ''}`}>
        <h1 className="landing-title">知鱼</h1>
        <span className="landing-seal" aria-hidden="true">知鱼</span>
      </div>

      {/* 左侧竖排引文：水墨用庄子原句，霓虹换成自撰的一句，
          让"鱼碎成光、光游过海"的画面有个落点 */}
      <div className={`landing-quote-block${showUi ? ' is-in' : ''}`}>
        <p className="landing-quote">{isInk ? '子非鱼，安知鱼之乐？' : '每一点光，都游过一段海。'}</p>
        <p className="landing-quote-source">{isInk ? '—— 《庄子 · 秋水》' : '—— 观鱼者'}</p>
      </div>

      {/* 入口 */}
      <div className={`landing-entry${showUi ? ' is-in' : ''}`}>
        <button type="button" onClick={() => navigate('/tank')} className="landing-btn">
          观 鱼
        </button>
        <span className="landing-hint">进入我的鱼缸</span>
      </div>

      {/* 开场期间可跳过 */}
      {!showUi && (
        <button type="button" className="landing-skip" onClick={skip}>
          跳过
        </button>
      )}

      <style>{`
        .landing-root {
          position: relative;
          height: 100vh;
          overflow: hidden;
          background: #efe8d8;
          color: #2c3235;
          font-family: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif SC", "SimSun", serif;
        }

        /* 皮相开关：放左上角，与右侧竖排题名、左下引文、底部入口都不打架 */
        .landing-skin {
          position: absolute; left: 22px; top: 20px; z-index: 4;
          display: flex; gap: 2px; padding: 3px;
          border-radius: 999px;
          background: rgba(247,242,230,0.42);
          border: 1px solid rgba(44,50,53,0.16);
          -webkit-backdrop-filter: blur(8px);
          backdrop-filter: blur(8px);
          animation: landing-fadein 1s ease both;
        }
        .landing-skin button {
          border: 0; background: transparent; cursor: pointer;
          font-family: inherit; font-size: 11.5px;
          letter-spacing: 0.22em; padding: 5px 11px 5px 13px;
          border-radius: 999px; color: #55605c;
          transition: background-color .25s ease, color .25s ease;
        }
        .landing-skin button:hover { color: #26302f; }
        .landing-skin button.on { background: rgba(250,247,238,0.95); color: #26302f; }
        .landing-skin button:focus-visible { outline: 2px solid #6b7a72; outline-offset: 2px; }
        @keyframes landing-fadein { from { opacity: 0; } to { opacity: 1; } }
        .landing-poster,
        .landing-video {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          width: 100%;
          /* 高度多出 8% 并底对齐，让顶部 8% 被 .landing-root 的 overflow 裁掉。
             源视频左上角 (12,10)-(86,41) 有一行「AI生成」水印，8% 于 768 高即 61px，
             刚好把它整条边带走。没有 ffmpeg 无法直接改 mp4，这是唯一不影响画质的删法 */
          height: 108%;
          object-fit: cover;
          object-position: center 100%;
        }
        .landing-poster { background-size: cover; background-position: center 100%; }
        .landing-video {
          opacity: 0;
          transition: opacity .9s ease;
          /* 定格后极缓的呼吸，画面不"死" */
          transform-origin: 50% 46%;
        }
        .landing-video.is-ready { opacity: 1; }
        .landing-root.is-rest .landing-video {
          animation: landing-breathe 64s ease-in-out infinite alternate;
        }
        @keyframes landing-breathe {
          from { transform: scale(1.001); }
          to { transform: scale(1.045); }
        }

        /* 纸色薄纱 + 上浅下浓的收边：让视频与纸底、题字连成一张画 */
        .landing-wash {
          position: absolute; inset: 0; pointer-events: none;
          background:
            radial-gradient(120% 88% at 50% 6%, rgba(247,242,230,0.5) 0%, rgba(247,242,230,0.1) 46%, rgba(247,242,230,0) 70%),
            /* 左侧中部一团薄雾：引文恰好落在桥的水中倒影上，靠它把字托住 */
            radial-gradient(22% 32% at 11% 60%, rgba(247,242,230,0.5) 0%, rgba(247,242,230,0.22) 52%, rgba(247,242,230,0) 78%),
            radial-gradient(78% 62% at 50% 46%, rgba(255,253,246,0) 52%, rgba(120,105,80,0.12) 100%),
            linear-gradient(to top, rgba(243,238,227,0.94) 0%, rgba(243,238,227,0.82) 7%, rgba(243,238,227,0.5) 15%, rgba(243,238,227,0.18) 26%, rgba(243,238,227,0) 40%);
        }
        /* 左上角的纸边晕染：让画面与纸自然接上 */
        .landing-wash::before {
          content: ''; position: absolute; left: 0; top: 0;
          width: 340px; height: 180px;
          background: radial-gradient(120% 130% at 0% 0%, rgba(246,241,229,0.95) 0%, rgba(246,241,229,0.55) 42%, rgba(246,241,229,0) 72%);
        }

        /* ---- 题名 ---- */
        .landing-title-block {
          position: absolute; top: 12%; right: 7%;
          display: flex; flex-direction: column; align-items: center; gap: 18px;
          opacity: 0; transform: translateY(10px);
          transition: opacity 1.6s ease, transform 1.6s ease;
        }
        .landing-title-block.is-in { opacity: 1; transform: translateY(0); }
        .landing-title {
          margin: 0; writing-mode: vertical-rl;
          font-size: clamp(56px, 7.2vw, 104px);
          font-weight: 400; letter-spacing: 0.22em;
          font-family: "STKaiti", "KaiTi", "Kaiti SC", "Songti SC", serif;
          color: #23292c;
          text-shadow:
            0 0 4px rgba(247,242,230,0.95),
            0 0 18px rgba(247,242,230,0.9),
            0 0 34px rgba(247,242,230,0.7);
        }
        /* 朱文印：小方块、白文二字，边角略残 */
        .landing-seal {
          width: 46px; height: 46px; border-radius: 3px;
          display: grid; place-items: center;
          writing-mode: vertical-rl; letter-spacing: 0.1em;
          font-size: 15px; line-height: 1;
          color: #f6efe0; background: #a33a2c;
          box-shadow: inset 0 0 0 2px rgba(246,239,224,0.5);
          transform: rotate(-2deg);
        }

        /* ---- 引文 ---- */
        .landing-quote-block {
          position: absolute; left: 7.5%; bottom: 15%;
          display: flex; flex-direction: row-reverse; align-items: flex-start; gap: 14px;
          opacity: 0; transform: translateY(12px);
          transition: opacity 1.4s ease 0.5s, transform 1.4s ease 0.5s;
        }
        .landing-quote-block.is-in { opacity: 1; transform: translateY(0); }
        .landing-quote {
          margin: 0; writing-mode: vertical-rl;
          font-size: clamp(14px, 1.25vw, 18px); letter-spacing: 0.42em;
          color: #333a3d;
          /* 引文常常落在桥的水中倒影上，靠一圈纸色光把字托出来 */
          text-shadow:
            0 0 6px rgba(247,242,230,1),
            0 0 16px rgba(247,242,230,0.92),
            0 0 30px rgba(247,242,230,0.6);
        }
        .landing-quote-source {
          margin: 0; padding-top: 4px; writing-mode: vertical-rl;
          font-size: 11px; letter-spacing: 0.3em; color: #6d756f;
          text-shadow: 0 0 8px rgba(247,242,230,0.95), 0 0 18px rgba(247,242,230,0.8);
        }

        /* ---- 入口 ---- */
        .landing-entry {
          /* 两条鱼正好落在画面中下部，按钮无论放哪都会叠上，
             所以做成无底色 + 细墨线框：文字浮在画上，而不是一块贴纸盖住鱼 */
          position: absolute; left: 50%; bottom: 9.5%;
          transform: translate(-50%, 14px); text-align: center;
          opacity: 0;
          transition: opacity 1.2s ease 0.9s, transform 1.2s ease 0.9s;
        }
        .landing-entry.is-in { opacity: 1; transform: translate(-50%, 0); }
        .landing-btn {
          padding: 13px 58px 13px 66px;
          font-size: 17px; letter-spacing: 0.5em;
          color: #26302f; background: transparent;
          border: 1px solid rgba(44,50,53,0.42);
          cursor: pointer; font-family: inherit;
          text-shadow: 0 0 10px rgba(247,242,230,0.95), 0 0 22px rgba(247,242,230,0.8);
          transition: background-color .35s ease, border-color .35s ease, letter-spacing .35s ease;
        }
        .landing-btn:hover {
          background: rgba(243,236,221,0.92);
          border-color: #26302f;
          letter-spacing: 0.58em;
        }
        .landing-btn:focus-visible { outline: 2px solid #6b7a72; outline-offset: 4px; }
        .landing-hint {
          display: block; margin-top: 12px;
          font-size: 11px; letter-spacing: 0.32em; color: #5f6a65;
          text-shadow: 0 0 12px rgba(247,242,230,0.95);
        }

        /* ---- 跳过 ---- */
        .landing-skip {
          position: absolute; right: 28px; bottom: 26px;
          background: none; border: 0; cursor: pointer;
          color: #8b928c; font-family: inherit;
          font-size: 12px; letter-spacing: 0.3em;
          opacity: 0.75; transition: opacity .3s ease;
        }
        .landing-skip:hover { opacity: 1; }

        /* ============ 霓虹皮 ============
           结构一个不改，只把"纸"换成"夜色"、把墨线换成霓虹线。
           竖排楷体题名保留：霓虹招牌上的手写体本来就是这套视觉的常见元素，
           换成黑体反而丢了"知鱼"这两个字的识别度。 */
        .landing-root.cyber {
          background: #070c17;
          color: #dfeeff;
        }
        /* 没有短片，用同一条呼吸曲线让静帧不死 */
        .landing-root.cyber .landing-poster {
          animation: landing-breathe 72s ease-in-out infinite alternate;
          transform-origin: 50% 46%;
        }
        .landing-root.cyber .landing-wash {
          background:
            radial-gradient(120% 88% at 50% 6%, rgba(8,14,26,0.55) 0%, rgba(8,14,26,0.12) 46%, rgba(8,14,26,0) 70%),
            /* 引文那团雾改成暗色，把字从亮着的鱼缸前压下去 */
            radial-gradient(22% 32% at 11% 60%, rgba(6,10,20,0.66) 0%, rgba(6,10,20,0.28) 52%, rgba(6,10,20,0) 78%),
            radial-gradient(78% 62% at 50% 46%, rgba(3,6,12,0) 50%, rgba(0,0,0,0.4) 100%),
            linear-gradient(to top, rgba(5,9,18,0.96) 0%, rgba(5,9,18,0.86) 7%, rgba(5,9,18,0.52) 15%, rgba(5,9,18,0.18) 26%, rgba(5,9,18,0) 40%);
        }
        .landing-root.cyber .landing-wash::before {
          background: radial-gradient(120% 130% at 0% 0%, rgba(6,10,20,0.96) 0%, rgba(6,10,20,0.6) 42%, rgba(6,10,20,0) 72%);
        }
        .landing-root.cyber .landing-title {
          color: #ecf9ff;
          text-shadow:
            0 0 6px rgba(70,224,245,0.75),
            0 0 22px rgba(70,224,245,0.5),
            0 0 52px rgba(70,224,245,0.32);
        }
        .landing-root.cyber .landing-seal {
          color: #9ff0ff;
          background: rgba(10,18,34,0.7);
          box-shadow:
            inset 0 0 0 1px rgba(70,224,245,0.7),
            0 0 18px rgba(70,224,245,0.35);
        }
        .landing-root.cyber .landing-quote {
          color: #d3e8fb;
          text-shadow: 0 0 8px rgba(4,8,16,0.95), 0 0 20px rgba(4,8,16,0.85);
        }
        .landing-root.cyber .landing-quote-source {
          color: #8299b5;
          text-shadow: 0 0 8px rgba(4,8,16,0.95);
        }
        .landing-root.cyber .landing-btn {
          color: #d8f5ff;
          /* 暗底 + 高不透明度：按钮常落在鱼缸下沿那条亮边上，纯描边会被亮带吞掉，
             0.62 也还透出一层灰，压到 0.82 才读得出是块"操作台面板" */
          background: rgba(5,10,20,0.82);
          border-color: rgba(70,224,245,0.5);
          text-shadow: 0 0 12px rgba(70,224,245,0.55);
          -webkit-backdrop-filter: blur(3px);
          backdrop-filter: blur(3px);
        }
        .landing-root.cyber .landing-btn:hover {
          background: rgba(70,224,245,0.18);
          border-color: #6ff0ff;
          color: #f2fdff;
        }
        .landing-root.cyber .landing-btn:focus-visible { outline-color: #46e0f5; }
        .landing-root.cyber .landing-hint { color: #8299b5; text-shadow: 0 0 10px rgba(4,8,16,0.9); }
        .landing-root.cyber .landing-skip { color: #6b7e9c; }
        .landing-root.cyber .landing-skin {
          background: rgba(10,17,32,0.55);
          border-color: rgba(110,190,255,0.2);
        }
        .landing-root.cyber .landing-skin button { color: #a3b8d4; }
        .landing-root.cyber .landing-skin button:hover { color: #e8f3ff; }
        .landing-root.cyber .landing-skin button.on { background: rgba(70,224,245,0.2); color: #eafcff; }

        @media (max-width: 720px) {
          .landing-title-block { top: 9%; right: 7%; }
          .landing-quote-block { left: 7%; bottom: 30%; }
          .landing-entry { bottom: 7%; }
          .landing-wash::before { width: 220px; height: 120px; }
          .landing-skin { left: 14px; top: 14px; }
          .landing-skin button { padding: 5px 9px 5px 11px; font-size: 11px; letter-spacing: 0.16em; }
          /* 竖屏裁切后鱼正好落在按钮位置，底部多压一层纸色，让鱼没入水中 */
          .landing-wash::after {
            content: ''; position: absolute; left: 0; right: 0; bottom: 0;
            height: 36%;
            background: linear-gradient(to top, rgba(243,238,227,0.96) 0%, rgba(243,238,227,0.72) 34%, rgba(243,238,227,0) 100%);
          }
          .landing-root.cyber .landing-wash::after {
            background: linear-gradient(to top, rgba(5,9,18,0.97) 0%, rgba(5,9,18,0.78) 34%, rgba(5,9,18,0) 100%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-root.is-rest .landing-video { animation: none; }
          .landing-root.cyber .landing-poster { animation: none; }
          .landing-video { transition: none; }
        }
      `}</style>
    </div>
  );
}
