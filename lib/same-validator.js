/* eslint-disable linebreak-style */

/* eslint-disable array-bracket-newline */
/* eslint-disable array-element-newline */
/* eslint-disable func-style */
/* eslint-disable max-statements-per-line */
/* eslint-disable no-extra-parens */
/* eslint-disable no-magic-numbers */
/* eslint-disable no-prototype-builtins */
/* eslint-disable no-unused-expressions */
/* eslint-disable no-var */
/* eslint-disable no-warning-comments */
/* eslint-disable nonblock-statement-body-position */
/* eslint-disable operator-linebreak */
/* eslint-disable prefer-arrow-callback */
/* eslint-disable prefer-const */
/* eslint-disable prefer-template */
/* eslint-disable quotes */
/* eslint-disable radix */
/* eslint-disable require-jsdoc */
/* eslint-disable strict */

var SAMEValues = require('./fixtures/same');
var jsonQuery = require('json-query');
var xtype = require('xtypejs');

xtype.options.setNameScheme('compact');

function jq(obj, path) {
  return jsonQuery(path, { source: obj })
    .value;
}

function hasValidCountyCode(region) {
  var s = parseInt(region.stateCode, 10);
  var c = parseInt(region.countyCode, 10);

  // easy cases:
  if (s === 0 && c === 0) return true;  // 0 for both is allowed, as "whole country"
  if (s !== 0 && c === 0) return true;  // 0 for county is allowed, as "whole state"
  if (s === 0 && c !== 0) return false; // but 0 for state and nonzero county isn't

  // usual case: if the state is defined, and if the state contains
  // the given county code, it's valid
  return (typeof SAMEValues.countyCode[region.stateCode] !== 'undefined')
    && SAMEValues.countyCode[region.stateCode]
      .hasOwnProperty(region.countyCode);
}

function isValidLength(n) {
  var hr, mn;

  // hr = parseInt(n.slice(0, 2), 10);
  // mn = parseInt(n.slice(2, 4), 10);

  hr = Math.floor(n / 100);
  mn = n - (100 * hr);

  // timespec < 1 hour must be in 15-minute increment
  if (hr < 1) return (mn % 15 === 0);

  // otherwise, must be in 30-minute increment
  return mn % 30 === 0;
}

/**
 * Validate a SAME message object.
 *
 * FIXME: support multiple regions (up to 31 in the standard).
 *
 * @param {Object|null} message - Valid SAME message content to encode, or null to encode a SAME trailer (preamble + 'NNNN').
 * @param {string} message.originator - SAME message originator.
 * @param {string} message.code - SAME message type code.
 * @param {Object} message.regions - SAME message region of applicability.
 * @param {string} message.regions.stateCode - SAME message state code.
 * @param {string} message.regions.countyCode - SAME message county code.
 * @param {string} message.regions.subdiv - SAME message region subdivision code.
 * @param {string} message.length - SAME event length (delta time after start).
 * @param {Object} message.start - SAME event start time (UTC).
 * @param {string} message.start.day - SAME event start date (Julian day).
 * @param {string} message.start.hour - SAME event start hour (24-hour time).
 * @param {string} message.start.minute - SAME event start minute.
 * @param {string} message.sender - SAME event sender identifier.
 *
 * @returns {Array} An array of errors found in the passed message.
 * @description https://github.com/MobButcher/same-encoder
 */
module.exports = function (message) {
  var errors = [];
  var halt = false;

  var regionalErrors = {
    subdiv: [],
    stateCode: [],
    countyCode: []
  };

  var check = function (path, type) {
    return xtype.is(jq(message, path), type);
  };

  // early valid return if null (no further validation required)
  if (message === null) {
    return [];
  }

  //NOTE: https://github.com/aaron-em/same-encoder/issues/4
  message.sender = message.sender.padEnd(8);

  // FIXME validate uppercase too

  var validators = [
    [check('.', '-obj0'),
      'message must be a non-empty object, or null',
      true],

    [check('.originator', 'str')
      && SAMEValues.originator.hasOwnProperty(message.originator),
      'message.originator must be a defined SAME originator code'],

    [check('.code', 'str')
      && SAMEValues.code.hasOwnProperty(message.code),
      'message.code must be a defined SAME event type code'],

    [check('.regions', '-arr0'),
      'message.regions must be a non-empty array'],

    [message.regions.length <= 31, 'there must be no more than 31 regions in message.regions'],

    //NOTE: Some enhancements from https://github.com/MobButcher/same-encoder
    [message.regions.every((region) => {
      let validStateCode = (parseInt(region.stateCode) === 0
        || SAMEValues.stateCode.hasOwnProperty(region.stateCode));
      let validCountyCode = hasValidCountyCode(region);
      let validSubdivision = SAMEValues.subdiv.hasOwnProperty(region.subdiv);

      if (!validSubdivision)
        regionalErrors.subdiv.push(JSON.stringify(region));
      else if (!validStateCode)
        regionalErrors.stateCode.push(JSON.stringify(region));
      else if (!validCountyCode)
        regionalErrors.countyCode.push(JSON.stringify(region));

      return validSubdivision && validStateCode && validCountyCode;
    }),
    'invalid region data'
    + ((regionalErrors.subdiv.length > 0) ? ', wrong subdiv at region ' + regionalErrors.subdiv.join(', ') : '')
    + ((regionalErrors.stateCode.length > 0) ? ', wrong stateCode at region ' + regionalErrors.stateCode.join(', ') : '')
    + ((regionalErrors.countyCode.length > 0) ? ', wrong countyCode at region ' + regionalErrors.countyCode.join(', ') : '')],

    [check('.length', 'int')
      && isValidLength(message.length),
      'message.length must be a valid SAME event length value'],

    [check('.start', '-obj0'),
      'message.start must be a non-empty object'],

    [check('.start.day', 'num+')
      && (message.start.day > 0 && message.start.day <= 366),
      'message.start.day must be a valid Julian date (1 <= n <= 366)'],

    [check('.start.hour', 'num')
      && (message.start.hour >= 0 && message.start.hour <= 23),
      'message.start.hour must be a valid hour (0 <= n <= 23)'],

    [check('.start.minute', 'num')
      && (message.start.minute >= 0 && message.start.minute <= 59),
      'message.start.minute must be a valid minute (0 <= n <= 59)'],

    //NOTE: https://github.com/aaron-em/same-encoder/issues/3
    [check('.sender', 'str')
      && message.sender.length === 8 && ~message.sender.search(/^[A-Z0-9 /]+$/),
      'message.sender must be a valid SAME sender identifier']
  ];

  validators.forEach(function (val) {
    if (halt) return;

    if (!val[0]) {
      errors.push(val[1]);
      if (val[2]) {
        halt = true;
      }
    }
  });

  return errors;
};
