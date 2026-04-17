import { Fragment, VFC, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fanSlice, selectActiveFanCurve } from '../../redux-modules/fanSlice';
import { useFullFanSpeedThreshold } from '../../hooks/fan';
import {
  PanelSection,
  PanelSectionRow,
  SliderField,
  ToggleField
} from 'decky-frontend-lib';

const DISABLE_KEY = 'legion-go-remapper-disable-fan-curve-limit';

const useDisableLimit = () => {
  const [disableLimits, setDisableLimits] = useState(
    window.localStorage.getItem(DISABLE_KEY) === 'true' || false
  );

  const setLimit = (enable: boolean) => {
    setDisableLimits(enable);
    window.localStorage.setItem(DISABLE_KEY, `${enable}`);
  };

  return { disableLimits, setLimit };
};

const FanCurveSliders: VFC = () => {
  const activeFanCurve = useSelector(selectActiveFanCurve);
  const { disableLimits, setLimit } = useDisableLimit();
  const { threshold, setThreshold } = useFullFanSpeedThreshold();
  const dispatch = useDispatch();

  const sliders = Object.entries(activeFanCurve).map(([temp, fanSpeed], idx) => {
    const tempNum = parseInt(temp);

    if (threshold !== null && tempNum > threshold) return null;

    if (threshold !== null && tempNum === threshold) {
      return (
        <PanelSectionRow key={idx}>
          <ToggleField
            label={`\u2265 ${temp}\u2103 \u2014 Full speed`}
            checked={true}
            onChange={() => setThreshold(null)}
          />
        </PanelSectionRow>
      );
    }

    const updateFanCurveValue = (t: string, speed: number) => {
      if (!disableLimits && idx >= 6 && speed < 70) speed = 70;
      return dispatch(fanSlice.actions.updateFanCurve({ temp: t, fanSpeed: speed }));
    };

    const showThresholdToggle = tempNum >= 70 && threshold === null;

    return (
      <Fragment key={idx}>
        <PanelSectionRow>
          <SliderField
            label={`${temp} \u2103`}
            value={fanSpeed}
            showValue
            valueSuffix="%"
            step={5}
            min={5}
            max={115}
            validValues="range"
            bottomSeparator="none"
            onChange={(newSpeed) => updateFanCurveValue(temp, newSpeed)}
          />
        </PanelSectionRow>
        {showThresholdToggle && (
          <PanelSectionRow>
            <ToggleField
              label={`Full speed \u2265 ${temp}\u2103`}
              checked={false}
              onChange={() => setThreshold(tempNum)}
            />
          </PanelSectionRow>
        )}
      </Fragment>
    );
  });

  return (
    <PanelSection title={'\u2103 | Fan Speed (%)'}>
      <PanelSectionRow>
        <ToggleField
          label="Disable Fan Curve Limits"
          checked={disableLimits}
          onChange={setLimit}
        />
      </PanelSectionRow>
      {sliders}
    </PanelSection>
  );
};

export default FanCurveSliders;
