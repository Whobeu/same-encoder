/* eslint-disable linebreak-style */

/* eslint no-bitwise: ["error", { "allow": ["&"] }] */
/* eslint-disable array-element-newline */
/* eslint-disable no-magic-numbers */
/* eslint-disable no-param-reassign */
/* eslint-disable no-plusplus */
/* eslint-disable no-useless-call */
/* eslint-disable prefer-spread */

"use strict";

const Wav = require("./wav");
const SAMEValidator = require("./same-validator");
const SAME = {};

const PREAMBLE = "\xab\xab\xab\xab\xab\xab\xab\xab\xab\xab\xab\xab\xab\xab\xab\xab";

// A collection of constants for use by the SAME encoder.
SAME.constants = {
  header: `${PREAMBLE}ZCZC`,
  EOM: `${PREAMBLE}NNNN`,
  bits: {
    // frequency, length
    mark: [2083.333, 0.00192],
    space: [1562.5, 0.00192]
  },
  silence1s: [0, 1.0],
  attentionNWS: [1050, 10.0],  // 1050Hz is played for 10 seconds
  attentionEAS: [[853, 960], 10.0]  // 853Hz and 960HZ dual tone played for 10 seconds
};

SAME.validateMessage = SAMEValidator;

/**
 * Left-pad a string with zeroes to the given length.
 * Can be replaced with string.padStart as of Node.js 8.
 *
 * @param {number} str - The string to pad.
 * @param {number} len - The overall length of the resulting string.
 * @returns {string} The string, padded.
 */
function zeropad(str, len) {
  if (str.length >= len) {
    return str;
  }

  while (str.length < len) {
    str = `0${str}`;
  }
  return str;
}

/**
 * @param {Array<Object>} regions an array of region objects
 * @returns {string} a string containing region FIPS codes separated with minus "-" signs.
 */
function getRegions(regions) {
  const regionList = [];
  Object.values(regions).forEach(({ subdiv, stateCode, countyCode }) => {
    //NOTE: Use this code if returning a byte array. It will be split by the code below.
    // regions.push(`${zeropad(subdiv.toString(), 1)},${zeropad(stateCode.toString(), 2)},${zeropad(countyCode.toString(), 3)}`);
    regionList.push(`${zeropad(subdiv.toString(), 1)}${zeropad(stateCode.toString(), 2)}${zeropad(countyCode.toString(), 3)}`);
  });

  return regionList.join("-");
  //NOTE: Use this code if returning a byte array. If a byte array is desired,
  // a spread (...) must be used in constructMessageByteArray.
  // return regionList.join(",-,").split(",");
}

/**
 * Convert a SAME message object into an array of numeric ASCII
 * code points.
 *
 * NOTE: This function relies on the JS runtime using a default string
 * encoding of ASCII or UTF8. If it doesn't, the SAME messages
 * generated will be invalid.
 *
 * NOTE: This function expects to receive a valid SAME object. If it
 * doesn't, all sorts of fun things can happen, up to and including
 * uncaught exceptions.
 *
 * @param {Object} message - A SAME message object.
 * @returns {Array<Number>} An array of ASCII code points.
 */
SAME.constructMessageByteArray = function (message) {
  let msgContent = [];

  if (message !== null) {
    // message header
    msgContent = [
      this.constants.header,
      "-",
      message.originator,
      "-",
      message.code,
      "-",
      getRegions(message.regions),  //NOTE: Make this a spread (...) if a byte array being returned.
      "+",
      zeropad(message.length.toString(), 4),
      "-",
      zeropad(message.start.day.toString(), 3),
      zeropad(message.start.hour.toString(), 2),
      zeropad(message.start.minute.toString(), 2),
      "-",
      message.sender,
      "-"
    ];
  } else {
    // message footer
    msgContent = [this.constants.EOM];
  }

  return {
    msgBytes: msgContent
      .join("")
      .split("")
      .map((c) => {
        return c.charCodeAt(0);
      }),
    header: msgContent.join("")
  };
};

