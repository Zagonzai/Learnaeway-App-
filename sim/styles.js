/* The four play styles moved up to js/pw-styles.js, beside the rules.
 *
 * They started here, because the simulator was the only thing that needed more
 * than one opponent. The app needs them now too — a match against the computer
 * has an Easy and a Hard, and those are two of these — so they live with the
 * rules for the same reason the rules do: one copy, two readers.
 *
 * This file stays so that nothing in sim/ had to change its import.
 */
"use strict";

module.exports = require("../js/pw-styles.js");
