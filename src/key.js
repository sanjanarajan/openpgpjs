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
 * @requires encoding/armor
 * @requires crypto
 * @requires packet
 * @requires config
 * @requires enums
 * @requires util
 * @module key
 */

import armor from './encoding/armor';
import crypto from './crypto';
import packet from './packet';
import config from './config';
import enums from './enums';
import util from './util';

/**
 * @class
 * @classdesc Class that represents an OpenPGP key. Must contain a primary key.
 * Can contain additional subkeys, signatures, user ids, user attributes.
 * @param  {module:packet/packetlist} packetlist The packets that form this key
 */

export function Key(packetlist) {
  if (!(this instanceof Key)) {
    return new Key(packetlist);
  }
  // same data as in packetlist but in structured form
  this.primaryKey = null;
  this.revocationSignatures = [];
  this.directSignatures = [];
  this.users = [];
  this.subKeys = [];
  this.packetlist2structure(packetlist);
  if (!this.primaryKey || !this.users.length) {
    throw new Error('Invalid key: need at least key and user ID packet');
  }
}

/**
 * Transforms packetlist to structured key data
 * @param  {module:packet/packetlist} packetlist The packets that form a key
 */
Key.prototype.packetlist2structure = function(packetlist) {
  let user;
  let primaryKeyId;
  let subKey;
  for (let i = 0; i < packetlist.length; i++) {
    switch (packetlist[i].tag) {
      case enums.packet.publicKey:
      case enums.packet.secretKey:
        this.primaryKey = packetlist[i];
        primaryKeyId = this.primaryKey.getKeyId();
        break;
      case enums.packet.userid:
      case enums.packet.userAttribute:
        user = new User(packetlist[i]);
        this.users.push(user);
        break;
      case enums.packet.publicSubkey:
      case enums.packet.secretSubkey:
        user = null;
        subKey = new SubKey(packetlist[i]);
        this.subKeys.push(subKey);
        break;
      case enums.packet.signature:
        switch (packetlist[i].signatureType) {
          case enums.signature.cert_generic:
          case enums.signature.cert_persona:
          case enums.signature.cert_casual:
          case enums.signature.cert_positive:
            if (!user) {
              util.print_debug('Dropping certification signatures without preceding user packet');
              continue;
            }
            if (packetlist[i].issuerKeyId.equals(primaryKeyId)) {
              user.selfCertifications.push(packetlist[i]);
            } else {
              user.otherCertifications.push(packetlist[i]);
            }
            break;
          case enums.signature.cert_revocation:
            if (user) {
              user.revocationSignatures.push(packetlist[i]);
            } else {
              this.directSignatures.push(packetlist[i]);
            }
            break;
          case enums.signature.key:
            this.directSignatures.push(packetlist[i]);
            break;
          case enums.signature.subkey_binding:
            if (!subKey) {
              util.print_debug('Dropping subkey binding signature without preceding subkey packet');
              continue;
            }
            subKey.bindingSignatures.push(packetlist[i]);
            break;
          case enums.signature.key_revocation:
            this.revocationSignatures.push(packetlist[i]);
            break;
          case enums.signature.subkey_revocation:
            if (!subKey) {
              util.print_debug('Dropping subkey revocation signature without preceding subkey packet');
              continue;
            }
            subKey.revocationSignatures.push(packetlist[i]);
            break;
        }
        break;
    }
  }
};

/**
 * Transforms structured key data to packetlist
 * @returns {module:packet/packetlist} The packets that form a key
 */
Key.prototype.toPacketlist = function() {
  const packetlist = new packet.List();
  packetlist.push(this.primaryKey);
  packetlist.concat(this.revocationSignatures);
  packetlist.concat(this.directSignatures);
  this.users.map(user => packetlist.concat(user.toPacketlist()));
  this.subKeys.map(subKey => packetlist.concat(subKey.toPacketlist()));
  return packetlist;
};

/**
 * Returns packetlist containing all public or private subkey packets matching keyId;
 * If keyId is not present, returns all subkey packets.
 * @param  {type/keyid} keyId
 * @returns {module:packet/packetlist}
 */
Key.prototype.getSubkeyPackets = function(keyId=null) {
  const packets = new packet.List();
  this.subKeys.forEach(subKey => {
    if (!keyId || subKey.subKey.getKeyId().equals(keyId, true)) {
      packets.push(subKey.subKey);
    }
  });
  return packets;
};

/**
 * Returns a packetlist containing all public or private key packets matching keyId.
 * If keyId is not present, returns all key packets starting with the primary key.
 * @param  {type/keyid} keyId
 * @returns {module:packet/packetlist}
 */
Key.prototype.getKeyPackets = function(keyId=null) {
  const packets = new packet.List();
  if (!keyId || this.primaryKey.getKeyId().equals(keyId, true)) {
    packets.push(this.primaryKey);
  }
  packets.concat(this.getSubkeyPackets(keyId));
  return packets;
};

/**
 * Returns key IDs of all key packets
 * @returns {Array<module:type/keyid>}
 */
Key.prototype.getKeyIds = function() {
  return this.getKeyPackets().map(keyPacket => keyPacket.getKeyId());
};

/**
 * Returns userids
 * @returns {Array<string>} array of userids
 */
Key.prototype.getUserIds = function() {
  return this.users.map(user => {
    return user.userId ? util.encode_utf8(user.userId.userid) : null;
  }).filter(userid => userid !== null);
};

/**
 * Returns true if this is a public key
 * @returns {Boolean}
 */
Key.prototype.isPublic = function() {
  return this.primaryKey.tag === enums.packet.publicKey;
};

/**
 * Returns true if this is a private key
 * @returns {Boolean}
 */
Key.prototype.isPrivate = function() {
  return this.primaryKey.tag === enums.packet.secretKey;
};

/**
 * Returns key as public key (shallow copy)
 * @returns {module:key~Key} new public Key
 */
Key.prototype.toPublic = function() {
  const packetlist = new packet.List();
  const keyPackets = this.toPacketlist();
  let bytes;
  let pubKeyPacket;
  let pubSubkeyPacket;
  for (let i = 0; i < keyPackets.length; i++) {
    switch (keyPackets[i].tag) {
      case enums.packet.secretKey:
        bytes = keyPackets[i].writePublicKey();
        pubKeyPacket = new packet.PublicKey();
        pubKeyPacket.read(bytes);
        packetlist.push(pubKeyPacket);
        break;
      case enums.packet.secretSubkey:
        bytes = keyPackets[i].writePublicKey();
        pubSubkeyPacket = new packet.PublicSubkey();
        pubSubkeyPacket.read(bytes);
        packetlist.push(pubSubkeyPacket);
        break;
      default:
        packetlist.push(keyPackets[i]);
    }
  }
  return new Key(packetlist);
};

/**
 * Returns ASCII armored text of key
 * @returns {String} ASCII armor
 */
