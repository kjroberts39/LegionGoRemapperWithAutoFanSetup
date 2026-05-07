import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
} from 'decky-frontend-lib';
import { VFC } from 'react';
import { FanFixFlowState, timeSince } from '../../hooks/fan';
import FanFixFlow from './FanFixFlow';
import FanStatusBadge from './FanStatusBadge';

interface FanSupportFooterProps {
  fixFlow: FanFixFlowState;
}

const FanSupportFooter: VFC<FanSupportFooterProps> = ({ fixFlow }) => {
  const { phase, progressStep, errorMsg, checkingSupport, lastChecked, onApplyFix, onCheckAgain } = fixFlow;
  const isFixing = phase === 'fixing';

  return (
    <PanelSection title="Fan Support">
      <PanelSectionRow>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', boxSizing: 'border-box',
        }}>
          <FanStatusBadge status={checkingSupport ? 'checking' : 'ok'} />
          <span
            style={{
              fontSize: '11px',
              color: checkingSupport ? '#6a7a8a' : '#8a9ab0',
              cursor: checkingSupport ? 'default' : 'pointer',
              textDecoration: checkingSupport ? 'none' : 'underline',
              textUnderlineOffset: '3px',
            }}
            onClick={checkingSupport ? undefined : onCheckAgain}
          >
            {checkingSupport ? 'Checking…' : 'Check again'}
          </span>
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <span style={{ fontSize: '11px', color: '#6a5a40' }}>
          Last checked: {timeSince(lastChecked)}
        </span>
      </PanelSectionRow>

      <FanFixFlow phase={phase} progressStep={progressStep} errorMsg={errorMsg} />

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onApplyFix} disabled={isFixing || checkingSupport}>
          {isFixing ? 'Applying Fix…' : 'Reapply fix'}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

export default FanSupportFooter;
