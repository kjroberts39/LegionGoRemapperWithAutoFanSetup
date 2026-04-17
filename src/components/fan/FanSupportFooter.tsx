import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
} from 'decky-frontend-lib';
import { VFC } from 'react';
import { FanFixFlowState } from '../../hooks/fan';
import FanFixFlow from './FanFixFlow';

interface FanSupportFooterProps {
  fixFlow: FanFixFlowState;
}

/**
 * Compact footer appended below normal fan curve sliders when
 * supportsCustomFanCurves is true.  Surfaces fan-support health at a glance
 * and lets the user re-check or reapply the fix without navigating away.
 */
const FanSupportFooter: VFC<FanSupportFooterProps> = ({ fixFlow }) => {
  const { phase, progressStep, errorMsg, checkingSupport, onApplyFix, onCheckAgain } = fixFlow;
  const isFixing = phase === 'fixing';

  return (
    <PanelSection title="Fan Support">
      <PanelSectionRow>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', boxSizing: 'border-box',
        }}>
          <span style={{ fontSize: '12px', color: '#4caf6e' }}>
            &#10003; Fan support: OK
          </span>
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