Key.prototype.armor = function() {
  const type = this.isPublic() ? enums.armor.public_key : enums.armor.private_key;
  return armor.encode(type, this.toPacketlist().write());
};

function isValidSigningKeyPacket(keyPacket, signature, date=new Date()) {
  return keyPacket.algorithm !== enums.read(enums.publicKey, enums.publicKey.rsa_encrypt) &&
         keyPacket.algorithm !== enums.read(enums.publicKey, enums.publicKey.elgamal) &&
         keyPacket.algorithm !== enums.read(enums.publicKey, enums.publicKey.ecdh) &&
         (!signature.keyFlags ||
          (signature.keyFlags[0] & enums.keyFlags.sign_data) !== 0) &&
         signature.verified && !signature.revoked && !signature.isExpired(date) &&
         !isDataExpired(keyPacket, signature, date);
}

/**
 * Returns first key packet or key packet by given keyId that is available for signing and verification
 * @param  {module:type/keyid} keyId, optional
 * @param  {Date} date use the given date for verification instead of the current time
 * @returns {(module:packet/secret_subkey|
             module:packet/secret_key|null)} key packet or null if no signing key has been found
 */
Key.prototype.getSigningKeyPacket = async function (keyId=null, date=new Date()) {
  const primaryKey = this.primaryKey;
  const primaryUser = await this.getPrimaryUser(date);
  if (primaryUser && (!keyId || primaryKey.getKeyId().equals(keyId)) &&
      isValidSigningKeyPacket(primaryKey, primaryUser.selfCertification, date) &&
      await this.verifyPrimaryKey(date)) {
    return primaryKey;
  }
  for (let i = 0; i < this.subKeys.length; i++) {
    if (!keyId || this.subKeys[i].subKey.getKeyId().equals(keyId)) {
      // eslint-disable-next-line no-await-in-loop
      await this.subKeys[i].verify(primaryKey, date);
      for (let j = 0; j < this.subKeys[i].bindingSignatures.length; j++) {
        if (isValidSigningKeyPacket(this.subKeys[i].subKey, this.subKeys[i].bindingSignatures[j], date)) {
          return this.subKeys[i].subKey;
        }
      }
    }
  }
  return null;
};

function isValidEncryptionKeyPacket(keyPacket, signature, date=new Date()) {
  const normDate = util.normalizeDate(date);
  return keyPacket.algorithm !== enums.read(enums.publicKey, enums.publicKey.dsa) &&
         keyPacket.algorithm !== enums.read(enums.publicKey, enums.publicKey.rsa_sign) &&
         keyPacket.algorithm !== enums.read(enums.publicKey, enums.publicKey.ecdsa) &&
         keyPacket.algorithm !== enums.read(enums.publicKey, enums.publicKey.eddsa) &&
         (!signature.keyFlags ||
          (signature.keyFlags[0] & enums.keyFlags.encrypt_communication) !== 0 ||
          (signature.keyFlags[0] & enums.keyFlags.encrypt_storage) !== 0) &&
         signature.verified && !signature.revoked && !signature.isExpired(date) &&
         !isDataExpired(keyPacket, signature, date);
}

/**
 * Returns first key packet or key packet by given keyId that is available for encryption or decryption
 * @param  {module:type/keyid} keyId, optional
 * @param  {Date}              date, optional
 * @returns {(module:packet/public_subkey|
 *            module:packet/secret_subkey|
 *            module:packet/secret_key|
 *            module:packet/public_key|null)} key packet or null if no encryption key has been found
 */
Key.prototype.getEncryptionKeyPacket = async function(keyId, date=new Date()) {
  const primaryKey = this.primaryKey;
  // V4: by convention subkeys are preferred for encryption service
  // V3: keys MUST NOT have subkeys
  for (let i = 0; i < this.subKeys.length; i++) {
    if (!keyId || this.subKeys[i].subKey.getKeyId().equals(keyId)) {
      // eslint-disable-next-line no-await-in-loop
      await this.subKeys[i].verify(primaryKey, date);
      for (let j = 0; j < this.subKeys[i].bindingSignatures.length; j++) {
        if (isValidEncryptionKeyPacket(this.subKeys[i].subKey, this.subKeys[i].bindingSignatures[j], date)) {
          return this.subKeys[i].subKey;
        }
      }
    }
  }
  // if no valid subkey for encryption, evaluate primary key
  const primaryUser = await this.getPrimaryUser(date);
  if (primaryUser && (!keyId || primaryKey.getKeyId().equals(keyId)) &&
      isValidEncryptionKeyPacket(primaryKey, primaryUser.selfCertification, date) &&
      await this.verifyPrimaryKey(date)) {
    return primaryKey;
  }
  return null;
};

/**
 * Encrypts all secret key and subkey packets matching keyId
 * @param  {module:type/keyid} keyId
 * @param  {String} passphrase
 * @returns {Promise<Array<module:packet/secret_key|module:packet/secret_subkey>>}
 */
Key.prototype.encrypt = async function(passphrase, keyId=null) {
  if (!this.isPrivate()) {
    throw new Error("Nothing to encrypt in a public key");
  }

  return Promise.all(this.getKeyPackets(keyId).map(async function(keyPacket) {
    await keyPacket.encrypt(passphrase);
    await keyPacket.clearPrivateParams();
    return keyPacket;
  }));
};

/**
 * Decrypts all secret key and subkey packets matching keyId
 * @param  {String} passphrase
 * @param  {module:type/keyid} keyId
 * @returns {Promise<Boolean>} true if all matching key and subkey packets decrypted successfully
 */
Key.prototype.decrypt = async function(passphrase, keyId=null) {
  if (!this.isPrivate()) {
    throw new Error("Nothing to decrypt in a public key");
  }

  const results = await Promise.all(this.getKeyPackets(keyId).map(async function(keyPacket) {
    return keyPacket.decrypt(passphrase);
  }));
  return results.every(result => result === true);
};

/**
 * Checks if a signature on a key is revoked
 * @param  {module:packet/secret_key|
 * @param  {module:packet/signature}  signature    The signature to verify
 * @param  {module:packet/public_subkey|
 *          module:packet/secret_subkey|
 *          module:packet/public_key|
 *          module:packet/secret_key} key, optional The key to verify the signature
 * @param  {Date}                     date          Use the given date instead of the current time
 * @returns {Promise<Boolean>}                      True if the certificate is revoked
 */
Key.prototype.isRevoked = async function(signature, key, date=new Date()) {
  return isDataRevoked(
    this.primaryKey, { key: this.primaryKey }, this.revocationSignatures, signature, key, date
  );
};

/**
 * Returns a packetlist containing all verified public or private key packets matching keyId.
 * If keyId is not present, returns all verified key packets starting with the primary key.
 * Verification is in the context of given date.
 * @param  {type/keyid} keyId
 * @param  {Date}       date  Use the given date instead of the current time
 * @returns {Promise<module:packet/packetlist>}
 */
