import { PanelSectionRow } from 'decky-frontend-lib';
import { VFC } from 'react';
import { FaFan } from 'react-icons/fa';
import { FanFixPhase } from '../../hooks/fan';

interface FanFixFlowProps {
  phase: FanFixPhase;
  progressStep: string;
  errorMsg: string;
}

/**
 * Shared inline content for the fan-fix apply flow.
 * Renders nothing when idle; renders a progress row while fixing,
 * and a result banner on success or error.
 * Embedded by both FanSupportRepair (full-takeover) and FanSupportFooter
 * (compact) so the treatment is consistent.
 */
const FanFixFlow: VFC<FanFixFlowProps> = ({ phase, progressStep, errorMsg }) => {
  if (phase === 'idle') return null;

  return (
    <>
      {phase === 'fixing' && (
        <PanelSectionRow>
          <style>{`
            @keyframes lgrFanSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
          `}</style>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            padding: '10px 12px', width: '100%', boxSizing: 'border-box',
            background: 'rgba(200,168,75,0.06)',
            border: '1px solid rgba(200,168,75,0.2)', borderRadius: '4px',
          }}>
            <FaFan style={{
              marginTop: '2px', flexShrink: 0,
              color: '#c8a84b',
              animation: 'lgrFanSpin 1.5s linear infinite',
            }} />
            <div>
              <div style={{
                fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
                color: '#c8a84b', marginBottom: '3px', textTransform: 'uppercase',
              }}>
                Applying Fix…
              </div>
              <div style={{ fontSize: '12px', color: '#a09070', lineHeight: 1.5 }}>
                {progressStep || 'Starting…'}
              </div>
            </div>
          </div>
        </PanelSectionRow>
      )}

      {phase === 'success' && (
        <PanelSectionRow>
          <div style={{
            padding: '8px 12px', width: '100%', boxSizing: 'border-box',
            background: 'rgba(76,175,110,0.1)',
            border: '1px solid rgba(76,175,110,0.3)', borderRadius: '4px',
            fontSize: '12px', color: '#4caf6e', lineHeight: 1.5,
          }}>
            &#10003; Fan support restored. Restart Decky or your device to
            activate fan controls.
          </div>
        </PanelSectionRow>
      )}

      {phase === 'error' && (
        <PanelSectionRow>
          <div style={{
            padding: '8px 12px', width: '100%', boxSizing: 'border-box',
            background: 'rgba(232,64,64,0.08)',
            border: '1px solid rgba(232,64,64,0.25)', borderRadius: '4px',
            fontSize: '12px', color: '#e06060', lineHeight: 1.5,
            wordBreak: 'break-word',
          }}>
            &#10007; {errorMsg || 'An unknown error occurred.'}
          </div>
        </PanelSectionRow>
      )}
    </>
  );
};

export default FanFixFlow;
