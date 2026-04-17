"""
Adaptive fan watchdog: monitors CPU/GPU temperature and temporarily pins
fan speed to maximum when a configurable threshold is exceeded, then
restores the active fan curve once temps drop back down.

State machine: CURVE ↔ OVERRIDE
  CURVE → OVERRIDE: temp ≥ engage_c for engage_streak consecutive samples
  OVERRIDE → CURVE: temp < release_c for release_streak consecutive samples
"""

import glob
import os
import threading
import time

import decky_plugin


def _find_hwmon_temp(driver_name: str, preferred: tuple) -> str | None:
    for hwmon_dir in glob.glob('/sys/class/hwmon/hwmon*'):
        try:
            with open(os.path.join(hwmon_dir, 'name')) as f:
                if f.read().strip() != driver_name:
                    continue
        except OSError:
            continue
        for inp in preferred:
            path = os.path.join(hwmon_dir, inp)
            if os.path.exists(path):
                return path
    return None


def _read_temp_c(path: str) -> float | None:
    try:
        with open(path) as f:
            return int(f.read().strip()) / 1000.0
    except (OSError, ValueError):
        return None


class FanWatchdog:
    def __init__(
        self,
        legion_space,
        get_last_curve,
        get_active_profile_threshold,
        is_user_full_fan_always_on,
        default_engage_c: float = 78.0,
        default_release_c: float = 68.0,
        engage_streak: int = 3,
        release_streak: int = 10,
        poll_hz: float = 2.0,
    ):
        self._legion_space = legion_space
        self._get_last_curve = get_last_curve
        self._get_active_profile_threshold = get_active_profile_threshold
        self._is_user_full_fan_always_on = is_user_full_fan_always_on
        self._default_engage_c = default_engage_c
        self._default_release_c = default_release_c
        self._engage_streak = engage_streak
        self._release_streak = release_streak
        self._interval = 1.0 / poll_hz

        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._state = 'CURVE'
        self._engage_count = 0
        self._release_count = 0

        self._cpu_temp_path: str | None = None
        self._gpu_temp_path: str | None = None

    def start(self):
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name='FanWatchdog')
        self._thread.start()
        decky_plugin.logger.info('[FanWatchdog] started')

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        decky_plugin.logger.info('[FanWatchdog] stopped')

    def _discover_temps(self):
        self._cpu_temp_path = _find_hwmon_temp('k10temp', ('temp1_input',))
        self._gpu_temp_path = _find_hwmon_temp('amdgpu', ('temp2_input', 'temp1_input'))
        decky_plugin.logger.info(
            f'[FanWatchdog] temp paths — cpu: {self._cpu_temp_path}, gpu: {self._gpu_temp_path}'
        )

    def _read_max_temp(self) -> float | None:
        if not self._cpu_temp_path or not self._gpu_temp_path:
            self._discover_temps()

        cpu = _read_temp_c(self._cpu_temp_path) if self._cpu_temp_path else None
        gpu = _read_temp_c(self._gpu_temp_path) if self._gpu_temp_path else None

        # Force re-discover on read failure
        if cpu is None and self._cpu_temp_path:
            self._cpu_temp_path = None
        if gpu is None and self._gpu_temp_path:
            self._gpu_temp_path = None

        temps = [t for t in (cpu, gpu) if t is not None]
        return max(temps) if temps else None

    def _run(self):
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception as e:
                decky_plugin.logger.error(f'[FanWatchdog] tick error: {e}')
            self._stop_event.wait(self._interval)

    def _tick(self):
        if self._is_user_full_fan_always_on():
            self._engage_count = 0
            self._release_count = 0
            return

        threshold = self._get_active_profile_threshold()
        if threshold is not None:
            engage_c = float(threshold)
            release_c = max(60.0, engage_c - 10.0)
        else:
            engage_c = self._default_engage_c
            release_c = self._default_release_c

        temp = self._read_max_temp()
        if temp is None:
            return

        if self._state == 'CURVE':
            if temp >= engage_c:
                self._engage_count += 1
                self._release_count = 0
                if self._engage_count >= self._engage_streak:
                    decky_plugin.logger.info(
                        f'[FanWatchdog] OVERRIDE: {temp:.1f}°C >= {engage_c}°C'
                    )
                    self._state = 'OVERRIDE'
                    self._engage_count = 0
                    self._legion_space.set_full_fan_speed(True)
            else:
                self._engage_count = 0

        elif self._state == 'OVERRIDE':
            if temp < release_c:
                self._release_count += 1
                self._engage_count = 0
                if self._release_count >= self._release_streak:
                    decky_plugin.logger.info(
                        f'[FanWatchdog] CURVE: {temp:.1f}°C < {release_c}°C'
                    )
                    self._state = 'CURVE'
                    self._release_count = 0
                    self._legion_space.set_full_fan_speed(False)
                    time.sleep(0.3)
                    curve = self._get_last_curve()
                    if curve:
                        self._legion_space.set_active_fan_curve(curve)
            else:
                self._release_count = 0
