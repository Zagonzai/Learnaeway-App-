/* Learnæway front-end configuration.
 *
 * accessPasscode — the beta access gate passcode (step 1 before login).
 *   Client-side only, so treat it as a distribution key, not a secret.
 *
 * adminEmails / adminPasscode — who gets the ÆWAY admin page (the simulator's
 *   own report and the 1,000,000-player projection). Either the signed-in
 *   account's email is on the list, or the passcode is typed into the box
 *   behind a long press on the "Simulated market" tag. Both are client-side,
 *   so both are distribution keys rather than secrets — the same footing as
 *   accessPasscode above. The page shows no money and no user data.
 *
 * aeway — the ÆWAY market's data source. "recording" plays the 90-day
 *   recording in data/aeway/ against the real clock; "live" is where a
 *   Realtime Database feed goes when there is one. This one line is the switch.
 *
 * showPaidPlans — the Pro and Desk tiers on the Plan screen. Off for the ÆWAY
 *   beta: while Æway points are play points, the brief asks for no mention of
 *   subscriptions, rewards, cash or redemption anywhere in the app, and a price
 *   per month beside a points balance reads as a way to buy points. Set it true
 *   to bring the two tiers back exactly as they were.
 *
 * attemptsWebhookUrl — optional. Paste a webhook URL (e.g. a Zapier
 *   "Catch Hook" feeding a Google Sheet) and every access-gate attempt
 *   (first/last name, email, phone, timestamp, passcode result) will be
 *   POSTed to it as JSON. Leave empty to log to localStorage only.
 */
window.LEARNAEWAY_CONFIG = {
  accessPasscode: "AEWAY2026",
  adminEmails: [],
  adminPasscode: "AEWAYADMIN",
  showPaidPlans: false,
  aeway: { source: "recording" },
  attemptsWebhookUrl: "",
  firebase: {
    apiKey: "AIzaSyCFcG423QUQ6frPvl7HMJO8vYcWzPzOD8c",
    authDomain: "aeway-60d9a.firebaseapp.com",
    projectId: "aeway-60d9a",
    storageBucket: "aeway-60d9a.firebasestorage.app",
    messagingSenderId: "40107408520",
    appId: "1:40107408520:web:af7d563db1c7f8351f333d",
    measurementId: "G-ZE6RMJW4ED",
  },
};