Key.prototype.verifyKeyPackets = async function(keyId=null, date=new Date()) {
  const packets = new packet.List();
  const { primaryKey } = this;
  if (await this.verifyPrimaryKey(date)) {
    if (!keyId || primaryKey.getKeyId().equals(keyId)) {
      packets.push(primaryKey);
    }
  }
  await Promise.all(this.subKeys.map(async subKey => {
    if (!keyId || subKey.subKey.getKeyId().equals(keyId)) {
      if (await subKey.verify(primaryKey, date)) {
        packets.push(subKey.subKey);
      }
    }
  }));
  return packets;
};

/**
 * Verify primary key. Checks for revocation signatures, expiration time
 * and valid self signature
 * @param {Date} date (optional) use the given date for verification instead of the current time
 * @returns {Promise<module:enums.keyStatus>} The status of the primary key
 */
Key.prototype.verifyPrimaryKey = async function(date=new Date()) {
  const primaryKey = this.primaryKey;
  // check for key revocation signatures
  if (await this.isRevoked(null, null, date)) {
    return enums.keyStatus.revoked;
  }
  // check for at least one self signature. Self signature of user ID not mandatory
  // See {@link https://tools.ietf.org/html/rfc4880#section-11.1}
  if (!this.users.some(user => user.userId && user.selfCertifications.length)) {
    return enums.keyStatus.no_self_cert;
  }
  // check for valid, unrevoked, unexpired self signature
  const { user, selfCertification } = await this.getPrimaryUser(date) || {};
  if (!user) {
    return enums.keyStatus.invalid;
  }
  // check for expiration time
  const currentTime = util.normalizeDate(date);
  if ((primaryKey.version === 3 && isDataExpired(primaryKey, null, date)) ||
      (primaryKey.version === 4 && isDataExpired(primaryKey, selfCertification, date))) {
    return enums.keyStatus.expired;
  }
  return enums.keyStatus.valid;
};

/**
 * Returns the expiration time of the primary key or null if key does not expire
 * @returns {Date|null}
 */
Key.prototype.getExpirationTime = async function() {
  if (this.primaryKey.version === 3) {
    return getExpirationTime(this.primaryKey);
  }
  if (this.primaryKey.version === 4) {
    const primaryUser = await this.getPrimaryUser();
    if (!primaryUser) {
      return null;
    }
    return getExpirationTime(this.primaryKey, primaryUser.selfCertification);
  }
};

/**
 * Returns primary user and most significant (latest valid) self signature
 * - if multiple primary users exist, returns the one with the latest self signature
 * - otherwise, returns the user with the latest self signature
 * @param  {Date} date use the given date for verification instead of the current time
 * @returns {{user: Array<module:packet/User>, selfCertification: Array<module:packet/signature>}|null} The primary user and the self signature
 */
Key.prototype.getPrimaryUser = async function(date=new Date()) {
  const { primaryKey } = this;
  let primaryUsers = [];
  let lastCreated = null;
  let lastPrimaryUserID = null;
  // TODO replace when Promise.forEach is implemented
  for (let i = 0; i < this.users.length; i++) {
    const user = this.users[i];
    if (!user.userId) {
      return;
    }
    const dataToVerify = { userid: user.userId , key: primaryKey };
    for (let j = 0; j < user.selfCertifications.length; j++) {
      const cert = user.selfCertifications[j];
      // skip if certificate is not the most recent
      if ((cert.isPrimaryUserID && cert.isPrimaryUserID < lastPrimaryUserID) ||
          (!lastPrimaryUserID && cert.created < lastCreated)) {
        continue;
      }
      // skip if certificates is invalid, revoked, or expired
      // eslint-disable-next-line no-await-in-loop
      if (!(cert.verified || await cert.verify(primaryKey, dataToVerify))) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      if (cert.revoked || await user.isRevoked(primaryKey, cert, null, date)) {
        continue;
      }
      if (cert.isExpired(date)) {
        continue;
      }
      lastPrimaryUserID = cert.isPrimaryUserID;
      lastCreated = cert.created;
      primaryUsers.push({ index: i, user: user, selfCertification: cert });
    }
  }
  // sort by primary user flag and signature creation time
  primaryUsers = primaryUsers.sort(function(a, b) {
    const A = a.selfCertification;
    const B = b.selfCertification;
    return (B.isPrimaryUserID - A.isPrimaryUserID) || (B.created - A.created);
  });
  return primaryUsers.pop();
};

/**
 * Update key with new components from specified key with same key ID:
 * users, subkeys, certificates are merged into the destination key,
 * duplicates and expired signatures are ignored.
 *
 * If the specified key is a private key and the destination key is public,
 * the destination key is transformed to a private key.
 * @param  {module:key~Key} key Source key to merge
 */
Key.prototype.update = async function(key) {
  const that = this;
  if (await key.verifyPrimaryKey() === enums.keyStatus.invalid) {
    return;
  }
  if (this.primaryKey.getFingerprint() !== key.primaryKey.getFingerprint()) {
    throw new Error('Key update method: fingerprints of keys not equal');
  }
  if (this.isPublic() && key.isPrivate()) {
    // check for equal subkey packets
    const equal = (this.subKeys.length === key.subKeys.length) &&
          (this.subKeys.every(function(destSubKey) {
            return key.subKeys.some(function(srcSubKey) {
              return destSubKey.subKey.getFingerprint() === srcSubKey.subKey.getFingerprint();
            });
          }));
    if (!equal) {
      throw new Error('Cannot update public key with private key if subkey mismatch');
    }
    this.primaryKey = key.primaryKey;
  }
  // revocation signatures
  await mergeSignatures(key, this, 'revocationSignatures', function(srcRevSig) {
    return isDataRevoked(that.primaryKey, that, [srcRevSig], null, key.primaryKey);
  });
  // direct signatures
  await mergeSignatures(key, this, 'directSignatures');
  // TODO replace when Promise.some or Promise.any are implemented
  // users
  await Promise.all(key.users.map(async function(srcUser) {
    let found = false;
    await Promise.all(that.users.map(async function(dstUser) {
      if ((srcUser.userId && (srcUser.userId.userid === dstUser.userId.userid)) ||
          (srcUser.userAttribute && (srcUser.userAttribute.equals(dstUser.userAttribute)))) {
        await dstUser.update(srcUser, that.primaryKey);
        found = true;
      }
    }));
    if (!found) {
      that.users.push(srcUser);
    }
  }));
  // TODO replace when Promise.some or Promise.any are implemented
  // subkeys
  await Promise.all(key.subKeys.map(async function(srcSubKey) {
    let found = false;
    await Promise.all(that.subKeys.map(async function(dstSubKey) {
      if (srcSubKey.subKey.getFingerprint() === dstSubKey.subKey.getFingerprint()) {
        await dstSubKey.update(srcSubKey, that.primaryKey);
        found = true;
      }
    }));
    if (!found) {
      that.subKeys.push(srcSubKey);
    }
  }));
};

