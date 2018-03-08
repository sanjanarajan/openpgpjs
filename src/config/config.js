// GPG4Browsers - An OpenPGP implementation in javascript
// Copyright (C) 2011 Recurity Labs GmbH
//
// This library is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public
// License as published by the Free Software Foundation; either
// version 3.0 of the License, or (at your option) any later version.
//
// This library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
// Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public
// License along with this library; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA

/**
 * This object contains global configuration values.
 * @requires enums
 * @module config/config
 */

import enums from '../enums.js';

export default {
  /** @property {Integer} prefer_hash_algorithm Default hash algorithm {@link module:enums.hash} */
  prefer_hash_algorithm: enums.hash.sha256,
  /** @property {Integer} encryption_cipher Default encryption cipher {@link module:enums.symmetric} */
  encryption_cipher: enums.symmetric.aes256,
  /** @property {Integer} compression Default compression algorithm {@link module:enums.compression} */
  compression: enums.compression.uncompressed,
  /** @property {Integer} deflate_level Default zip/zlib compression level, between 1 and 9 */
  deflate_level: 6,

  /**
   * Use Authenticated Encryption with Additional Data (AEAD) protection for symmetric encryption.
   * **NOT INTEROPERABLE WITH OTHER OPENPGP IMPLEMENTATIONS**
   * @property {Boolean} aead_protect
   */
  aead_protect:             false,
  /** Use integrity protection for symmetric encryption
   * @property {Boolean} integrity_protect */
  integrity_protect:        true,
  /** @property {Boolean} ignore_mdc_error Fail on decrypt if message is not integrity protected */
  ignore_mdc_error:         false,
  /** @property {Boolean} checksum_required Do not throw error when armor is missing a checksum */
  checksum_required:        false,
  /** @property {Boolean} rsa_blinding */
  rsa_blinding:             true,
  /** Work-around for rare GPG decryption bug when encrypting with multiple passwords
   * Slower and slightly less secure
   * @property {Boolean} password_collision_check
   */
  password_collision_check: false,
  /** @property {Boolean} revocations_expire If true, expired revocation signatures are ignored */
  revocations_expire:       false,

  /** @property {Boolean} use_native Use native Node.js crypto/zlib and WebCrypto APIs when available */
  use_native:               true,
  /** @property {Boolean} Use transferable objects between the Web Worker and main thread */
  zero_copy:                false,
  /** @property {Boolean} debug If enabled, debug messages will be printed */
  debug:                    false,
  /** @property {Boolean} tolerant Ignore unsupported/unrecognizable packets instead of throwing an error */
  tolerant:                 true,

  /** @property {Boolean} show_version Whether to include {@link module:config/config.versionstring} in armored messages */
  show_version: true,
  /** @property {Boolean} show_comment Whether to include {@link module:config/config.commentstring} in armored messages */
  show_comment: true,
  /** @property {String} versionstring A version string to be included in armored messages */
  versionstring: "OpenPGP.js VERSION",
  /** @property {String} commentstring A comment string to be included in armored messages */
  commentstring: "https://openpgpjs.org",

  /** @property {String} keyserver */
  keyserver:     "https://keyserver.ubuntu.com",
  /** @property {String} node_store */
  node_store:    "./openpgp.store"
};
