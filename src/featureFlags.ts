/**
 * Feature flags — set to false to disable a feature without removing its code.
 *
 * ENABLE_FAN_FIX: shows the ACPI fan support repair UI when the kernel module
 * is missing, and a "Reapply Fix" footer when it is active. Requires the
 * LegionFanFix backend (py_modules/fan_support.py + main.py fan fix methods).
 * See testing/README.md for how to test this flow end-to-end.
 */
export const ENABLE_FAN_FIX = true;