/**
 * Merges signatures from source[attr] to dest[attr]
 * @private
 * @param  {Object} source
 * @param  {Object} dest
 * @param  {String} attr
 * @param  {Function} checkFn optional, signature only merged if true
 */
async function mergeSignatures(source, dest, attr, checkFn) {
  source = source[attr];
  if (source) {
    if (!dest[attr].length) {
      dest[attr] = source;
    } else {
      await Promise.all(source.map(async function(sourceSig) {
        if (!sourceSig.isExpired() && (!checkFn || await checkFn(sourceSig)) &&
            !dest[attr].some(function(destSig) {
              return util.equalsUint8Array(destSig.signature, sourceSig.signature);
            })) {
          dest[attr].push(sourceSig);
        }
      }));
    }
  }
}

// TODO
Key.prototype.revoke = function() {

};

/**
 * Signs primary user of key
 * @param  {Array<module:key~Key>} privateKey decrypted private keys for signing
 * @returns {Promise<module:key~Key>} new public key with new certificate signature
 */
Key.prototype.signPrimaryUser = async function(privateKeys) {
  const { index, user } = await this.getPrimaryUser() || {};
  if (!user) {
    throw new Error('Could not find primary user');
  }
  const userSign = await user.sign(this.primaryKey, privateKeys);
  const key = new Key(this.toPacketlist());
  key.users[index] = userSign;
  return key;
};

/**
 * Signs all users of key
 * @param  {Array<module:key~Key>} privateKeys decrypted private keys for signing
 * @returns {Promise<module:key~Key>} new public key with new certificate signature
 */
Key.prototype.signAllUsers = async function(privateKeys) {
  const that = this;
  const key = new Key(this.toPacketlist());
  key.users = await Promise.all(this.users.map(function(user) {
    return user.sign(that.primaryKey, privateKeys);
  }));
  return key;
};

/**
 * Verifies primary user of key
 * - if no arguments are given, verifies the self certificates;
 * - otherwise, verifies all certificates signed with given keys.
 * @param  {Array<module:key~Key>} keys array of keys to verify certificate signatures
 * @returns {Promise<Array<{keyid: module:type/keyid,
 *                          valid: Boolean}>>}    List of signer's keyid and validity of signature
 */
Key.prototype.verifyPrimaryUser = async function(keys) {
  const primaryKey = this.primaryKey;
  const { user } = await this.getPrimaryUser() || {};
  if (!user) {
    throw new Error('Could not find primary user');
  }
  const results = keys ? await user.verifyAllCertifications(primaryKey, keys) :
    [{ keyid: primaryKey.keyid, valid: await user.verify(primaryKey) === enums.keyStatus.valid }];
  return results;
};

/**
 * Verifies all users of key
 * - if no arguments are given, verifies the self certificates;
 * - otherwise, verifies all certificates signed with given keys.
 * @param  {Array<module:key~Key>} keys array of keys to verify certificate signatures
 * @returns {Promise<Array<{userid: String,
 *                          keyid: module:type/keyid,
 *                          valid: Boolean}>>} list of userid, signer's keyid and validity of signature
 */
Key.prototype.verifyAllUsers = async function(keys) {
  const results = [];
  const { primaryKey } = this;
  await Promise.all(this.users.map(async function(user) {
    const signatures = keys ? await user.verifyAllCertifications(primaryKey, keys) :
      [{ keyid: primaryKey.keyid, valid: await user.verify(primaryKey) === enums.keyStatus.valid }];
    signatures.forEach(signature => {
      results.push({
        userid: user.userId.userid,
        keyid: signature.keyid,
        valid: signature.valid
      });
    });
  }));
  return results;
};

/**
 * @class
 * @classdesc Class that represents an user ID or attribute packet and the relevant signatures.
 */
function User(userPacket) {
  if (!(this instanceof User)) {
    return new User(userPacket);
  }
  this.userId = userPacket.tag === enums.packet.userid ? userPacket : null;
  this.userAttribute = userPacket.tag === enums.packet.userAttribute ? userPacket : null;
  this.selfCertifications = [];
  this.otherCertifications = [];
  this.revocationSignatures = [];
}

/**
 * Transforms structured user data to packetlist
 * @returns {module:packet/packetlist}
 */
User.prototype.toPacketlist = function() {
  const packetlist = new packet.List();
  packetlist.push(this.userId || this.userAttribute);
  packetlist.concat(this.revocationSignatures);
  packetlist.concat(this.selfCertifications);
  packetlist.concat(this.otherCertifications);
  return packetlist;
};

/**
 * Signs user
 * @param  {module:packet/secret_key|
 *          module:packet/public_key} primaryKey  The primary key packet
 * @param  {Array<module:key~Key>}    privateKeys Decrypted private keys for signing
 * @returns {Promise<module:key~Key>}             New user with new certificate signatures
 */
User.prototype.sign = async function(primaryKey, privateKeys) {
  const dataToSign = { userid: this.userId || this.userAttribute, key: primaryKey };
  const user = new User(dataToSign.userid);
  user.otherCertifications = await Promise.all(privateKeys.map(async function(privateKey) {
    if (privateKey.isPublic()) {
      throw new Error('Need private key for signing');
    }
    if (privateKey.primaryKey.getFingerprint() === primaryKey.getFingerprint()) {
      throw new Error('Not implemented for self signing');
    }
    const signingKeyPacket = await privateKey.getSigningKeyPacket();
    if (!signingKeyPacket) {
      throw new Error('Could not find valid signing key packet in key ' +
                      privateKey.primaryKey.getKeyId().toHex());
    }
    if (!signingKeyPacket.isDecrypted) {
      throw new Error('Private key is not decrypted.');
    }
    const signaturePacket = new packet.Signature();
    // Most OpenPGP implementations use generic certification (0x10)
    signaturePacket.signatureType = enums.write(enums.signature, enums.signature.cert_generic);
    signaturePacket.keyFlags = [enums.keyFlags.certify_keys | enums.keyFlags.sign_data];
    signaturePacket.publicKeyAlgorithm = signingKeyPacket.algorithm;
    signaturePacket.hashAlgorithm = await getPreferredHashAlgo(privateKey);
    signaturePacket.signingKeyId = signingKeyPacket.getKeyId();
    signaturePacket.sign(signingKeyPacket, dataToSign);
    return signaturePacket;
  }));
  await user.update(this, primaryKey);
  return user;
};

