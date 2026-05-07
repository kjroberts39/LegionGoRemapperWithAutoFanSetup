#!/usr/bin/env bash
# test_fan_fix.sh — Repeatable end-to-end test for LegionFanFix
#
# Usage:
#   ./test_fan_fix.sh baseline          # Phase 1 — confirm fan control is working
#   ./test_fan_fix.sh break             # Phase 2 — simulate broken state (requires sudo)
#   ./test_fan_fix.sh break-keyring     # Phase 2b — simulate uninitialized pacman keyring (requires sudo)
#   ./test_fan_fix.sh break-headers     # Phase 2c — simulate missing kernel headers (requires sudo)
#   ./test_fan_fix.sh break-dkms-only   # Phase 2d — remove DKMS registration but keep .ko (requires sudo)
#   ./test_fan_fix.sh verify-fix        # Phase 3 — confirm plugin fixed it
#   ./test_fan_fix.sh restore           # Emergency: manually restore without the plugin (requires sudo)
#   ./test_fan_fix.sh status            # Print raw diagnostic state at any time

set -eo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $*${RESET}"; }
fail() { echo -e "${RED}  ✗ $*${RESET}"; }
info() { echo -e "${CYAN}  → $*${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${RESET}"; }
hdr()  { echo -e "\n${BOLD}$*${RESET}"; printf '%.0s─' $(seq 1 ${#1}); echo; }

# ─── Helpers ──────────────────────────────────────────────────────────────────

acpi_loaded()    { [ -d /sys/module/acpi_call ]; }

dkms_installed() {
    local kernel; kernel=$(uname -r)
    command -v dkms &>/dev/null && dkms status 2>/dev/null | grep -q "acpi_call.*${kernel}.*installed"
}

ko_present() {
    local kernel; kernel=$(uname -r)
    [[ $(find "/lib/modules/${kernel}" -name "acpi_call.ko*" 2>/dev/null | wc -l) -gt 0 ]]
}

headers_present() {
    local kernel; kernel=$(uname -r)
    [[ -d "/usr/lib/modules/${kernel}/build" ]]
}

keyring_ok() {
    [[ -f /etc/pacman.d/gnupg/pubring.gpg ]] || [[ -f /etc/pacman.d/gnupg/trustdb.gpg ]]
}

# Derive the Valve series-specific headers package name from the running kernel.
# e.g. 6.11.11-valve27-1-neptune-... → linux-neptune-611-headers
neptune_headers_pkg() {
    local kernel; kernel=$(uname -r)
    local major minor
    major=$(echo "$kernel" | cut -d. -f1)
    minor=$(echo "$kernel" | cut -d. -f2)
    echo "linux-neptune-${major}${minor}-headers"
}

require_sudo() {
    if [[ $EUID -ne 0 ]]; then
        fail "This phase requires sudo. Re-run with: sudo $0 $1"
        exit 1
    fi
}

print_status() {
    hdr "Current State"
    local kernel; kernel=$(uname -r)
    info "Kernel: ${kernel}"
    info "Expected headers pkg: $(neptune_headers_pkg)"
    echo ""

    if acpi_loaded; then
        ok "acpi_call module is LOADED in memory"
    else
        fail "acpi_call module is NOT loaded"
    fi

    if dkms_installed; then
        ok "DKMS shows acpi_call as installed for ${kernel}"
    else
        fail "DKMS does NOT show acpi_call as installed for ${kernel}"
    fi

    if ko_present; then
        ok ".ko file present in /lib/modules/${kernel}"
    else
        fail ".ko file absent from /lib/modules/${kernel}"
    fi

    if headers_present; then
        ok "Kernel headers build path present for ${kernel}"
    else
        warn "Kernel headers build path absent for ${kernel}"
    fi

    if keyring_ok; then
        ok "pacman keyring appears initialized"
    else
        warn "pacman keyring may not be initialized (/etc/pacman.d/gnupg/)"
    fi

    echo ""
    info "dkms status:"
    command -v dkms &>/dev/null && dkms status 2>/dev/null || echo "    (dkms not available or no entries)"
}

# ─── Phases ───────────────────────────────────────────────────────────────────

phase_baseline() {
    hdr "Phase 1 — Baseline"
    print_status

    if acpi_loaded && dkms_installed; then
        echo ""
        ok "System is healthy — fan control should be working."
        warn "ACTION: Confirm fan curves respond in Legion Go Remapper."
        warn "        When confirmed, choose a break phase:"
        warn "          sudo ./test_fan_fix.sh break             (standard)"
        warn "          sudo ./test_fan_fix.sh break-keyring     (keyring scenario)"
        warn "          sudo ./test_fan_fix.sh break-headers     (missing headers scenario)"
        warn "          sudo ./test_fan_fix.sh break-dkms-only   (DKMS-only scenario)"
    else
        echo ""
        fail "System is not in a healthy baseline state."
        warn "Run the LegionFanFix plugin first, or: sudo ./test_fan_fix.sh restore"
        exit 1
    fi
}

phase_break() {
    require_sudo "break"
    hdr "Phase 2 — Simulate Broken State (DKMS + .ko removed)"

    local kernel; kernel=$(uname -r)

    if command -v dkms &>/dev/null; then
        local ver
        ver=$(dkms status 2>/dev/null | grep -i acpi_call | head -1 | sed 's/acpi_call\/\([^,]*\).*/\1/' || true)
        if [[ -n "$ver" ]]; then
            info "Removing DKMS registration (acpi_call/${ver})…"
            dkms remove "acpi_call/${ver}" --all 2>/dev/null || true
            ok "DKMS registration removed."
        else
            warn "No acpi_call entry in dkms status — skipping dkms remove."
        fi
    else
        warn "dkms not found — skipping dkms remove."
    fi

    info "Disabling read-only filesystem to remove module file…"
    steamos-readonly disable

    info "Removing built module file from current kernel…"
    if ko_present; then
        find "/lib/modules/${kernel}" -name "acpi_call.ko*" -delete
        depmod -a
        ok "Module file(s) removed and module database updated."
    else
        warn "No acpi_call.ko found — may already be gone."
    fi

    info "Re-enabling read-only filesystem…"
    steamos-readonly enable

    echo ""
    print_status
    echo ""

    if ! dkms_installed && ! ko_present; then
        ok "Broken state confirmed — DKMS unregistered and .ko file gone."
        _restart_decky_and_prompt "break"
    else
        fail "Something is still active — check the state above."
        exit 1
    fi
}

# Phase 2b: simulate uninitialized pacman keyring.
# This reproduces the "Public keyring not found / keyring is not writable"
# error that occurs when pacman-key has never been run (e.g. fresh SteamOS
# install or after a factory reset).
phase_break_keyring() {
    require_sudo "break-keyring"
    hdr "Phase 2b — Simulate Uninitialized pacman Keyring"

    info "Disabling read-only filesystem…"
    steamos-readonly disable

    if [[ -d /etc/pacman.d/gnupg ]]; then
        info "Backing up existing keyring to /etc/pacman.d/gnupg.bak…"
        rm -rf /etc/pacman.d/gnupg.bak
        cp -a /etc/pacman.d/gnupg /etc/pacman.d/gnupg.bak
        info "Removing keyring contents…"
        rm -rf /etc/pacman.d/gnupg
        ok "Keyring removed. (backup at /etc/pacman.d/gnupg.bak)"
    else
        warn "Keyring directory not found — already in broken state."
    fi

    info "Re-enabling read-only filesystem…"
    steamos-readonly enable

    echo ""
    print_status
    echo ""
    ok "Keyring broken state set."
    warn "NOTE: The fan .ko is still present/loaded — this only tests whether"
    warn "      the fix can reinstall packages when the keyring is absent."
    warn "      For a full test, run 'sudo ./test_fan_fix.sh break' first,"
    warn "      then 'sudo ./test_fan_fix.sh break-keyring'."
    echo ""
    warn "ACTION: Apply the fix via LegionFanFix in Decky, then:"
    warn "        ./test_fan_fix.sh verify-fix"
    echo ""
    warn "To restore the keyring manually without the plugin:"
    warn "  sudo steamos-readonly disable"
    warn "  sudo cp -a /etc/pacman.d/gnupg.bak /etc/pacman.d/gnupg"
    warn "  sudo steamos-readonly enable"
}

# Phase 2c: simulate missing kernel headers (the build path is absent).
# This reproduces the DKMS "cannot be found at .../build" error that occurs
# when linux-neptune-{series}-headers has never been installed, or after a
# SteamOS update before the matching headers package existed.
phase_break_headers() {
    require_sudo "break-headers"
    hdr "Phase 2c — Simulate Missing Kernel Headers"

    local kernel; kernel=$(uname -r)
    local build_path="/usr/lib/modules/${kernel}/build"
    local source_path="/usr/lib/modules/${kernel}/source"

    if ! headers_present; then
        warn "Headers build path already absent for ${kernel} — already broken."
        print_status
        exit 0
    fi

    info "Disabling read-only filesystem…"
    steamos-readonly disable

    if [[ -L "$build_path" || -d "$build_path" ]]; then
        info "Backing up build path…"
        mv "$build_path" "${build_path}.bak"
        ok "Moved ${build_path} → ${build_path}.bak"
    fi
    if [[ -L "$source_path" || -d "$source_path" ]]; then
        mv "$source_path" "${source_path}.bak"
        ok "Moved ${source_path} → ${source_path}.bak"
    fi

    info "Re-enabling read-only filesystem…"
    steamos-readonly enable

    echo ""
    print_status
    echo ""
    ok "Headers broken state set — build path removed for ${kernel}."
    warn "ACTION: Apply the fix via LegionFanFix in Decky, then:"
    warn "        ./test_fan_fix.sh verify-fix"
    echo ""
    warn "To restore headers manually:"
    warn "  sudo steamos-readonly disable"
    warn "  sudo mv ${build_path}.bak ${build_path}"
    warn "  sudo steamos-readonly enable"
}

# Phase 2d: remove only the DKMS registration, leaving the .ko in place.
# Tests whether the fix handles the case where DKMS thinks the module is
# not installed but the .ko file still exists (e.g. after dkms database
# corruption or a pacman upgrade that wiped DKMS entries).
phase_break_dkms_only() {
    require_sudo "break-dkms-only"
    hdr "Phase 2d — Simulate Missing DKMS Registration (keep .ko)"

    if ! command -v dkms &>/dev/null; then
        fail "dkms not installed — cannot simulate this scenario."
        exit 1
    fi

    local ver
    ver=$(dkms status 2>/dev/null | grep -i acpi_call | head -1 | sed 's/acpi_call\/\([^,]*\).*/\1/' || true)
    if [[ -z "$ver" ]]; then
        warn "No acpi_call DKMS entry found — already in target state."
        print_status
        exit 0
    fi

    info "Removing DKMS registration for acpi_call/${ver} (keeping .ko)…"
    # dkms remove without --all only removes the registration for this kernel.
    dkms remove "acpi_call/${ver}" --all 2>/dev/null || true
    ok "DKMS registration removed."

    echo ""
    print_status
    echo ""
    if ! dkms_installed; then
        ok "DKMS-only broken state confirmed — registration gone, .ko may still be present."
        _restart_decky_and_prompt "break-dkms-only"
    else
        fail "DKMS entry still present — check output above."
        exit 1
    fi
}

_restart_decky_and_prompt() {
    local phase="$1"
    info "Restarting Decky to load latest plugin build…"
    pkill -f "PluginLoader" 2>/dev/null || true
    sleep 3
    ok "Decky restarted."
    echo ""
    warn "ACTION: Apply the fix using LegionFanFix in the Decky menu."
    warn "        When the modal appears, choose 'Restart Decky', then:"
    warn "        ./test_fan_fix.sh verify-fix"
}

phase_verify_fix() {
    hdr "Phase 3 — Verify Fix Applied"
    print_status

    local pass=true
    echo ""

    if dkms_installed; then
        ok "DKMS shows acpi_call as installed for $(uname -r)"
    else
        fail "DKMS does NOT show acpi_call installed — fix may have failed."
        pass=false
    fi

    if ko_present; then
        ok ".ko file is present for $(uname -r)"
    else
        fail ".ko file is missing — fix may have failed."
        pass=false
    fi

    if acpi_loaded; then
        ok "acpi_call module is loaded in memory."
    else
        fail "acpi_call module is NOT loaded."
        warn "Try manually: sudo /usr/bin/modprobe acpi_call"
        pass=false
    fi

    if headers_present; then
        ok "Kernel headers build path present."
    else
        warn "Kernel headers build path absent — future DKMS rebuilds may fail."
    fi

    echo ""
    if $pass; then
        ok "All checks passed."
        warn "ACTION: Confirm fan curves respond in Legion Go Remapper."
    else
        fail "One or more checks failed — review output above."
        exit 1
    fi
}

phase_restore() {
    require_sudo "restore"
    hdr "Emergency Restore (without the plugin)"
    warn "Runs the same steps as the plugin — use if Decky is unavailable."

    local kernel; kernel=$(uname -r)

    info "Disabling read-only filesystem…"
    steamos-readonly disable

    info "Initializing pacman keyring…"
    pacman-key --init || warn "pacman-key --init failed (may already be initialized)"
    pacman-key --populate archlinux holo || warn "pacman-key --populate failed"

    # Derive the series-specific headers package (e.g. linux-neptune-611-headers).
    local major minor series headers_pkg
    major=$(echo "$kernel" | cut -d. -f1)
    minor=$(echo "$kernel" | cut -d. -f2)
    series="${major}${minor}"
    headers_pkg="linux-neptune-${series}-headers"

    info "Installing kernel headers (${headers_pkg}) and DKMS packages…"
    if ! pacman -S --noconfirm "$headers_pkg" dkms acpi_call-dkms; then
        warn "Series-specific headers failed; falling back to linux-neptune-headers…"
        pacman -S --noconfirm linux-neptune-headers dkms acpi_call-dkms
    fi

    if ! dkms_installed; then
        local ver
        ver=$(pacman -Q acpi_call-dkms | awk '{print $2}' | cut -d- -f1)
        info "Building acpi_call/${ver} for ${kernel}…"
        local build_path="/usr/lib/modules/${kernel}/build"
        if [[ ! -d "$build_path" ]]; then
            fail "Headers build path still absent after install — cannot build module."
            warn "If SteamOS has a pending update, reboot first then re-run this script."
            steamos-readonly enable
            exit 1
        fi
        dkms install "acpi_call/${ver}" -k "${kernel}"
    fi

    info "Re-enabling read-only filesystem…"
    steamos-readonly enable

    info "Loading module…"
    /usr/bin/modprobe acpi_call

    echo ""
    print_status
    ok "Restore complete."
}

# ─── Dispatch ─────────────────────────────────────────────────────────────────

PHASE="${1:-status}"

case "$PHASE" in
    baseline)         phase_baseline ;;
    break)            phase_break ;;
    break-keyring)    phase_break_keyring ;;
    break-headers)    phase_break_headers ;;
    break-dkms-only)  phase_break_dkms_only ;;
    verify-fix)       phase_verify_fix ;;
    restore)          phase_restore ;;
    status)           print_status ;;
    *)
        echo "Usage: $0 {baseline|break|break-keyring|break-headers|break-dkms-only|verify-fix|restore|status}"
        echo ""
        echo "  baseline          Phase 1: confirm healthy starting state"
        echo "  break             Phase 2: remove DKMS + .ko (requires sudo)"
        echo "  break-keyring     Phase 2b: corrupt pacman keyring (requires sudo)"
        echo "  break-headers     Phase 2c: remove kernel headers build path (requires sudo)"
        echo "  break-dkms-only   Phase 2d: remove DKMS registration, keep .ko (requires sudo)"
        echo "  verify-fix        Phase 3: confirm plugin fix worked"
        echo "  restore           Emergency manual restore (requires sudo)"
        echo "  status            Print current acpi_call / DKMS / headers / keyring state"
        exit 1
        ;;
esac
