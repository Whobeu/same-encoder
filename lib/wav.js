/* eslint-disable linebreak-style */
/* eslint-disable no-magic-numbers */
/* eslint-disable valid-jsdoc */
/* eslint-disable no-warning-comments */

"use strict";

const { pack } = require("./util"),
  xtype = require("xtypejs");

xtype.options.setNameScheme("compact");

/**
 * A subclass of Error specific to Wav class.
 *
 * @param {string} message - The message to include in the error.
 */
const WavError = function (message) {
  this.name = "WavError";
  this.message = message || "";
};
WavError.prototype = Error.prototype;

/**
 * A class for generating .wav (RIFF WAVE) format files containing a series of sine wave tones.
 *
 * @param {Object} params - An object of parameters for the wave file.
 * @param {number} params.channels - The number of channels to generate. Must be an integer > 0.
 * @param {number} params.sampleRate - The number of samples per second to generate. Must be an integer > 0.
 * @param {number} params.bitsPerSample - The number of bits per sample to generate. Must be an integer > 0.
 */
const Wav = function (params) {
  const paramErrors = [];

  // Validate parameters
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new WavError("Wav constructor requires a \"params\" object (see documentation)");
  }

  if (!xtype.is(params.channels, "int+")) {
    paramErrors.push("\"channels\" must be integer > 0");
  }

  if (!xtype.is(params.sampleRate, "int+")) {
    paramErrors.push("\"sampleRate\" must be integer > 0");
  }

  if (!xtype.is(params.bitsPerSample, "int+")) {
    paramErrors.push("\"bitsPerSample\" must be integer > 0");
  }

  if (paramErrors.length > 0) {
    throw new WavError(`Invalid parameters to Wav constructor: ${paramErrors.join("; ")}`);
  }

  // Set up instance
  this.params = params;
  this.dataBuffer = [];
};

/**
 * Append a tone specification to the .wav object's data buffer.
 * @param {number|Array<number>} frequency - The frequency or frequencies of the tone. Must be a positive number.
 * @param {number} length - The length, in (possibly fractional) seconds, of the tone.
 * @param {number} volume - The volume of the tone. Must be an integer between 0 and 32767 inclusive.
 */
Wav.prototype.append = function (frequency, length, volume) {
  const paramErrors = [];

  if (xtype.is(frequency, "-arr0|aar1")) {
    for (const f of frequency) {
      //NOTE: Original code was positive integers only. However, decimal
      // frequencies do work and exact SAME AFSK mark and space frequencies
      // of 2083.333 and 1562.5 can be specified.
      // if (!xtype.is(f, "num0|int+")) {
      if (!xtype.is(f, "num0|num+")) {
        paramErrors.push("frequency must be number >= 0");
      }
    }
  } else if (!xtype.is(frequency, "num0|num+")) {
    paramErrors.push("frequency must be number >= 0");
  }

  if (!xtype.is(length, "num+")) {
    paramErrors.push("length must be real > 0");
  }

  if (!(xtype.is(volume, "num0|int+") && volume <= 32767)) {
    paramErrors.push("volume must be integer 0 <= i <= 32767");
  }

  if (paramErrors.length > 0) {
    throw new WavError(`Invalid parameters to .append(): ${paramErrors.join("; ")}`);
  }

  this.dataBuffer.push({
    frequency: frequency,
    length: length,
    volume: volume
  });
};

/**
 * Render a single or multi-tone specification into samples suitable for inclusion in wave file data.
 * Not intended to be called directly. Do so at your own risk.
 *
 * @param {Object} spec - A tone specification (see {@link Wav.prototype.append} for details).
 */
Wav.prototype.renderTone = function (spec) {
  const tone = {
    count: 0,
    samples: ""
  };

  if (!Array.isArray(spec.frequency)) {
    spec.frequency = [spec.frequency];
  }

  for (let i = 0; i < this.params.sampleRate * spec.length; i += 1) {
    for (let c = 0; c < this.params.channels; c += 1) {
      let sample = 0;
      for (let f = 0; f < spec.frequency.length; f += 1) {
        sample += Math.sin(2 * Math.PI * (i / this.params.sampleRate) * spec.frequency[f]);
      }

      tone.samples += pack("v", sample * spec.volume / spec.frequency.length);
      tone.count += 1;
    }
  }

  return tone;
};

/**
 * Render the object's data buffer into a complete RIFF WAVE file.
 * @returns {string} - A complete RIFF WAVE file, ready for writing into a file, a browser audio element, or whatever else you like.
 */
Wav.prototype.render = function () {
  let sampleCount = 0,
    sampleData = "",
    self = this;

  this.dataBuffer.forEach((sampleSpec) => {
    const rendered = self.renderTone(sampleSpec);
    sampleCount += rendered.count;
    sampleData += rendered.samples;
  });

  //NOTE: See http://www-mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/WAVE.html for WAV format specification.
  const formatChunk = [
    "fmt ",
    pack("V", 16),  // Chunk size (16, 18 or 40) (4 bytes)
    pack("v", 1),   // WAVE_FORMAT_PCM (2 bytes)
    pack("v", this.params.channels), // Number of interleaved channels (2 bytes)
    pack("V", this.params.sampleRate), // Sampling rate (blocks per second) (4 bytes)
    pack("V", this.params.sampleRate *
      this.params.channels *
      this.params.bitsPerSample /
      8), // Data rate (4 bytes)
    pack("v", this.params.channels *
      this.params.bitsPerSample /
      8), // Data block size (bytes) (2 bytes)
    pack("v", this.params.bitsPerSample) // bits per sample (2 bytes)
  ].join("");

  const dataChunk = [
    "data",
    //NOTE: The following line caused length issues with iTunes. Other players
    // ignored it and the change below does not effect other players but does
    // result in correct length in iTunes.
    // pack("V", sampleCount * this.params.channels * this.params.bitsPerSample / 8),
    pack("V", sampleCount * this.params.channels), // Chunk size
    sampleData // Samples
  ].join("");

  const wav = [
    "RIFF",
    pack("V", 4 + (8 + formatChunk.length) + (8 + dataChunk.length)),
    "WAVE",
    formatChunk,
    dataChunk
  ].join("");

  return wav;
};

Wav.Error = WavError;

module.exports = Wav;
