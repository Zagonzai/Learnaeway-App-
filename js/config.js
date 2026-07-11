/* Learnæway front-end configuration.
 *
 * accessPasscode — the beta access gate passcode (step 1 before login).
 *   Client-side only, so treat it as a distribution key, not a secret.
 *
 * attemptsWebhookUrl — optional. Paste a webhook URL (e.g. a Zapier
 *   "Catch Hook" feeding a Google Sheet) and every access-gate attempt
 *   (first/last name, email, phone, timestamp, passcode result) will be
 *   POSTed to it as JSON. Leave empty to log to localStorage only.
 */
window.LEARNAEWAY_CONFIG = {
  accessPasscode: "AEWAY2026",
  attemptsWebhookUrl: "",
};
