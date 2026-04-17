import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ConfirmModal, showModal } from 'decky-frontend-lib';
import {
  fanSlice,
  selectCustomFanCurvesEnabled,
  selectEnableFullFanSpeedMode,
  selectFanPerGameProfilesEnabled,
  selectSupportsCustomFanCurves
} from '../redux-modules/fanSlice';
import { getServerApi } from '../backend/utils';
import FanRestartModal from '../components/fan/FanRestartModal';

export const useEnableFullFanSpeedMode = () => {
  const result = useSelector(selectEnableFullFanSpeedMode);
  const dispatch = useDispatch();

  const setter = (enabled: boolean) => {
    return dispatch(fanSlice.actions.setEnableFullFanSpeedMode(enabled));
  };
  return {
    enableFullFanSpeedMode: result,
    setEnableFullFanSpeedMode: setter
  };
};

export const useSupportsCustomFanCurves = () => {
  const result = useSelector(selectSupportsCustomFanCurves);
  return result;
};

export const useCustomFanCurvesEnabled = () => {
  const enabled = useSelector(selectCustomFanCurvesEnabled);
  const dispatch = useDispatch();

  const setter = (enabled: boolean) => {
    return dispatch(fanSlice.actions.setCustomFanCurvesEnabled(enabled));
  };

  return { customFanCurvesEnabled: enabled, setCustomFanCurvesEnabled: setter };
};

export const useFanPerGameProfilesEnabled = () => {
  const fanPerGameProfilesEnabled = useSelector(
    selectFanPerGameProfilesEnabled
  );
  const dispatch = useDispatch();

  const setter = (enabled: boolean) => {
    return dispatch(fanSlice.actions.setFanPerGameProfilesEnabled(enabled));
  };

  return { fanPerGameProfilesEnabled, setFanPerGameProfilesEnabled: setter };
};

// ── Fan fix flow ───────────────────────────────────────────────────────────────

export type FanFixPhase = 'idle' | 'fixing' | 'success' | 'error';

export interface FanFixFlowState {
  phase: FanFixPhase;
  progressStep: string;
  errorMsg: string;
  checkingSupport: boolean;
  onApplyFix: () => void;
  onCheckAgain: () => void;
}

interface FixProgressResult {
  step: string;
  running: boolean;
  done: boolean;
  success: boolean | null;
  error: string;
  reboot_required: boolean;
}

/**
 * Encapsulates all fan-fix flow state and logic.
 * Intended to be instantiated once in FanPanel so the state survives the
 * FanSupportRepair → normal-sliders+FanSupportFooter transition after a fix.
 */
export const useFanFixFlow = (): FanFixFlowState => {
  const [phase, setPhase] = useState<FanFixPhase>('idle');
  const [progressStep, setProgressStep] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [checkingSupport, setCheckingSupport] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dispatch = useDispatch();

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshSupportState = useCallback(async () => {
    const serverApi = getServerApi();
    if (!serverApi) return;
    const { result } = await serverApi.callPluginMethod('refresh_fan_support', {});
    dispatch(fanSlice.actions.setSupportsCustomFanCurves(Boolean(result)));
  }, [dispatch]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const serverApi = getServerApi();
      if (!serverApi) return;
      try {
        const { result } = await serverApi.callPluginMethod('get_fan_fix_progress', {});
        const prog = result as FixProgressResult;
        if (!prog) return;
        setProgressStep(prog.step);
        if (prog.done) {
          stopPolling();
          if (prog.success) {
            setPhase('success');
            // Refresh supportsCustomFanCurves so FanPanel switches to normal view.
            // Small delay lets the dkms module settle before the modprobe check.
            setTimeout(refreshSupportState, 2000);
            showModal(<FanRestartModal rebootRequired={prog.reboot_required} />);
          } else {
            setPhase('error');
            setErrorMsg(prog.error || 'Unknown error.');
          }
        }
      } catch {
        // keep polling — transient RPC errors are expected
      }
    }, 2000);
  }, [stopPolling, refreshSupportState]);

  const onApplyFix = useCallback(() => {
    showModal(
      <ConfirmModal
        strTitle="Apply Fan Fix?"
        strDescription="This will temporarily disable the read-only filesystem and install kernel modules for ACPI fan control. The process takes 2–5 minutes. If SteamOS has a pending update, a device reboot may be required to activate fan control."
        strOKButtonText="Apply Fix"
        strCancelButtonText="Cancel"
        onOK={async () => {
          setPhase('fixing');
          setProgressStep('Starting…');
          setErrorMsg('');
          const serverApi = getServerApi();
          if (!serverApi) {
            setPhase('error');
            setErrorMsg('Plugin API unavailable.');
            return;
          }
          try {
            const { result } = await serverApi.callPluginMethod('apply_fan_fix', {});
            const res = result as { started: boolean; error: string };
            if (!res?.started) {
              setPhase('error');
              setErrorMsg(res?.error ?? 'Failed to start fix.');
              return;
            }
            startPolling();
          } catch (e) {
            setPhase('error');
            setErrorMsg(String(e));
          }
        }}
      />
    );
  }, [startPolling]);

  const onCheckAgain = useCallback(async () => {
    setCheckingSupport(true);
    await refreshSupportState();
    setPhase('idle');
    setProgressStep('');
    setErrorMsg('');
    setCheckingSupport(false);
  }, [refreshSupportState]);

  // On mount: resume polling if a fix was running when the panel was closed.
  useEffect(() => {
    const serverApi = getServerApi();
    if (!serverApi) return;
    serverApi.callPluginMethod('get_fan_fix_progress', {}).then(({ result }) => {
      const prog = result as FixProgressResult;
      if (prog?.running) {
        setPhase('fixing');
        setProgressStep(prog.step || 'Running…');
        startPolling();
      }
    }).catch(() => {});
    return stopPolling;
  }, [startPolling, stopPolling]);

  return { phase, progressStep, errorMsg, checkingSupport, onApplyFix, onCheckAgain };
};

// ── Kernel string ──────────────────────────────────────────────────────────────

/**
 * Fetches the current kernel string (uname -r) once on mount.
 * Used by FanSupportRepair to display context for the user during repair.
 */
export const useCurrentKernel = (): string => {
  const [kernel, setKernel] = useState('…');
  useEffect(() => {
    const serverApi = getServerApi();
    if (!serverApi) return;
    serverApi.callPluginMethod('get_current_kernel', {}).then(({ result }) => {
      if (result) setKernel(String(result));
    }).catch(() => {});
  }, []);
  return kernel;
};