/**
 * Checks if a given certificate of the user is revoked
 * @param  {module:packet/secret_key|
 *          module:packet/public_key} primaryKey    The primary key packet
 * @param  {module:packet/signature}  certificate   The certificate to verify
 * @param  {module:packet/public_subkey|
 *          module:packet/secret_subkey|
 *          module:packet/public_key|
 *          module:packet/secret_key} key, optional The key to verify the signature
 * @param  {Date}                     date          Use the given date instead of the current time
 * @returns {Promise<Boolean>}                      True if the certificate is revoked
 */
User.prototype.isRevoked = async function(primaryKey, certificate, key, date=new Date()) {
  return isDataRevoked(
    primaryKey, {
      key: primaryKey,
      userid: this.userId || this.userAttribute
    }, this.revocationSignatures, certificate, key, date
  );
};

/**
 * Verifies the user certificate
 * @param  {module:packet/secret_key|
            module:packet/public_key} primaryKey  The primary key packet
 * @param  {module:packet/signature}  certificate A certificate of this user
 * @param  {Array<module:key~Key>}    keys        Array of keys to verify certificate signatures
 * @param  {Date}                     date        Use the given date instead of the current time
 * @returns {Promise<module:enums.keyStatus>}     status of the certificate
 */
User.prototype.verifyCertificate = async function(primaryKey, certificate, keys, date=new Date()) {
  const that = this;
  const keyid = certificate.issuerKeyId;
  const dataToVerify = { userid: this.userId || this.userAttribute, key: primaryKey };
  const results = await Promise.all(keys.map(async function(key) {
    if (!key.getKeyIds().some(id => id.equals(keyid))) { return; }
    const keyPacket = await key.getSigningKeyPacket(keyid, date);
    if (certificate.revoked || await that.isRevoked(primaryKey, certificate, keyPacket)) {
      return enums.keyStatus.revoked;
    }
    if (!(certificate.verified || await certificate.verify(keyPacket, dataToVerify))) {
      return enums.keyStatus.invalid;
    }
    if (certificate.isExpired()) {
      return enums.keyStatus.expired;
    }
    return enums.keyStatus.valid;
  }));
  return results.find(result => result !== undefined);
};

/**
 * Verifies all user certificates
 * @param  {module:packet/secret_key|
 *          module:packet/public_key} primaryKey The primary key packet
 * @param  {Array<module:key~Key>}    keys       Array of keys to verify certificate signatures
 * @returns {Promise<Array<{keyid: module:type/keyid,
 *                          valid: Boolean}>>}   List of signer's keyid and validity of signature
 */
User.prototype.verifyAllCertifications = async function(primaryKey, keys) {
  const that = this;
  const certifications = this.selfCertifications.concat(this.otherCertifications);
  return Promise.all(certifications.map(async function(certification) {
    const status = await that.verifyCertificate(primaryKey, certification, keys);
    return {
      keyid: certification.issuerKeyId,
      valid: status === undefined ? null : status === enums.keyStatus.valid
    };
  }));
};

/**
 * Verify User. Checks for existence of self signatures, revocation signatures
 * and validity of self signature
 * @param  {module:packet/secret_key|
 *          module:packet/public_key} primaryKey The primary key packet
 * @returns {Promise<module:enums.keyStatus>}    Status of user
 */
User.prototype.verify = async function(primaryKey) {
  if (!this.selfCertifications.length) {
    return enums.keyStatus.no_self_cert;
  }
  const that = this;
  const dataToVerify = { userid: this.userId || this.userAttribute, key: primaryKey };
  // TODO replace when Promise.some or Promise.any are implemented
  const results = [enums.keyStatus.invalid].concat(
    await Promise.all(this.selfCertifications.map(async function(selfCertification) {
      if (selfCertification.revoked || await that.isRevoked(primaryKey, selfCertification)) {
        return enums.keyStatus.revoked;
      }
      if (!(selfCertification.verified || await selfCertification.verify(primaryKey, dataToVerify))) {
        return enums.keyStatus.invalid;
      }
      if (selfCertification.isExpired()) {
        return enums.keyStatus.expired;
      }
      return enums.keyStatus.valid;
    })));
  return results.some(status => status === enums.keyStatus.valid) ?
    enums.keyStatus.valid : results.pop();
};

/**
 * Update user with new components from specified user
 * @param  {module:key~User}             user       Source user to merge
 * @param  {module:packet/secret_key|
            module:packet/secret_subkey} primaryKey primary key used for validation
 */
User.prototype.update = async function(user, primaryKey) {
  const dataToVerify = { userid: this.userId || this.userAttribute, key: primaryKey };
  // self signatures
  await mergeSignatures(user, this, 'selfCertifications', async function(srcSelfSig) {
    return srcSelfSig.verified || srcSelfSig.verify(primaryKey, dataToVerify);
  });
  // other signatures
  await mergeSignatures(user, this, 'otherCertifications');
  // revocation signatures
  await mergeSignatures(user, this, 'revocationSignatures', function(srcRevSig) {
    return isDataRevoked(primaryKey, dataToVerify, [srcRevSig]);
  });
};

/**
 * @class
 * @classdesc Class that represents a subkey packet and the relevant signatures.
 */
function SubKey(subKeyPacket) {
  if (!(this instanceof SubKey)) {
    return new SubKey(subKeyPacket);
  }
  this.subKey = subKeyPacket;
  this.bindingSignatures = [];
  this.revocationSignatures = [];
}

/**
 * Transforms structured subkey data to packetlist
 * @returns {module:packet/packetlist}
 */
SubKey.prototype.toPacketlist = function() {
  const packetlist = new packet.List();
  packetlist.push(this.subKey);
  packetlist.concat(this.revocationSignatures);
  packetlist.concat(this.bindingSignatures);
  return packetlist;
};

/**
 * Checks if a binding signature of a subkey is revoked
 * @param  {module:packet/secret_key|
 *          module:packet/public_key} primaryKey    The primary key packet
 * @param  {module:packet/signature}  signature     The binding signature to verify
 * @param  {module:packet/public_subkey|
 *          module:packet/secret_subkey|
 *          module:packet/public_key|
 *          module:packet/secret_key} key, optional The key to verify the signature
 * @param  {Date}                     date          Use the given date instead of the current time
 * @returns {Promise<Boolean>}                      True if the binding signature is revoked
 */
SubKey.prototype.isRevoked = async function(primaryKey, signature, key, date=new Date()) {
  return isDataRevoked(
    primaryKey, {
      key: primaryKey,
      bind: this.subKey
    }, this.revocationSignatures, signature, key, date
  );
};

/**
 * Verify subkey. Checks for revocation signatures, expiration time
 * and valid binding signature
 * @param  {module:packet/secret_key|
 *          module:packet/public_key} primaryKey The primary key packet
 * @param  {Date}                     date       Use the given date instead of the current time
 * @returns {Promise<module:enums.keyStatus>}    The status of the subkey
 */
