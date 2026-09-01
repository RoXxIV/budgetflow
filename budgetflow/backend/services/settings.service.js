import { get, run } from "../db/index.js";

function serialize(row) {
  return {
    currency: row.currency,
    savingRate: row.saving_rate,
    paymentMethods: JSON.parse(row.payment_methods),
    // Module Partage (optionnel)
    sharing: {
      enabled: !!row.sharing_enabled,
      partnerName: row.sharing_partner_name,
      myShare: row.sharing_my_share,
      targetLineId: row.sharing_target_line_id,
      partnerPayments: JSON.parse(row.sharing_partner_payments || "[]"),
    },
  };
}

export function getSettings() {
  return serialize(get("SELECT * FROM app_settings WHERE id = 1"));
}

export function updateSettings(data) {
  const current = get("SELECT * FROM app_settings WHERE id = 1");
  const sh = data.sharing || {};
  run(
    `UPDATE app_settings SET currency = ?, saving_rate = ?, payment_methods = ?,
       sharing_enabled = ?, sharing_partner_name = ?, sharing_my_share = ?,
       sharing_target_line_id = ?, sharing_partner_payments = ? WHERE id = 1`,
    data.currency ?? current.currency,
    data.savingRate ?? current.saving_rate,
    data.paymentMethods ? JSON.stringify(data.paymentMethods) : current.payment_methods,
    sh.enabled !== undefined ? (sh.enabled ? 1 : 0) : current.sharing_enabled,
    sh.partnerName !== undefined ? (sh.partnerName || null) : current.sharing_partner_name,
    sh.myShare !== undefined ? Number(sh.myShare) : current.sharing_my_share,
    sh.targetLineId !== undefined ? (sh.targetLineId || null) : current.sharing_target_line_id,
    sh.partnerPayments !== undefined ? JSON.stringify(sh.partnerPayments) : current.sharing_partner_payments
  );
  return getSettings();
}
