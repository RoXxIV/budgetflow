import { get, run } from "../db/index.js";

function serialize(row) {
  return {
    currency: row.currency,
    savingRate: row.saving_rate,
    paymentMethods: JSON.parse(row.payment_methods),
  };
}

export function getSettings() {
  return serialize(get("SELECT * FROM app_settings WHERE id = 1"));
}

export function updateSettings(data) {
  const current = get("SELECT * FROM app_settings WHERE id = 1");
  run(
    "UPDATE app_settings SET currency = ?, saving_rate = ?, payment_methods = ? WHERE id = 1",
    data.currency ?? current.currency,
    data.savingRate ?? current.saving_rate,
    data.paymentMethods ? JSON.stringify(data.paymentMethods) : current.payment_methods
  );
  return getSettings();
}
