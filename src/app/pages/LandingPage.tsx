import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LandingScene } from '../../render/LandingScene';

export default function LandingPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const scene = new LandingScene(mountRef.current);
    scene.start();
    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      scene.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', background: '#0e1722', color: '#e8f1f8' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      <div
        style={{
          position: 'relative', zIndex: 1, height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, "Songti SC", serif', textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: 12, color: '#7d9bb5', marginBottom: 18, paddingLeft: 12 }}>
          ZHIYU
        </div>
        <h1 style={{ fontSize: 96, fontWeight: 200, margin: 0, letterSpacing: 16, paddingLeft: 16 }}>
          知鱼
        </h1>
        <p style={{ fontSize: 17, color: '#9fb8cc', marginTop: 28, letterSpacing: 4, fontWeight: 300 }}>
          子非鱼，安知鱼之乐？
        </p>

        <button
          type="button"
          onClick={() => navigate('/tank')}
          className="guanyu-btn"
          style={{
            marginTop: 44, padding: '12px 56px', fontSize: 18, letterSpacing: 10,
            background: 'transparent', color: '#d8e8f5', border: '1px solid rgba(180,210,235,0.55)',
            cursor: 'pointer', fontFamily: 'inherit', paddingLeft: 66,
          }}
        >
          观鱼
        </button>
        <div style={{ fontSize: 11, color: '#6d879d', marginTop: 12, letterSpacing: 3 }}>
          进入我的鱼缸
        </div>
      </div>

      <style>{`
        .guanyu-btn { transition: background-color .3s ease, border-color .3s ease; }
        .guanyu-btn:hover { background: rgba(159,196,224,0.16); border-color: rgba(200,224,242,0.9); }
        .guanyu-btn:focus-visible { outline: 2px solid #9fc4e0; outline-offset: 3px; }
      `}</style>
    </div>
  );
}
