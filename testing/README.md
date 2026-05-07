# Testing the Fan Fix Flow

The fan fix flow repairs ACPI fan support when it goes missing after a SteamOS
kernel update. Because the broken state only occurs naturally after an update,
`test_fan_fix.sh` lets you simulate it on demand so you can test the full
repair cycle without waiting for one.

## Prerequisites

- Legion Go Remapper installed and working in Decky
- Fan curves responding normally (ACPI fan support active)
- `sudo` access on the device

## Typical Test Workflow

### 1. Confirm healthy baseline

```bash
./testing/test_fan_fix.sh baseline
```

Verifies that DKMS is registered, the `.ko` file is present, and the module is
loaded. Also confirms fan curves are working before you break anything.

### 2. Simulate the broken state

```bash
sudo ./testing/test_fan_fix.sh break
```

Removes the DKMS registration and the `.ko` file for the running kernel, then
restarts Decky. This is the most common real-world failure scenario (kernel
update wiped the module).

After this runs, open the Legion Go Remapper panel in Decky — the Fan Control
section should switch from the normal curve sliders to the **repair UI** with
an **Apply Fan Fix** button.

### 3. Apply the fix via the UI

In the Decky panel, click **Apply Fan Fix** and confirm the dialog. Watch the
progress steps. When it finishes, the modal will prompt you to **Restart Decky**
or **Reboot** depending on whether the module loaded live.

### 4. Verify the fix worked

```bash
./testing/test_fan_fix.sh verify-fix
```

Checks that DKMS shows the module as installed, the `.ko` file is back, and the
module is loaded in memory. After this passes, confirm fan curves are responding
again in the Decky panel.

---

## Other Break Scenarios

These test less common failure modes that the fix also handles:

| Command | What it simulates |
|---|---|
| `sudo ./testing/test_fan_fix.sh break-keyring` | Uninitialized pacman keyring (fresh install / factory reset) |
| `sudo ./testing/test_fan_fix.sh break-headers` | Missing kernel headers build path |
| `sudo ./testing/test_fan_fix.sh break-dkms-only` | DKMS registration missing but `.ko` still present |

For a complete test of `break-keyring`, run `break` first, then `break-keyring`.

---

## Emergency Restore (without the plugin)

If something goes wrong and Decky is unavailable:

```bash
sudo ./testing/test_fan_fix.sh restore
```

Runs the same steps as the plugin (keyring init, headers install, DKMS build,
modprobe) directly from the shell.

---

## Status at Any Time

```bash
./testing/test_fan_fix.sh status
```

Prints the current state of the ACPI module, DKMS registration, `.ko` file,
kernel headers, and pacman keyring without making any changes.

---

## Feature Flag

If you want to disable the fan fix UI without removing the code, set
`ENABLE_FAN_FIX = false` in [`src/featureFlags.ts`](../src/featureFlags.ts)
and rebuild.