SubKey.prototype.verify = async function(primaryKey, date=new Date()) {
  const that = this;
  const dataToVerify = { key: primaryKey, bind: this.subKey };
  // check for V3 expiration time
  if (this.subKey.version === 3 && isDataExpired(this.subKey, null, date)) {
    return enums.keyStatus.expired;
  }
  // check subkey binding signatures
  // note: binding signatures can have different keyFlags, so we verify all.
  const results = [enums.keyStatus.invalid].concat(
    await Promise.all(this.bindingSignatures.map(async function(bindingSignature) {
      // check binding signature is verified
      if (!(bindingSignature.verified || await bindingSignature.verify(primaryKey, dataToVerify))) {
        return enums.keyStatus.invalid;
      }
      // check binding signature is not revoked
      if (bindingSignature.revoked || await that.isRevoked(primaryKey, bindingSignature, null, date)) {
        return enums.keyStatus.revoked;
      }
      // check binding signature is not expired (ie, check for V4 expiration time)
      if (bindingSignature.isExpired(date)) {
        return enums.keyStatus.expired;
      }
      return enums.keyStatus.valid; // found a binding signature that passed all checks
    }))
  );
  return results.some(status => status === enums.keyStatus.valid) ?
    enums.keyStatus.valid : results.pop();
};

/**
 * Returns the expiration time of the subkey or null if key does not expire
 * @returns {Date|null}
 */
SubKey.prototype.getExpirationTime = function() {
  let highest;
  for (let i = 0; i < this.bindingSignatures.length; i++) {
    const current = getExpirationTime(this.subKey, this.bindingSignatures[i]);
    if (current === null) {
      return null;
    }
    if (!highest || current > highest) {
      highest = current;
    }
  }
  return highest;
};

/**
 * Update subkey with new components from specified subkey
 * @param  {module:key~SubKey}           subKey     Source subkey to merge
 * @param  {module:packet/secret_key|
            module:packet/secret_subkey} primaryKey primary key used for validation
 */
SubKey.prototype.update = async function(subKey, primaryKey) {
  if (await subKey.verify(primaryKey) === enums.keyStatus.invalid) {
    return;
  }
  if (this.subKey.getFingerprint() !== subKey.subKey.getFingerprint()) {
    throw new Error('SubKey update method: fingerprints of subkeys not equal');
  }
  // key packet
  if (this.subKey.tag === enums.packet.publicSubkey &&
      subKey.subKey.tag === enums.packet.secretSubkey) {
    this.subKey = subKey.subKey;
  }
  // update missing binding signatures
  const that = this;
  const dataToVerify = { key: primaryKey, bind: that.subKey };
  await mergeSignatures(subKey, this, 'bindingSignatures', async function(srcBindSig) {
    if (!(srcBindSig.verified || await srcBindSig.verify(primaryKey, dataToVerify))) {
      return false;
    }
    for (let i = 0; i < that.bindingSignatures.length; i++) {
      if (that.bindingSignatures[i].issuerKeyId.equals(srcBindSig.issuerKeyId)) {
        if (srcBindSig.created < that.bindingSignatures[i].created) {
          that.bindingSignatures[i] = srcBindSig;
          return false;
        }
      }
    }
    return true;
  });
  // revocation signatures
  await mergeSignatures(subKey, this, 'revocationSignatures', function(srcRevSig) {
    return isDataRevoked(primaryKey, dataToVerify, [srcRevSig]);
  });
};

/**
 * Reads an unarmored OpenPGP key list and returns one or multiple key objects
 * @param {Uint8Array} data to be parsed
 * @returns {{keys: Array<module:key~Key>, err: (Array<Error>|null)}} result object with key and error arrays
 * @static
 */
export function read(data) {
  const result = {};
  result.keys = [];
  try {
    const packetlist = new packet.List();
    packetlist.read(data);
    const keyIndex = packetlist.indexOfTag(enums.packet.publicKey, enums.packet.secretKey);
    if (keyIndex.length === 0) {
      throw new Error('No key packet found');
    }
    for (let i = 0; i < keyIndex.length; i++) {
      const oneKeyList = packetlist.slice(keyIndex[i], keyIndex[i + 1]);
      try {
        const newKey = new Key(oneKeyList);
        result.keys.push(newKey);
      } catch (e) {
        result.err = result.err || [];
        result.err.push(e);
      }
    }
  } catch (e) {
    result.err = result.err || [];
    result.err.push(e);
  }
  return result;
}

/**
 * Reads an OpenPGP armored text and returns one or multiple key objects
 * @param {String} armoredText text to be parsed
 * @returns {{keys: Array<module:key~Key>,
             err: (Array<Error>|null)}} result object with key and error arrays
 * @static
 */
export function readArmored(armoredText) {
  try {
    const input = armor.decode(armoredText);
    if (!(input.type === enums.armor.public_key || input.type === enums.armor.private_key)) {
      throw new Error('Armored text not of type key');
    }
    return read(input.data);
  } catch (e) {
    const result = { keys: [], err: [] };
    result.err.push(e);
    return result;
  }
}

/**
 * Generates a new OpenPGP key. Supports RSA and ECC keys.
 * Primary and subkey will be of same type.
 * @param {module:enums.publicKey} [options.keyType=module:enums.publicKey.rsa_encrypt_sign]    to indicate what type of key to make.
 *                             RSA is 1. See {@link https://tools.ietf.org/html/rfc4880#section-9.1}
 * @param {Integer} options.numBits    number of bits for the key creation.
 * @param {String|Array<String>}  options.userIds    assumes already in form of "User Name <username@email.com>"
                                                     If array is used, the first userId is set as primary user Id
 * @param {String}  options.passphrase The passphrase used to encrypt the resulting private key
 * @param {Boolean} [options.unlocked=false]    The secret part of the generated key is unlocked
 * @param {Number} [options.keyExpirationTime=0] The number of seconds after the key creation time that the key expires
 * @returns {module:key~Key}
 * @static
 */
