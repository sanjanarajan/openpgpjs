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

// The GPG4Browsers crypto interface

/**
 * @requires crypto/cipher
 * @requires crypto/public_key
 * @requires crypto/random
 * @requires type/ecdh_symkey
 * @requires type/kdf_params
 * @requires type/mpi
 * @requires type/oid
 * @module crypto/crypto
 */

import random from './random.js';
import cipher from './cipher';
import publicKey from './public_key';
import type_ecdh_symkey from '../type/ecdh_symkey.js';
import type_kdf_params from '../type/kdf_params.js';
import type_mpi from '../type/mpi.js';
import type_oid from '../type/oid.js';


function constructParams(types, data) {
  return types.map(function(type, i) {
    if (data && data[i]) {
      return new type(data[i]);
    }
    return new type();
  });
}

export default {
  /**
   * Encrypts data using the specified public key multiprecision integers
   * and the specified algorithm.
   * @param {module:enums.publicKey} algo Algorithm to be used (See {@link https://tools.ietf.org/html/rfc4880#section-9.1|RFC 4880 9.1})
   * @param {Array<module:type/mpi|module:type/oid|module:type/kdf_params|module:type/ecdh_symkey>} publicParams Algorithm dependent params
   * @param {module:type/mpi} data Data to be encrypted as MPI
   * @param {String} fingerprint Recipient fingerprint
   * @return {Array<module:type/mpi|module:type/oid|module:type/kdf_params|module:type/ecdh_symkey>} encrypted session key parameters
   */
  publicKeyEncrypt: async function(algo, publicParams, data, fingerprint) {
    const types = this.getEncSessionKeyParamTypes(algo);
    return (async function() {
      let m;
      switch (algo) {
        case 'rsa_encrypt':
        case 'rsa_encrypt_sign': {
          const rsa = new publicKey.rsa();
          const n = publicParams[0].toBigInteger();
          const e = publicParams[1].toBigInteger();
          m = data.toBigInteger();
          return constructParams(types, [rsa.encrypt(m, e, n)]);
        }
        case 'elgamal': {
          const elgamal = new publicKey.elgamal();
          const p = publicParams[0].toBigInteger();
          const g = publicParams[1].toBigInteger();
          const y = publicParams[2].toBigInteger();
          m = data.toBigInteger();
          return constructParams(types, elgamal.encrypt(m, g, p, y));
        }
        case 'ecdh': {
          const { ecdh } = publicKey.elliptic;
          const curve = publicParams[0];
          const kdf_params = publicParams[2];
          const R = publicParams[1].toBigInteger();
          const res = await ecdh.encrypt(
            curve.oid, kdf_params.cipher, kdf_params.hash, data, R, fingerprint
          );
          return constructParams(types, [res.V, res.C]);
        }
        default:
          return [];
      }
    }());
  },

  /**
   * Decrypts data using the specified public key multiprecision integers of the private key,
   * the specified secretMPIs of the private key and the specified algorithm.
   * @param {module:enums.publicKey} algo Algorithm to be used (See {@link https://tools.ietf.org/html/rfc4880#section-9.1|RFC 4880 9.1})
   * @param {Array<module:type/mpi|module:type/oid|module:type/kdf_params>} keyIntegers Algorithm dependent params
   * @param {Array<module:type/mpi|module:type/ecdh_symkey>} dataIntegers encrypted session key parameters
   * @param {String} fingerprint Recipient fingerprint
   * @return {module:type/mpi} returns a big integer containing the decrypted data; otherwise null
   */

  publicKeyDecrypt: async function(algo, keyIntegers, dataIntegers, fingerprint) {
    let p;
    return new type_mpi(await (async function() {
      switch (algo) {
        case 'rsa_encrypt_sign':
        case 'rsa_encrypt': {
          const rsa = new publicKey.rsa();
          // 0 and 1 are the public key.
          const n = keyIntegers[0].toBigInteger();
          const e = keyIntegers[1].toBigInteger();
          // 2 to 5 are the private key.
          const d = keyIntegers[2].toBigInteger();
          p = keyIntegers[3].toBigInteger();
          const q = keyIntegers[4].toBigInteger();
          const u = keyIntegers[5].toBigInteger();
          const m = dataIntegers[0].toBigInteger();
          return rsa.decrypt(m, n, e, d, p, q, u);
        }
        case 'elgamal': {
          const elgamal = new publicKey.elgamal();
          const x = keyIntegers[3].toBigInteger();
          const c1 = dataIntegers[0].toBigInteger();
          const c2 = dataIntegers[1].toBigInteger();
          p = keyIntegers[0].toBigInteger();
          return elgamal.decrypt(c1, c2, p, x);
        }
        case 'ecdh': {
          const { ecdh } = publicKey.elliptic;
          const curve = keyIntegers[0];
          const kdf_params = keyIntegers[2];
          const V = dataIntegers[0].toBigInteger();
          const C = dataIntegers[1].data;
          const r = keyIntegers[3].toBigInteger();
          return ecdh.decrypt(curve.oid, kdf_params.cipher, kdf_params.hash, V, C, r, fingerprint);
        }
        default:
          return null;
      }
    }()));
  },

  /** Returns the types comprising the private key of an algorithm
   * @param {String} algo The public key algorithm
   * @return {Array<String>} The array of types
   */
  getPrivKeyParamTypes: function(algo) {
    switch (algo) {
      case 'rsa_encrypt':
      case 'rsa_encrypt_sign':
      case 'rsa_sign':
        //   Algorithm-Specific Fields for RSA secret keys:
        //   - multiprecision integer (MPI) of RSA secret exponent d.
        //   - MPI of RSA secret prime value p.
        //   - MPI of RSA secret prime value q (p < q).
        //   - MPI of u, the multiplicative inverse of p, mod q.
        return [type_mpi, type_mpi, type_mpi, type_mpi];
      case 'elgamal':
        // Algorithm-Specific Fields for Elgamal secret keys:
        //   - MPI of Elgamal secret exponent x.
        return [type_mpi];
      case 'dsa':
        // Algorithm-Specific Fields for DSA secret keys:
        //   - MPI of DSA secret exponent x.
        return [type_mpi];
      case 'ecdh':
      case 'ecdsa':
      case 'eddsa':
        // Algorithm-Specific Fields for ECDSA or ECDH secret keys:
        //   - MPI of an integer representing the secret key.
        return [type_mpi];
      default:
        throw new Error('Unknown algorithm');
    }
  },

  /** Returns the types comprising the public key of an algorithm
   * @param {String} algo The public key algorithm
   * @return {Array<String>} The array of types
   */
  getPubKeyParamTypes: function(algo) {
    //   Algorithm-Specific Fields for RSA public keys:
    //       - a multiprecision integer (MPI) of RSA public modulus n;
    //       - an MPI of RSA public encryption exponent e.
    switch (algo) {
      case 'rsa_encrypt':
      case 'rsa_encrypt_sign':
      case 'rsa_sign':
        return [type_mpi, type_mpi];
        //   Algorithm-Specific Fields for Elgamal public keys:
        //     - MPI of Elgamal prime p;
        //     - MPI of Elgamal group generator g;
        //     - MPI of Elgamal public key value y (= g**x mod p where x  is secret).
      case 'elgamal':
        return [type_mpi, type_mpi, type_mpi];
        //   Algorithm-Specific Fields for DSA public keys:
        //       - MPI of DSA prime p;
        //       - MPI of DSA group order q (q is a prime divisor of p-1);
        //       - MPI of DSA group generator g;
        //       - MPI of DSA public-key value y (= g**x mod p where x  is secret).
      case 'dsa':
        return [type_mpi, type_mpi, type_mpi, type_mpi];
        //   Algorithm-Specific Fields for ECDSA/EdDSA public keys:
        //       - OID of curve;
        //       - MPI of EC point representing public key.
      case 'ecdsa':
      case 'eddsa':
        return [type_oid, type_mpi];
        //   Algorithm-Specific Fields for ECDH public keys:
        //       - OID of curve;
        //       - MPI of EC point representing public key.
        //       - KDF: variable-length field containing KDF parameters.
      case 'ecdh':
        return [type_oid, type_mpi, type_kdf_params];
      default:
        throw new Error('Unknown algorithm.');
    }
  },

  /** Returns the types comprising the encrypted session key of an algorithm
   * @param {String} algo The public key algorithm
   * @return {Array<String>} The array of types
   */
  getEncSessionKeyParamTypes: function(algo) {
    switch (algo) {
      //    Algorithm-Specific Fields for RSA encrypted session keys:
      //        - MPI of RSA encrypted value m**e mod n.
      case 'rsa_encrypt':
      case 'rsa_encrypt_sign':
        return [type_mpi];

      //    Algorithm-Specific Fields for Elgamal encrypted session keys:
      //        - MPI of Elgamal value g**k mod p
      //        - MPI of Elgamal value m * y**k mod p
      case 'elgamal':
        return [type_mpi, type_mpi];

      //    Algorithm-Specific Fields for ECDH encrypted session keys:
      //        - MPI containing the ephemeral key used to establish the shared secret
      //        - ECDH Symmetric Key
      case 'ecdh':
        return [type_mpi, type_ecdh_symkey];

      default:
        throw new Error('Unknown algorithm.');
    }
  },

  /** Generate algorithm-specific key parameters
   * @param {String} algo The public key algorithm
   * @return {Array} The array of parameters
   */
  generateParams: function(algo, bits, curve) {
    const types = this.getPubKeyParamTypes(algo).concat(this.getPrivKeyParamTypes(algo));
    switch (algo) {
      case 'rsa_encrypt':
      case 'rsa_encrypt_sign':
      case 'rsa_sign': {
        //remember "publicKey" refers to the crypto/public_key dir
        const rsa = new publicKey.rsa();
        return rsa.generate(bits, "10001").then(function(keyObject) {
          return constructParams(
            types, [keyObject.n, keyObject.ee, keyObject.d, keyObject.p, keyObject.q, keyObject.u]
          );
        });
      }
      case 'ecdsa':
      case 'eddsa':
        return publicKey.elliptic.generate(curve).then(function (keyObject) {
          return constructParams(types, [keyObject.oid, keyObject.Q, keyObject.d]);
        });
      case 'ecdh':
        return publicKey.elliptic.generate(curve).then(function (keyObject) {
          return constructParams(types, [keyObject.oid, keyObject.Q, [keyObject.hash, keyObject.cipher], keyObject.d]);
        });
      default:
        throw new Error('Unsupported algorithm for key generation.');
    }
  },

  /**
   * generate random byte prefix as string for the specified algorithm
   * @param {module:enums.symmetric} algo Algorithm to use (see {@link https://tools.ietf.org/html/rfc4880#section-9.2|RFC 4880 9.2})
   * @return {Uint8Array} Random bytes with length equal to the block
   * size of the cipher
   */
  getPrefixRandom: function(algo) {
    return random.getRandomBytes(cipher[algo].blockSize);
  },

  /**
   * Generating a session key for the specified symmetric algorithm
   * @param {module:enums.symmetric} algo Algorithm to use (see {@link https://tools.ietf.org/html/rfc4880#section-9.2|RFC 4880 9.2})
   * @return {Uint8Array} Random bytes as a string to be used as a key
   */
  generateSessionKey: function(algo) {
    return random.getRandomBytes(cipher[algo].keySize);
  },

  constructParams: constructParams
};
