import { ModalRoot } from 'decky-frontend-lib';
import { useState, VFC } from 'react';
import { FaFan } from 'react-icons/fa';
import { getServerApi } from '../../backend/utils';

interface FanRestartModalProps {
  closeModal?: () => void;
  rebootRequired?: boolean;
}

/**
 * Shown after a successful fan-fix.
 * When rebootRequired is false (modprobe loaded the module live), offers an
 * immediate Decky restart — buttons are replaced by a spinning fan while
 * the process is killed.
 * When rebootRequired is true (modprobe failed, e.g. mismatched kernel headers
 * from a pending SteamOS update), tells the user to reboot instead; a Decky
 * restart alone won't help because the module isn't loaded yet.
 */
const FanRestartModal: VFC<FanRestartModalProps> = ({ closeModal, rebootRequired = false }) => {
  const [restarting, setRestarting] = useState(false);

  return (
    <ModalRoot closeModal={closeModal}>
      <style>{`
        @keyframes lgrRestartSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
      <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '12px', color: '#fff' }}>
        {rebootRequired ? 'Reboot Required' : 'Restart Decky?'}
      </div>
      <div style={{ fontSize: '13px', color: '#a09070', lineHeight: 1.6, marginBottom: '24px' }}>
        {rebootRequired
          ? 'Fan support has been installed. The kernel module could not be loaded immediately — this usually means SteamOS has a pending update. Reboot your device to activate fan controls.'
          : 'Fan support has been restored. Restart Decky to activate fan controls in LegionGoRemapper immediately, or reboot your device at any time.'}
      </div>

      {rebootRequired ? restarting ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '10px', padding: '10px 0',
        }}>
          <FaFan style={{
            color: '#c8a84b', fontSize: '18px',
            animation: 'lgrRestartSpin 1.5s linear infinite',
          }} />
          <span style={{
            color: '#c8a84b', fontSize: '13px', fontWeight: 600, letterSpacing: '0.05em',
          }}>
            Rebooting…
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => closeModal?.()}
            style={{
              padding: '8px 18px', cursor: 'pointer', fontSize: '13px',
              background: 'rgba(255,255,255,0.08)', color: '#aaa',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
            }}
          >
            Later
          </button>
          <button
            onClick={() => {
              setRestarting(true);
              setTimeout(() => getServerApi()?.callPluginMethod('reboot_device', {}), 300);
            }}
            style={{
              padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              background: 'rgba(200,168,75,0.25)', color: '#c8a84b',
              border: '1px solid rgba(200,168,75,0.5)', borderRadius: '4px',
            }}
          >
            Reboot Now
          </button>
        </div>
      ) : restarting ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '10px', padding: '10px 0',
        }}>
          <FaFan style={{
            color: '#c8a84b', fontSize: '18px',
            animation: 'lgrRestartSpin 1.5s linear infinite',
          }} />
          <span style={{
            color: '#c8a84b', fontSize: '13px', fontWeight: 600, letterSpacing: '0.05em',
          }}>
            Restarting Decky…
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => closeModal?.()}
            style={{
              padding: '8px 18px', cursor: 'pointer', fontSize: '13px',
              background: 'rgba(255,255,255,0.08)', color: '#aaa',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
            }}
          >
            Later
          </button>
          <button
            onClick={() => {
              setRestarting(true);
              setTimeout(() => getServerApi()?.callPluginMethod('restart_decky', {}), 300);
            }}
            style={{
              padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              background: 'rgba(200,168,75,0.25)', color: '#c8a84b',
              border: '1px solid rgba(200,168,75,0.5)', borderRadius: '4px',
            }}
          >
            Restart Decky
          </button>
        </div>
      )}
    </ModalRoot>
  );
};

export default FanRestartModal;
