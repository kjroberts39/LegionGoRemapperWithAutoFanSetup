import { VFC } from 'react';

export type BadgeStatus = 'ok' | 'missing' | 'checking';

interface FanStatusBadgeProps {
  status: BadgeStatus;
}

const configs: Record<BadgeStatus, { color: string; bg: string; border: string; dot: string; label: string }> = {
  ok:       { color: '#4caf6e', bg: 'rgba(76,175,110,0.15)',  border: 'rgba(76,175,110,0.4)',  dot: '#4caf6e', label: 'ACTIVE' },
  missing:  { color: '#e87040', bg: 'rgba(232,112,64,0.15)',  border: 'rgba(232,112,64,0.4)',  dot: '#e87040', label: 'NOT ACTIVE' },
  checking: { color: '#a09070', bg: 'rgba(160,144,112,0.1)',  border: 'rgba(160,144,112,0.3)', dot: '#a09070', label: 'CHECKING…' },
};

const FanStatusBadge: VFC<FanStatusBadgeProps> = ({ status }) => {
  const c = configs[status];
  return (
    <>
      <style>{`@keyframes lgrBadgePulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px',
        padding: '4px 10px', borderRadius: '4px',
        background: c.bg, border: `1px solid ${c.border}`,
        fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: c.color,
      }}>
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%', background: c.dot,
          boxShadow: status === 'ok' ? `0 0 6px ${c.dot}` : undefined,
          animation: status === 'checking' ? 'lgrBadgePulse 1.2s ease-in-out infinite' : undefined,
        }} />
        {c.label}
      </div>
    </>
  );
};

export default FanStatusBadge;