export function generate(options) {
  let secretKeyPacket;
  let secretSubkeyPacket;
  return Promise.resolve().then(() => {
    if (options.curve) {
      try {
        options.curve = enums.write(enums.curve, options.curve);
      } catch (e) {
        throw new Error('Not valid curve.');
      }
      if (options.curve === enums.curve.ed25519 || options.curve === enums.curve.curve25519) {
        options.keyType = options.keyType || enums.publicKey.eddsa;
      } else {
        options.keyType = options.keyType || enums.publicKey.ecdsa;
      }
      options.subkeyType = options.subkeyType || enums.publicKey.ecdh;
    } else if (options.numBits) {
      options.keyType = options.keyType || enums.publicKey.rsa_encrypt_sign;
      options.subkeyType = options.subkeyType || enums.publicKey.rsa_encrypt_sign;
    } else {
      throw new Error('Key type not specified.');
    }

    if (options.keyType !== enums.publicKey.rsa_encrypt_sign &&
        options.keyType !== enums.publicKey.ecdsa &&
        options.keyType !== enums.publicKey.eddsa) {
      // RSA Encrypt-Only and RSA Sign-Only are deprecated and SHOULD NOT be generated
      throw new Error('Unsupported key type');
    }

    if (options.subkeyType !== enums.publicKey.rsa_encrypt_sign &&
        options.subkeyType !== enums.publicKey.ecdh) {
      // RSA Encrypt-Only and RSA Sign-Only are deprecated and SHOULD NOT be generated
      throw new Error('Unsupported subkey type');
    }

    if (!options.passphrase) { // Key without passphrase is unlocked by definition
      options.unlocked = true;
    }
    if (util.isString(options.userIds)) {
      options.userIds = [options.userIds];
    }

    return Promise.all([generateSecretKey(), generateSecretSubkey()]).then(() => wrapKeyObject(secretKeyPacket, secretSubkeyPacket, options));
  });

  function generateSecretKey() {
    secretKeyPacket = new packet.SecretKey();
    secretKeyPacket.packets = null;
    secretKeyPacket.algorithm = enums.read(enums.publicKey, options.keyType);
    options.curve = options.curve === enums.curve.curve25519 ? enums.curve.ed25519 : options.curve;
    return secretKeyPacket.generate(options.numBits, options.curve);
  }

  function generateSecretSubkey() {
    secretSubkeyPacket = new packet.SecretSubkey();
    secretKeyPacket.packets = null;
    secretSubkeyPacket.algorithm = enums.read(enums.publicKey, options.subkeyType);
    options.curve = options.curve === enums.curve.ed25519 ? enums.curve.curve25519 : options.curve;
    return secretSubkeyPacket.generate(options.numBits, options.curve);
  }
}

/**
 * Reformats and signs an OpenPGP with a given User ID. Currently only supports RSA keys.
 * @param {module:key~Key} options.privateKey   The private key to reformat
 * @param {module:enums.publicKey} [options.keyType=module:enums.publicKey.rsa_encrypt_sign]
 * @param {String|Array<String>}  options.userIds    assumes already in form of "User Name <username@email.com>"
                                                     If array is used, the first userId is set as primary user Id
 * @param {String}  options.passphrase The passphrase used to encrypt the resulting private key
 * @param {Boolean} [options.unlocked=false]    The secret part of the generated key is unlocked
 * @param {Number} [options.keyExpirationTime=0] The number of seconds after the key creation time that the key expires
 * @returns {Promise<module:key~Key>}
 * @static
 */
export async function reformat(options) {
  let secretKeyPacket;
  let secretSubkeyPacket;
  options.keyType = options.keyType || enums.publicKey.rsa_encrypt_sign;
  // RSA Encrypt-Only and RSA Sign-Only are deprecated and SHOULD NOT be generated
  if (options.keyType !== enums.publicKey.rsa_encrypt_sign) {
    throw new Error('Only RSA Encrypt or Sign supported');
  }

  try {
    const isDecrypted = options.privateKey.getKeyPackets().every(keyPacket => keyPacket.isDecrypted);
    if (!isDecrypted) {
      await options.privateKey.decrypt();
    }
  } catch (err) {
    throw new Error('Key not decrypted');
  }

  if (!options.passphrase) { // Key without passphrase is unlocked by definition
    options.unlocked = true;
  }
  if (util.isString(options.userIds)) {
    options.userIds = [options.userIds];
  }
  const packetlist = options.privateKey.toPacketlist();
  for (let i = 0; i < packetlist.length; i++) {
    if (packetlist[i].tag === enums.packet.secretKey) {
      secretKeyPacket = packetlist[i];
      options.keyType = secretKeyPacket.algorithm;
    } else if (packetlist[i].tag === enums.packet.secretSubkey) {
      secretSubkeyPacket = packetlist[i];
      options.subkeyType = secretSubkeyPacket.algorithm;
    }
  }
  if (!secretKeyPacket) {
    throw new Error('Key does not contain a secret key packet');
  }
  return wrapKeyObject(secretKeyPacket, secretSubkeyPacket, options);
}

async function wrapKeyObject(secretKeyPacket, secretSubkeyPacket, options) {
  // set passphrase protection
  if (options.passphrase) {
    await secretKeyPacket.encrypt(options.passphrase);
    if (secretSubkeyPacket) {
      await secretSubkeyPacket.encrypt(options.passphrase);
    }
  }

  const packetlist = new packet.List();

  packetlist.push(secretKeyPacket);

  await Promise.all(options.userIds.map(async function(userId, index) {
    const userIdPacket = new packet.Userid();
    userIdPacket.read(util.str_to_Uint8Array(userId));

    const dataToSign = {};
    dataToSign.userid = userIdPacket;
    dataToSign.key = secretKeyPacket;
    const signaturePacket = new packet.Signature();
    signaturePacket.signatureType = enums.signature.cert_generic;
    signaturePacket.publicKeyAlgorithm = options.keyType;
    signaturePacket.hashAlgorithm = await getPreferredHashAlgo(secretKeyPacket);
    signaturePacket.keyFlags = [enums.keyFlags.certify_keys | enums.keyFlags.sign_data];
    signaturePacket.preferredSymmetricAlgorithms = [];
    // prefer aes256, aes128, then aes192 (no WebCrypto support: https://www.chromium.org/blink/webcrypto#TOC-AES-support)
    signaturePacket.preferredSymmetricAlgorithms.push(enums.symmetric.aes256);
    signaturePacket.preferredSymmetricAlgorithms.push(enums.symmetric.aes128);
    signaturePacket.preferredSymmetricAlgorithms.push(enums.symmetric.aes192);
    signaturePacket.preferredSymmetricAlgorithms.push(enums.symmetric.cast5);
    signaturePacket.preferredSymmetricAlgorithms.push(enums.symmetric.tripledes);
    signaturePacket.preferredHashAlgorithms = [];
    // prefer fast asm.js implementations (SHA-256). SHA-1 will not be secure much longer...move to bottom of list
    signaturePacket.preferredHashAlgorithms.push(enums.hash.sha256);
    signaturePacket.preferredHashAlgorithms.push(enums.hash.sha512);
    signaturePacket.preferredHashAlgorithms.push(enums.hash.sha1);
    signaturePacket.preferredCompressionAlgorithms = [];
    signaturePacket.preferredCompressionAlgorithms.push(enums.compression.zlib);
    signaturePacket.preferredCompressionAlgorithms.push(enums.compression.zip);
    if (index === 0) {
      signaturePacket.isPrimaryUserID = true;
    }
    if (config.integrity_protect) {
      signaturePacket.features = [];
      signaturePacket.features.push(1); // Modification Detection
    }
    if (options.keyExpirationTime > 0) {
      signaturePacket.keyExpirationTime = options.keyExpirationTime;
      signaturePacket.keyNeverExpires = false;
    }
    await signaturePacket.sign(secretKeyPacket, dataToSign);

    return { userIdPacket, signaturePacket };
  })).then(list => {
    list.forEach(({ userIdPacket, signaturePacket }) => {
      packetlist.push(userIdPacket);
      packetlist.push(signaturePacket);
    });
  });

  if (secretSubkeyPacket) {
    const dataToSign = {};
    dataToSign.key = secretKeyPacket;
    dataToSign.bind = secretSubkeyPacket;
    const subkeySignaturePacket = new packet.Signature();
    subkeySignaturePacket.signatureType = enums.signature.subkey_binding;
    subkeySignaturePacket.publicKeyAlgorithm = options.keyType;
    subkeySignaturePacket.hashAlgorithm = await getPreferredHashAlgo(secretSubkeyPacket);
    subkeySignaturePacket.keyFlags = [enums.keyFlags.encrypt_communication | enums.keyFlags.encrypt_storage];
    if (options.keyExpirationTime > 0) {
      subkeySignaturePacket.keyExpirationTime = options.keyExpirationTime;
      subkeySignaturePacket.keyNeverExpires = false;
    }
    await subkeySignaturePacket.sign(secretKeyPacket, dataToSign);

    packetlist.push(secretSubkeyPacket);
    packetlist.push(subkeySignaturePacket);
  }

  if (!options.unlocked) {
    secretKeyPacket.clearPrivateParams();
    if (secretSubkeyPacket) {
      secretSubkeyPacket.clearPrivateParams();
    }
  }

  return new Key(packetlist);
}

