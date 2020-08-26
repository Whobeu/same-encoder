"use strict";

//NOTE: See https://en.wikipedia.org/wiki/Specific_Area_Message_Encoding for SAME information

/* eslint no-magic-numbers: ["error", { "ignore": [0, 1, 2, 3, 4, 15, 24, 30, 60, 100, 1000] }] */
/* eslint-disable require-jsdoc */
/* eslint-disable array-element-newline */
/* eslint-disable no-sync */

const SAME = require("same-encoder");
const { code: EventCode, stateCode, countyCode, originator: Originator } = SAME.Values;

const Speaker = require("speaker");
const { PassThrough } = require("stream");

const fs = require("fs");

///////////////////////////////////////////////////////////////////////////////////////

//NOTE: The southern Long Island coastal waters are FIPS code 073815 but it is
// not transmitted for alerts.

const ORIGINATOR = "WXR";
const PURGE_TIME = 15;  // hhmm format - skip leading zeroes
const CALLSIGN = "TESTTEST";  // KOKX/NWS
const MAXIMUM_REGIONS = 31;
const DEFAULT_HEADER_REPEAT = 3;

///////////////////////////////////////////////////////////////////////////////////////
// Parse our command line argument and get any user specified options.

const { argv } = require("yargs")
  .strict()
  .option("event", {
    alias: "e",
    type: "array",
    requiresArg: true,
    default: "RWT",
    choices: Object.keys(EventCode).sort(),
    describe: "Event code (default: RWT)"
  })
  .coerce("event", (opt) => {
    const events = [];
    opt.forEach((element) => {
      events.push(element.toUpperCase());
    });

    return events;
  })
  .option("purgetime", {
    alias: "p",
    type: "number",
    requiresArg: true,
    default: PURGE_TIME,
    describe: `Purge time between 15 and 600 (default: ${PURGE_TIME})`
  })
  .check(({ purgetime }) => {
    if (!isValidPurgeTime(purgetime)) throw new Error(`${purgetime} is not a valid purge time.`);
    return true;
  })
  .option("originator", {
    alias: "o",
    type: "string",
    requiresArg: true,
    default: ORIGINATOR,
    choices: Object.keys(Originator).sort(),
    describe: `Alert originator (default: ${ORIGINATOR})`
  })
  .coerce("originator", (opt) => {
    return opt.toUpperCase();
  })
  .option("callsign", {
    alias: "c",
    type: "string",
    requiresArg: true,
    default: CALLSIGN,
    describe: `Sender callsign (default: ${CALLSIGN})`
  })
  .option("tone", {
    alias: "t",
    type: "string",
    requiresArg: true,
    default: "NWS",
    choices: ["NWS", "EAS", "NONE"],
    describe: "Alert tone to play. NWS (1050 Hz), EAS (853/960 Hz) or NONE (default: NWS)"
  })
  .coerce("tone", (opt) => {
    return opt.toUpperCase();
  })
  .option("wave", {
    alias: "w",
    type: "boolean",
    requiresArg: false,
    default: false,
    describe: "Write a WAV file instead of playing audio (default: false)"
  })
  .option("count", {
    alias: "u",
    type: "number",
    requiresArg: true,
    default: DEFAULT_HEADER_REPEAT,
    describe: `Number of times to repeat header [1-3] (default: ${DEFAULT_HEADER_REPEAT})`
  })
  .check(({ count }) => {
    if (!(count >= 1 && count <= 3)) throw new Error(`Count of ${count} is out of range. Value must be between 1 and 3.`);
    return true;
  })
  .option("notrailer", {
    alias: "n",
    type: "boolean",
    requiresArg: false,
    default: false,
    describe: "Do not output the 'NNNN' EOM trailer (default: false)"
  })
  .option("regions", {
    alias: "r",
    type: "array",
    requiresArg: true,
    demandOption: "Please provide a list of regions (ex. --regions 036059 025013)",
    describe: `SAME regions for alert. Maximum of ${MAXIMUM_REGIONS} regions. (required)`
  })
  .coerce("regions", (opt) => {
    const regions = [];
    opt.forEach((element) => {
      regions.push(element.toString());
    });

    return regions;
  })
  .check(({ regions }) => {
    if (regions.length > MAXIMUM_REGIONS) {
      throw new Error(`Maximum of ${MAXIMUM_REGIONS} allowed.`);
    }

    let lastIndex = 0;
    if (!regions.every((element, index) => {
      lastIndex = index;
      return ~element.search(/[0-9]{6}/);
    })) {
      throw new Error(`${regions[lastIndex]} is not a valid region. Regions must be six digits long. (ex. 036059)`);
    }

    return true; // tell Yargs that the arguments passed the check
  });

