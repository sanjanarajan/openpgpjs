// OpenPGP.js - An OpenPGP implementation in javascript
// Copyright (C) 2015-2016 Decentral
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

// Wrapper of an instance of an Elliptic Curve

/**
 * @requires crypto/public_key/elliptic/key
 * @requires crypto/public_key/jsbn
 * @requires enums
 * @requires util
 * @module crypto/public_key/elliptic/curve
 */

import { ec as EC, eddsa as EdDSA } from 'elliptic';
import { KeyPair } from './key';
import BigInteger from '../jsbn';
import random from '../../random';
import config from '../../../config';
import enums from '../../../enums';
import util from '../../../util';
import OID from '../../../type/oid';
import base64 from '../../../encoding/base64';

const webCrypto = util.getWebCrypto();
const nodeCrypto = util.getNodeCrypto();

let webCurves = {};
let nodeCurves = {};
webCurves = {
  'p256': 'P-256',
  'p384': 'P-384',
  'p521': 'P-521'
};
if (nodeCrypto && config.use_native) {
  const knownCurves = nodeCrypto.getCurves();
  nodeCurves = {
    'secp256k1': knownCurves.includes('secp256k1') ? 'secp256k1' : undefined,
    'p256': knownCurves.includes('prime256v1') ? 'prime256v1' : undefined,
    'p384': knownCurves.includes('secp384r1') ? 'secp384r1' : undefined,
    'p521': knownCurves.includes('secp521r1') ? 'secp521r1' : undefined
    // TODO add more here
  };
}

const curves = {
  p256: {
    oid: util.bin2str([0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07]),
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha256,
    cipher: enums.symmetric.aes128,
    node: nodeCurves.p256,
    web: webCurves.p256,
    payloadSize: 32
  },
  p384: {
    oid: util.bin2str([0x2B, 0x81, 0x04, 0x00, 0x22]),
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha384,
    cipher: enums.symmetric.aes192,
    node: nodeCurves.p384,
    web: webCurves.p384,
    payloadSize: 48
  },
  p521: {
    oid: util.bin2str([0x2B, 0x81, 0x04, 0x00, 0x23]),
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha512,
    cipher: enums.symmetric.aes256,
    node: nodeCurves.p521,
    web: webCurves.p521,
    payloadSize: 66
  },
  secp256k1: {
    oid: util.bin2str([0x2B, 0x81, 0x04, 0x00, 0x0A]),
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha256,
    cipher: enums.symmetric.aes128,
    node: false // FIXME when we replace jwk-to-pem or it supports this curve
  },
  ed25519: {
    oid: util.bin2str([0x2B, 0x06, 0x01, 0x04, 0x01, 0xDA, 0x47, 0x0F, 0x01]),
    keyType: enums.publicKey.eddsa,
    hash: enums.hash.sha512,
    payloadSize: 32
  },
  curve25519: {
    oid: util.bin2str([0x2B, 0x06, 0x01, 0x04, 0x01, 0x97, 0x55, 0x01, 0x05, 0x01]),
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha256,
    cipher: enums.symmetric.aes128
  },
  brainpoolP256r1: { // TODO 1.3.36.3.3.2.8.1.1.7
    oid: util.bin2str([0x2B, 0x24, 0x03, 0x03, 0x02, 0x08, 0x01, 0x01, 0x07])
  },
  brainpoolP384r1: { // TODO 1.3.36.3.3.2.8.1.1.11
    oid: util.bin2str([0x2B, 0x24, 0x03, 0x03, 0x02, 0x08, 0x01, 0x01, 0x0B])
  },
  brainpoolP512r1: { // TODO 1.3.36.3.3.2.8.1.1.13
    oid: util.bin2str([0x2B, 0x24, 0x03, 0x03, 0x02, 0x08, 0x01, 0x01, 0x0D])
  }
};

