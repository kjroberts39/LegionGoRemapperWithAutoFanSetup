"""
fan_support — DKMS/ACPI fan-fix backend.

Shared between LegionFanFix and LegionGoRemapper (consumed via git submodule
in LGR). Fixes belong here first; LGR bumps its submodule pin to pick them up.

Uses decky_plugin.logger (available in both plugins' execution context).
Returns plain Python types; plugin.py wraps them in _ok/_err envelopes as needed.
"""

import os
import subprocess
import threading

import decky_plugin

# ── Progress state ─────────────────────────────────────────────────────────────

_progress_lock = threading.Lock()
_progress_state: dict = {
    "step":            "",     # human-readable current step
    "running":         False,  # True while worker thread is active
    "done":            False,  # True once finished (success or error)
    "success":         None,   # True | False | None
    "error":           "",     # error message when success is False
    "reboot_required": False,  # True when modprobe failed (module needs reboot to load)
}


# ── Internal helpers ───────────────────────────────────────────────────────────

def _run(cmd: list, timeout: int = 60) -> tuple:
    """
    Run a subprocess, returning (returncode, stdout, stderr).
    Never raises — all exceptions surface as rc=-1.
    Strips Homebrew library paths so system binaries don't pick up the wrong libs.
    """
    decky_plugin.logger.debug("fan_support: run %s", " ".join(cmd))
    try:
        env = os.environ.copy()
        for var in ("LD_LIBRARY_PATH", "LD_PRELOAD", "DYLD_LIBRARY_PATH"):
            env.pop(var, None)
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        decky_plugin.logger.debug(
            "fan_support: rc=%d stdout=%r", result.returncode, result.stdout[:200]
        )
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        msg = f"Command timed out after {timeout}s: {' '.join(cmd)}"
        decky_plugin.logger.error("fan_support: %s", msg)
        return -1, "", msg
    except Exception as exc:
        decky_plugin.logger.error("fan_support: unexpected error running %s: %s", cmd, exc)
        return -1, "", str(exc)


def _set_progress(step: str) -> None:
    with _progress_lock:
        _progress_state["step"] = step
    decky_plugin.logger.info("fan_support: %s", step)


def _get_current_kernel() -> str:
    """Return raw `uname -r` output, e.g. '6.11.11-valve24'."""
    rc, stdout, _ = _run(["uname", "-r"])
    return stdout if rc == 0 else ""


def _is_kernel_supported(kernel: str):
    """
    Check whether acpi_call DKMS is built and active for the given kernel string.

    Returns:
        True  — acpi_call is installed for this kernel
        False — acpi_call entry absent or not built (fix is needed)
        None  — could not determine (dkms not installed, parse error, etc.)
    """
    if not kernel:
        return None

    rc, stdout, _ = _run(["dkms", "status"])
    if rc != 0:
        # dkms not installed or never set up — fix is needed either way
        return False

    # dkms status lines look like:
    #   acpi_call/1.2.2, 6.11.11-valve24, x86_64: installed
    for line in stdout.splitlines():
        if "acpi_call" in line and kernel in line:
            return "installed" in line.lower()

    return False  # acpi_call entry not found for this kernel


# ── Background worker ──────────────────────────────────────────────────────────