const { event, originator, regions, purgetime: length, callsign: sender, tone, count, notrailer } = argv;
(async () => {
  for await (const code of event) {
    const message = {
      originator,
      code,
      regions: getRegions(regions),
      length,
      start: getStartDate(),
      sender
    };

    const eventCodeName = EventCode[code];
    //NOTE: The maximum NWS purge time broadcast is 6 hours (0600) with minutes
    // being 00, 15, 30 and 45 depending on the hours.
    const purgeTime = length.toString().padStart(4, "0").replace(/(0[0-6])([0134][05])/, "$1:$2");
    console.log(`Event: ${eventCodeName}\nOriginator: ${originator}\nCallsign: ${sender}\nPurge time: ${purgeTime}\nRegion${regions.length === 1 ? "" : "s"}:`);
    message.regions.forEach(({ countyCode: regionCountyCode, stateCode: regionStateCode }) => {
      if (regionStateCode in countyCode && regionCountyCode in countyCode[regionStateCode]) console.log(`  ${countyCode[regionStateCode][regionCountyCode]}, ${stateCode[regionStateCode]}`);
    });

    if (argv.wave) {
      const outputDirectory = "./wav";
      //NOTE: We unconditionally create a ./wav directory if it does not exist.
      try {
        fs.mkdirSync(outputDirectory);
      }
      catch (e) {
        if (e.code !== "EEXIST" || !fs.lstatSync(outputDirectory).isDirectory()) throw e;
      }

      const outputFile = `${outputDirectory}/${eventCodeName.replace(/[/]/, "-")}.wav`;
      const { wavData, header } = SAME.Encoder.encode2(message, count, tone === "NONE" ? undefined : SAME.Encoder.constants[`attention${tone}`], !notrailer);
      console.log(`Header: ${header}`);
      SAME.Writer.write(wavData, outputFile);
      console.log(`Wrote ${outputFile}`);
    } else {
      await playAudio(message, count, tone === "NONE" ? undefined : SAME.Encoder.constants[`attention${tone}`], !notrailer);
    }
  }
})();

function getStartDate() {
  const now = new Date();
  //NOTE: From https://stackoverflow.com/questions/8619879/javascript-calculate-the-day-of-the-year-1-366
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start + (start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000;
  const oneDay = 1000 * 60 * 60 * 24;
  // Get the day number in the current year.
  const day = Math.floor(diff / oneDay);
  return {
    day,
    hour: now.getHours(),
    minute: now.getMinutes()
  };
}

function isValidPurgeTime(purgetime) {
  const hr = Math.floor(purgetime / 100);
  const mn = purgetime - 100 * hr;

  // timespec < 1 hour must be in 15-minute increment
  if (hr < 1) return mn % 15 === 0;

  // otherwise, must be in 30-minute increment
  return mn % 30 === 0;
}

function getRegions(fips) {
  // eslint-disable-next-line no-shadow
  const regions = [];
  fips.sort().forEach((element) => {
    regions.push({
      subdiv: element.substr(0, 1),
      stateCode: element.substr(1, 2),
      countyCode: element.substr(3, 3)
    });
  });

  return regions;
}

// eslint-disable-next-line no-shadow
function playAudio(message, headerCount = 3, tone = undefined, tail = true) {
  return new Promise((resolve) => {
    // Create the Speaker instance
    const speaker = new Speaker({
      channels: 2,          // 2 channels
      bitDepth: 16,         // 16-bit samples
      sampleRate: 44100     // 44,100 Hz sample rate
    });

    speaker.on("finish", () => {
      resolve();
    });

    const bufferStream = new PassThrough();
    const { wavData, header } = SAME.Encoder.encode2(message, headerCount, tone, tail);
    console.log(`Header: ${header}`);
    bufferStream.end(Buffer.from(wavData, "binary"), () => {
      bufferStream.pipe(speaker);
    });
  });
}