function Curve(name, params) {
  this.keyType = params.keyType;
  switch (this.keyType) {
    case enums.publicKey.eddsa:
      this.curve = new EdDSA(name);
      break;
    case enums.publicKey.ecdsa:
      this.curve = new EC(name);
      break;
    default:
      throw new Error('Unknown elliptic key type;');
  }
  this.name = name;
  this.oid = curves[name].oid;
  this.hash = params.hash;
  this.cipher = params.cipher;
  this.node = params.node && curves[name].node;
  this.web = params.web && curves[name].web;
  this.payloadSize = curves[name].payloadSize;
}

Curve.prototype.keyFromPrivate = function (priv) { // Not for ed25519
  return new KeyPair(this.curve, { priv: priv });
};

Curve.prototype.keyFromSecret = function (secret) { // Only for ed25519
  return new KeyPair(this.curve, { secret: secret });
};

Curve.prototype.keyFromPublic = function (pub) {
  return new KeyPair(this.curve, { pub: pub });
};

Curve.prototype.genKeyPair = async function () {
  let keyPair;
  if (webCrypto && config.use_native && this.web) {
    // If browser doesn't support a curve, we'll catch it
    try {
      keyPair = await webGenKeyPair(this.name);
      return new KeyPair(this.curve, keyPair);
    } catch (err) {
      util.print_debug("Browser did not support signing: " + err.message);
    }
  } else if (nodeCrypto && config.use_native && this.node) {
    keyPair = await nodeGenKeyPair(this.name);
    return new KeyPair(this.curve, keyPair);
  }
  const compact = this.curve.curve.type === 'edwards' || this.curve.curve.type === 'mont';
  const r = await this.curve.genKeyPair();
  if (this.keyType === enums.publicKey.eddsa) {
    keyPair = { secret: r.getSecret() };
  } else {
    keyPair = { pub: r.getPublic('array', compact), priv: r.getPrivate().toArray() };
  }
  return new KeyPair(this.curve, keyPair);
};

function get(oid_or_name) {
  let name;
  if (OID.prototype.isPrototypeOf(oid_or_name) &&
      enums.curve[oid_or_name.toHex()]) {
    name = enums.write(enums.curve, oid_or_name.toHex()); // by curve OID
    return new Curve(name, curves[name]);
  } else if (enums.curve[oid_or_name]) {
    name = enums.write(enums.curve, oid_or_name); // by curve name
    return new Curve(name, curves[name]);
  } else if (enums.curve[util.hexstrdump(oid_or_name)]) {
    name = enums.write(enums.curve, util.hexstrdump(oid_or_name)); // by oid string
    return new Curve(name, curves[name]);
  }
  throw new Error('Not valid curve');
}

async function generate(curve) {
  curve = get(curve);
  const keyPair = await curve.genKeyPair();
  return {
    oid: curve.oid,
    Q: new BigInteger(util.hexidump(keyPair.getPublic()), 16),
    d: new BigInteger(util.hexidump(keyPair.getPrivate()), 16),
    hash: curve.hash,
    cipher: curve.cipher
  };
}

function getPreferredHashAlgo(oid) {
  return curves[enums.write(enums.curve, oid.toHex())].hash;
}

module.exports = {
  Curve,
  curves,
  webCurves,
  nodeCurves,
  getPreferredHashAlgo,
  generate,
  get
};


//////////////////////////
//                      //
//   Helper functions   //
//                      //
//////////////////////////


async function webGenKeyPair(name) {
  // Note: keys generated with ECDSA and ECDH are structurally equivalent
  const webCryptoKey = await webCrypto.generateKey({ name: "ECDSA", namedCurve: webCurves[name] }, true, ["sign", "verify"]);

  const privateKey = await webCrypto.exportKey("jwk", webCryptoKey.privateKey);
  const publicKey = await webCrypto.exportKey("jwk", webCryptoKey.publicKey);

  return {
    pub: {
      x: base64.decode(publicKey.x, true),
      y: base64.decode(publicKey.y, true)
    },
    priv: base64.decode(privateKey.d, true)
  };
}

async function nodeGenKeyPair(name) {
  const ecdh = nodeCrypto.createECDH(nodeCurves[name]);
  await ecdh.generateKeys();

  return {
    pub: ecdh.getPublicKey().toJSON().data,
    priv: ecdh.getPrivateKey().toJSON().data
  };
}
