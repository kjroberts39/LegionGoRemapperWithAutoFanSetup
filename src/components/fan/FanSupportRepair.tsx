import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
} from 'decky-frontend-lib';
import { VFC } from 'react';
import { FanFixFlowState, useCurrentKernel } from '../../hooks/fan';
import FanFixFlow from './FanFixFlow';

interface FanSupportRepairProps {
  fixFlow: FanFixFlowState;
}

/**
 * Full-takeover panel shown when supportsCustomFanCurves is false.
 * Replaces the normal fan curve sliders with a repair prompt that includes
 * the current kernel string for context.
 */
const FanSupportRepair: VFC<FanSupportRepairProps> = ({ fixFlow }) => {
  const { phase, progressStep, errorMsg, onApplyFix } = fixFlow;
  const kernel = useCurrentKernel();
  const isFixing = phase === 'fixing';

  return (
    <PanelSection title="Fan Control">
      <PanelSectionRow>
        <div style={{
          padding: '10px 12px', width: '100%', boxSizing: 'border-box',
          background: 'rgba(232,112,64,0.08)',
          border: '1px solid rgba(232,112,64,0.25)', borderRadius: '4px',
          fontSize: '12px', color: '#c87050', lineHeight: 1.6,
        }}>
          <div>
            &#9888; ACPI fan support is not active for the current kernel.
            Custom fan curves will not respond until it is restored.
          </div>
          <div style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '11px', color: '#a08060' }}>
            Kernel: {kernel}
          </div>
        </div>
      </PanelSectionRow>

      <FanFixFlow phase={phase} progressStep={progressStep} errorMsg={errorMsg} />

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onApplyFix} disabled={isFixing}>
          {isFixing ? 'Applying Fix…' : 'Apply Fan Fix'}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
};

export default FanSupportRepair;