def _apply_fan_fix_worker() -> None:
    """
    7-step DKMS repair sequence that runs in a daemon thread.
    Frontend polls get_fan_fix_progress() while this runs.
    """
    with _progress_lock:
        _progress_state.update({"running": True, "done": False, "success": None, "error": ""})

    try:
        kernel = _get_current_kernel()
        if not kernel:
            raise RuntimeError("Could not determine current kernel version.")

        # ── Step 1: Disable read-only filesystem ──────────────────────────────
        _set_progress("Disabling read-only filesystem\u2026")
        rc, _, stderr = _run(["steamos-readonly", "disable"], timeout=30)
        if rc != 0:
            raise RuntimeError(f"steamos-readonly disable failed: {stderr}")

        # ── Step 2: Initialize pacman keyring (if not already done) ──────────
        # On SteamOS the pacman keyring is sometimes absent or non-writable,
        # causing all subsequent pacman installs to fail with
        # "Public keyring not found" / "keyring is not writable".
        # Run pacman-key init+populate as a best-effort guard; failures are
        # logged as warnings rather than aborting the sequence, because the
        # keyring may already be initialised and the commands become no-ops.
        _set_progress("Initializing pacman keyring\u2026")
        rc_ki, _, stderr_ki = _run(["pacman-key", "--init"], timeout=120)
        if rc_ki != 0:
            decky_plugin.logger.warning(
                "fan_support: pacman-key --init returned %d: %s", rc_ki, stderr_ki
            )
        # Populate both the standard Arch keyring and Valve's Holo (SteamOS)
        # keyring so that SteamOS packages signed by ci-package-builder-1@steamos.cloud
        # are trusted.
        rc_kp, _, stderr_kp = _run(
            ["pacman-key", "--populate", "archlinux", "holo"], timeout=60
        )
        if rc_kp != 0:
            decky_plugin.logger.warning(
                "fan_support: pacman-key --populate returned %d: %s", rc_kp, stderr_kp
            )

        # ── Step 3: Install kernel headers ────────────────────────────────────
        # Valve publishes per-series headers packages: linux-neptune-611-headers
        # for 6.11.x, linux-neptune-68-headers for 6.8.x, etc.
        # Derive the series suffix from the running kernel's major.minor and try
        # that package first before falling back to the legacy linux-neptune-headers
        # (which is stuck at 5.13 and never matches modern SteamOS kernels).
        _set_progress(f"Installing kernel headers for {kernel}\u2026")
        try:
            parts = kernel.split(".")
            series = parts[0] + parts[1]   # "6" + "11" → "611"
            versioned_pkg = f"linux-neptune-{series}-headers"
        except (IndexError, ValueError):
            versioned_pkg = None

        rc = 1
        if versioned_pkg:
            rc, _, stderr = _run(
                ["pacman", "-S", "--noconfirm", versioned_pkg],
                timeout=180,
            )
        if rc != 0:
            _set_progress("Trying generic linux-neptune-headers\u2026")
            rc, _, stderr = _run(
                ["pacman", "-S", "--noconfirm", "linux-neptune-headers"],
                timeout=180,
            )
        if rc != 0:
            raise RuntimeError(f"Kernel headers install failed: {stderr}")

        # ── Step 4: Install DKMS + acpi_call-dkms ─────────────────────────────
        _set_progress("Installing dkms and acpi_call-dkms\u2026")
        rc, _, stderr = _run(
            ["pacman", "-S", "--noconfirm", "dkms", "acpi_call-dkms"],
            timeout=180,
        )
        if rc != 0:
            raise RuntimeError(f"DKMS package install failed: {stderr}")

        # ── Step 5: Build the DKMS module if pacman hooks didn't do it ────────
        # pacman's post-install hook usually builds the module automatically.
        # Only run dkms install manually if it didn't (e.g. kernel mismatch).
        if not _is_kernel_supported(kernel):
            _set_progress(f"Building acpi_call module for {kernel}\u2026")
            rc_v, ver_out, _ = _run(["pacman", "-Q", "acpi_call-dkms"], timeout=10)
            if rc_v != 0 or not ver_out:
                raise RuntimeError("Could not determine acpi_call-dkms version from pacman.")
            # "acpi_call-dkms 1.2.2-2" → "1.2.2"
            acpi_version = ver_out.split()[1].split("-")[0]

            build_path = f"/usr/lib/modules/{kernel}/build"
            if not os.path.exists(build_path):
                # Headers were installed for a different kernel version.
                # This happens when SteamOS has a pending update — the new
                # kernel's headers are installed but the old kernel is still
                # running.  Building against mismatched headers causes a
                # compilation failure, so skip the build and ask the user to
                # reboot.  The packages are installed; DKMS will build the
                # module correctly after rebooting into the new kernel.
                _set_progress("Fan support installed \u2014 reboot required to activate.")
                decky_plugin.logger.warning(
                    "fan_support: headers mismatch for %s; marking reboot required", kernel
                )
                _run(["steamos-readonly", "enable"], timeout=30)
                with _progress_lock:
                    _progress_state.update({
                        "running": False, "done": True, "success": True,
                        "reboot_required": True,
                    })
                return

            rc, _, stderr = _run(
                ["dkms", "install", f"acpi_call/{acpi_version}", "-k", kernel],
                timeout=300,
            )
            if rc != 0:
                raise RuntimeError(f"dkms install failed: {stderr}")
        else:
            _set_progress("DKMS module already built by package install.")

        # ── Step 6: Re-enable read-only filesystem ────────────────────────────
        _set_progress("Re-enabling read-only filesystem\u2026")
        _run(["steamos-readonly", "enable"], timeout=30)
        # Non-fatal if this fails — keep going.

        # ── Step 7: Load the module immediately (no reboot required) ──────────
        _set_progress("Loading acpi_call kernel module\u2026")
        rc_mp, _, _ = _run(["/usr/bin/modprobe", "acpi_call"], timeout=10)
        reboot_required = rc_mp != 0
        if reboot_required:
            decky_plugin.logger.warning(
                "fan_support: modprobe acpi_call failed (rc=%d); reboot required to activate",
                rc_mp,
            )

        # ── Done ──────────────────────────────────────────────────────────────
        _set_progress("Fan support installed successfully.")
        with _progress_lock:
            _progress_state.update({
                "running": False, "done": True, "success": True,
                "reboot_required": reboot_required,
            })

    except Exception as exc:
        decky_plugin.logger.error("fan_support: worker failed: %s", exc)
        # Best-effort: restore read-only fs even on failure.
        _run(["steamos-readonly", "enable"], timeout=30)
        _set_progress(f"Error: {exc}")
        with _progress_lock:
            _progress_state.update({
                "running": False,
                "done":    True,
                "success": False,
                "error":   str(exc),
            })