/**
 * Checks if a given certificate or binding signature is revoked
 * @param  {module:packet/secret_key|
 *          module:packet/public_key}       primaryKey   The primary key packet
 * @param  {Object}                         dataToVerify The data to check
 * @param  {Array<module:packet/signature>} revocations  The revocation signatures to check
 * @param  {module:packet/signature}        signature    The certificate or signature to check
 * @param  {module:packet/public_subkey|
 *          module:packet/secret_subkey|
 *          module:packet/public_key|
 *          module:packet/secret_key} key, optional The key packet to check the signature
 * @param  {Date}                     date          Use the given date instead of the current time
 * @returns {Promise<Boolean>}                      True if the signature revokes the data
 */
async function isDataRevoked(primaryKey, dataToVerify, revocations, signature, key, date=new Date()) {
  key = key || primaryKey;
  const normDate = util.normalizeDate(date);
  const revocationKeyIds = [];
  await Promise.all(revocations.map(async function(revocationSignature) {
    if (!(config.revocations_expire && revocationSignature.isExpired(normDate)) &&
        (revocationSignature.verified || await revocationSignature.verify(key, dataToVerify))) {
      // TODO get an identifier of the revoked object instead
      revocationKeyIds.push(revocationSignature.issuerKeyId);
      return true;
    }
    return false;
  }));
  // TODO further verify that this is the signature that should be revoked
  if (signature) {
    signature.revoked = revocationKeyIds.some(keyId => keyId.equals(signature.issuerKeyId)) ? true :
      signature.revoked;
    return signature.revoked;
  }
  return revocationKeyIds.length > 0;
}

function isDataExpired(keyPacket, signature, date=new Date()) {
  const normDate = util.normalizeDate(date);
  if (normDate !== null) {
    const expirationTime = getExpirationTime(keyPacket, signature);
    return !(keyPacket.created <= normDate && normDate < expirationTime) ||
      (signature && signature.isExpired(date));
  }
  return false;
}

function getExpirationTime(keyPacket, signature) {
  let expirationTime;
  // check V3 expiration time
  if (keyPacket.version === 3 && keyPacket.expirationTimeV3 !== 0) {
    expirationTime = keyPacket.created.getTime() + keyPacket.expirationTimeV3*24*3600*1000;
  }
  // check V4 expiration time
  if (keyPacket.version === 4 && signature.keyNeverExpires === false) {
    expirationTime = signature.created.getTime() + signature.keyExpirationTime*1000;
  }
  return expirationTime ? new Date(expirationTime) : Infinity;
}

/**
 * Returns the preferred signature hash algorithm of a key
 * @param  {object} key
 * @returns {String}
 */
export async function getPreferredHashAlgo(key) {
  let hash_algo = config.prefer_hash_algorithm;
  let pref_algo = hash_algo;
  if (key instanceof Key) {
    const primaryUser = await key.getPrimaryUser();
    if (primaryUser && primaryUser.selfCertification.preferredHashAlgorithms) {
      [pref_algo] = primaryUser.selfCertification.preferredHashAlgorithms;
      hash_algo = crypto.hash.getHashByteLength(hash_algo) <= crypto.hash.getHashByteLength(pref_algo) ?
        pref_algo : hash_algo;
    }
    // disable expiration checks
    key = key.getSigningKeyPacket(undefined, null);
  }
  switch (Object.getPrototypeOf(key)) {
    case packet.SecretKey.prototype:
    case packet.PublicKey.prototype:
    case packet.SecretSubkey.prototype:
    case packet.PublicSubkey.prototype:
      switch (key.algorithm) {
        case 'ecdh':
        case 'ecdsa':
        case 'eddsa':
          pref_algo = crypto.publicKey.elliptic.getPreferredHashAlgo(key.params[0]);
      }
  }
  return crypto.hash.getHashByteLength(hash_algo) <= crypto.hash.getHashByteLength(pref_algo) ?
    pref_algo : hash_algo;
}

/**
 * Returns the preferred symmetric algorithm for a set of keys
 * @param  {Array<module:key~Key>} keys Set of keys
 * @returns {enums.symmetric}   Preferred symmetric algorithm
 */
export async function getPreferredSymAlgo(keys) {
  const prioMap = {};
  await Promise.all(keys.map(async function(key) {
    const primaryUser = await key.getPrimaryUser();
    if (!primaryUser || !primaryUser.selfCertification.preferredSymmetricAlgorithms) {
      return config.encryption_cipher;
    }
    primaryUser.selfCertification.preferredSymmetricAlgorithms.forEach(function(algo, index) {
      const entry = prioMap[algo] || (prioMap[algo] = { prio: 0, count: 0, algo: algo });
      entry.prio += 64 >> index;
      entry.count++;
    });
  }));
  let prefAlgo = { prio: 0, algo: config.encryption_cipher };
  for (const algo in prioMap) {
    try {
      if (algo !== enums.symmetric.plaintext &&
          algo !== enums.symmetric.idea && // not implemented
          enums.read(enums.symmetric, algo) && // known algorithm
          prioMap[algo].count === keys.length && // available for all keys
          prioMap[algo].prio > prefAlgo.prio) {
        prefAlgo = prioMap[algo];
      }
    } catch (e) {}
  }
  return prefAlgo.algo;
}