/**
 * Convert a SAME message byte array to a RIFF WAVE stream.
 *
 * @param {Array} byteArray - An array of ASCII code points suitable for conversion.
 * @param {number} headerCount number of times to repeat SAME header audio (valid: 1, 2, 3, default: 3)
 * @param {Array<number>} attentionTone frequency and length definition for attention tone to play. Undefined for no tone.
 * @param {boolean} tail append the message tail "NNNN" (EOM) to the end (default: false)
 * @returns {String} The message encoded as RIFF WAVE data.
 */
SAME.generateWaveData = function (byteArray, headerCount, attentionTone = undefined, tail = false) {
  const volume = 4096;
  const wav = new Wav({
    channels: 2,
    sampleRate: 44100,
    bitsPerSample: 16
  });

  this.encodeByteArray(wav, byteArray, volume, headerCount);

  if (attentionTone) {
    // Add an EAS or NWS attention tone at the end if requested.
    wav.append.apply(wav, [attentionTone[0], attentionTone[1], volume]);
    // Add a one second of silence with 0Hz and zero volume
    wav.append.apply(wav, [this.constants.silence1s[0], this.constants.silence1s[1], 0]);
  }

  // Append the EOM signal to the end of the message which consists of the
  // preamble followed by "NNNN".
  if (tail) {
    byteArray = this.constants.EOM
      .split("")
      .map((c) => {
        return c.charCodeAt(0);
      });

    this.encodeByteArray(wav, byteArray, volume, headerCount);
  }

  return wav.render();
};

/**
 * @param {Object} wav a Wav class object instance
 * @param {Array<number>} byteArray array of bytes to encode
 * @param {number} volume volume level of tones
 * @param {number} headerCount number of times to repeat SAME header audio (valid: 1, 2, 3, default: 3)
 * @returns {void}
 */
SAME.encodeByteArray = function (wav, byteArray, volume, headerCount = 3) {
  const byteCache = {};
  let whichBit = null;
  let byteSpec = [];
  let thisByte = -1;
  let thisBit;

  for (let repeat = 0; repeat < Math.max(1, Math.min(3, headerCount)); repeat += 1) {
    for (let i = 0; i < byteArray.length; i += 1) {
      thisByte = byteArray[i];
      if (byteCache[thisByte]) {
        byteSpec = byteCache[thisByte];
      } else {
        byteSpec = [];
        for (let e = 0; e < 8; e++) {
          thisBit = (thisByte & Math.pow(2, e)) !== 0 ? "mark" : "space";
          whichBit = this.constants.bits[thisBit];
          byteSpec.push([whichBit[0], whichBit[1], volume]);
        }
        byteCache[thisByte] = byteSpec;
      }

      byteSpec.forEach((bitSpec) => {
        wav.append.apply(wav, bitSpec);
      });
    }

    // Add a one second of silence with 0Hz and zero volume
    wav.append.apply(wav, [this.constants.silence1s[0], this.constants.silence1s[1], 0]);
  }
};

/**
 * Encode a correctly formed SAME message, specified as an object, into a .wav file.
 *
 * @param {Object} message SAME message object.
 * @returns {string} A fully rendered SAME message in RIFF WAVE format.
 */
SAME.encode = function (message) {
  return SAME.encode2(message, 1).waveData;
};

/**
 * Encode a correctly formed SAME message, specified as an object, into a .wav
 * file. Provides options for header repeat count and an attention tone. Returns
 * an object containing the wav data and the header string.
 *
 * @param {Object} message SAME message object.
 * @param {number} headerCount number of times to repeat SAME header audio (default: 3)
 * @param {Array<number>} attentionTone frequency and length definition for attention tone to play. Undefined for no tone.
 * @param {boolean} tail append the message tail "NNNN" (EOM) to the end (default: false)
 * @returns {Object} An object containing wav data (wavData) and header (header) string.
 */
SAME.encode2 = function (message, headerCount, attentionTone, tail) {
  const validationErrors = this.validateMessage(message);
  let msgBytes = [];
  let header = "";

  if (validationErrors.length > 0) {
    throw new Error(`Message failed to validate: ${validationErrors.join("; ")}`);
  }

  ({ msgBytes, header } = SAME.constructMessageByteArray(message));
  return {
    wavData: SAME.generateWaveData(msgBytes, headerCount, attentionTone, tail),
    header
  };
};

module.exports = SAME;