# ── Public API ─────────────────────────────────────────────────────────────────

def get_fan_support_status() -> str:
    """
    Returns 'ok', 'missing', or 'unknown'.
    'ok'      — acpi_call is built and active for the current kernel
    'missing' — acpi_call is absent or not built; fix is needed
    'unknown' — could not determine (kernel unreadable, dkms error, etc.)
    """
    try:
        kernel = _get_current_kernel()
        if not kernel:
            return "unknown"
        supported = _is_kernel_supported(kernel)
        if supported is True:
            return "ok"
        if supported is False:
            return "missing"
        return "unknown"
    except Exception as exc:
        decky_plugin.logger.error("fan_support: get_fan_support_status error: %s", exc)
        return "unknown"


def apply_fan_fix() -> dict:
    """
    Kicks off the repair sequence in a daemon thread.
    Returns {"started": True} or {"started": False, "error": "<reason>"}.
    Frontend should immediately start polling get_fan_fix_progress().
    """
    with _progress_lock:
        if _progress_state["running"]:
            return {"started": False, "error": "A fix is already in progress."}
    thread = threading.Thread(target=_apply_fan_fix_worker, daemon=True)
    thread.start()
    return {"started": True, "error": ""}


def get_fan_fix_progress() -> dict:
    """
    Returns a snapshot of the current fix progress state.
    Frontend polls this every 2 s while running is True.
    """
    with _progress_lock:
        return dict(_progress_state)


def get_current_kernel() -> str:
    """Returns raw `uname -r` output for display in the UI."""
    return _get_current_kernel() or "unknown"


def reboot_device() -> bool:
    """Reboots the device immediately via systemctl reboot."""
    rc, _, stderr = _run(["/usr/bin/systemctl", "reboot"], timeout=10)
    if rc not in (0, 1):
        decky_plugin.logger.error("fan_support: reboot_device failed: %s", stderr)
        return False
    return True


def restart_decky() -> bool:
    """
    Kills the PluginLoader process so systemd restarts it, reloading all
    plugins immediately.  pkill exit code 1 means no process matched, which
    is treated as success (already restarting).
    """
    rc, _, stderr = _run(["/usr/bin/pkill", "-f", "PluginLoader"], timeout=5)
    if rc not in (0, 1):
        decky_plugin.logger.error("fan_support: restart_decky failed: %s", stderr)
        return False
    return True
