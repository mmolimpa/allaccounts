/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */


function UserId(encUser, encTld) {
  console.assert(typeof encUser === "string", "invalid user =", encUser);
  console.assert(typeof encTld  === "string", "invalid loginTld =", encTld);
  this._encName = encUser;
  this._encTld = encTld;
}


UserId.prototype = {

  toString: function() {
    return JSON.stringify(this);
  },


  toJSON: function() { // indirectly called by toString
    return {
      "encodedUser":this.encodedName, "encodedTld":this.encodedTld,
      "x-user": this.plainName + " " + this.plainTld
    };
  },


  equals: function(user) {
    return (user._encName === this._encName) && (user._encTld  === this._encTld);
  },


  toNewAccount: function() {
    return this.isNewAccount ? this : new UserId(UserUtils.NewAccount, this._encTld);
  },


  isTldValid: function(encTld) {
    console.assert(LoginDB.isLoggedIn(encTld), "not logged in");
    var x = LoginDB._loggedInTabs[encTld];
    return x.indexOf(this._encTld) > -1;
  },


  get isNewAccount() {
    return this._encName === UserUtils.NewAccount;
  },


  get plainTld() {
    return StringEncoding.decode(this._encTld);
  },


  get plainName() {
    return StringEncoding.decode(this._encName);
  },


  get encodedTld() {
    return this._encTld;
  },


  get encodedName() {
    return this._encName;
  }
};



function DocumentUser(user, plainDocTld, topInnerId) {
  console.assert(typeof user        === "object", "invalid user =", user);
  console.assert(typeof plainDocTld === "string", "invalid plainDocTld =", plainDocTld);
  console.assert(typeof topInnerId  === "number", "invalid topInnerId =", topInnerId);
  console.assert(getTldFromHost(plainDocTld) === plainDocTld, "plainDocTld is not a TLD", plainDocTld);

  this._user = user; // may be null (anon doc)
  this._topInnerId = topInnerId;
  this._ownerDocTld = plainDocTld;
  this._ownerEncodedDocTld = StringEncoding.encode(plainDocTld);


  if (topInnerId === WindowUtils.NO_WINDOW) {
    // top request: topInnerId is undefined (it won't be used anyway)
    this._topDocTld = plainDocTld;
    this._1stPartyTldEncoded = StringEncoding.encode(plainDocTld);
    return;
  }

  var topData = WinMap.getInnerWindowFromId(topInnerId);
  console.assert(topData.isTop, "not a top id", user, plainDocTld, topInnerId);
  this._topDocTld = topData.eTld !== null
                  ? topData.eTld
                  : getTldForUnsupportedScheme(topData.originalUri); // "about:"
  this._1stPartyTldEncoded = StringEncoding.encode(this._topDocTld);
}


DocumentUser.prototype = {
  _user: null,
  _topInnerId: 0,
  _topDocTld: null, // _1stPartyTldPlain
  _1stPartyTldEncoded: null,
  _ownerDocTld: null,
  _ownerEncodedDocTld: null,


  toString: function() {
    return JSON.stringify(this);
  },


  toJSON: function() {
    return {
      "x-topJar":   this._topDocTld,
      "x-ownerTld": this._ownerDocTld,
      "topInnerId": this._topInnerId,
      "x-jar-host": this.wrapHost(this._ownerDocTld),
      "x-user": this.user ? (this.user.plainName + " " + this.user.plainTld) : "null"
    };
  },


  get topDocId() {
    console.assert(this._topInnerId !== WindowUtils.NO_WINDOW, "_topInnerId is not valid");
    return this._topInnerId;
  },


  is1stParty: function(tld) {
    console.assert(getTldFromHost(tld) === tld, "tld is not a TLD", tld);
    return tld === this._topDocTld;
  },


  get user() {
    return this._user;
  },


  get ownerTld() {
    return this._ownerDocTld;
  },


  get encodedDocTld() {
    return this._ownerEncodedDocTld;
  },


  findHostUser: function(hostTld) {
    if (hostTld === this.ownerTld) {
      return this.user; // valid, same top id - may be null
    }

    // different host: signed in or anon?
    var hostUri = Services.io.newURI("http://" + hostTld, null, null);
    var hostDocUser = WinMap.findUser(hostUri, this.topDocId);
    return hostDocUser === null ? null : hostDocUser.user;
  },


  wrapUri: function(uri) {
    var u = uri.clone();
    u.host = this.wrapHost(uri.host);
    return u;
  },


  wrapHost: function(host) {
    console.assert(typeof host === "string", "host should be a string", host);
    var hostTld = getTldFromHost(host);
    var hostUsr = this.findHostUser(hostTld);

    // host: anon.com
    if (hostUsr === null) {
      if (this.is1stParty(hostTld)) {
        // anon & 1st-party
        return host;
      } else {
        // anon & 3rd-party
        return this._user === null ? this._wrap1stPartyAnon(host)
                                   : this._wrap1stPartyAndWindowUser(host, this._user);
      }
    }

    // host: facebook.com
    if (hostUsr.isNewAccount) {
      return this.is1stParty(hostTld) ? this._wrapHostUser(host, hostUsr, hostTld) // NewAccount
                                      : this._wrap1stPartyAnon(host);
    } else {
      return this._wrapHostUser(host, hostUsr, hostTld);
    }
  },


  _wrap1stPartyAnon: function(host) {
    return host + "." + this._1stPartyTldEncoded + ".${INTERNAL_DOMAIN_SUFFIX_ANON}";
  },


  _wrap1stPartyAndWindowUser: function(host, usr) {
    return host + "." + this._1stPartyTldEncoded       + "-" + usr.encodedName + "-" + usr.encodedTld + ".${INTERNAL_DOMAIN_SUFFIX_ANON}";
  },


  _wrapHostUser: function(host, usr, hostTld) {
    // We need to use tld(host) ==> otherwise, we couldn't (easily) locate the cookie for different subdomains
    return host + "." + StringEncoding.encode(hostTld) + "-" + usr.encodedName + "-" + usr.encodedTld + ".${INTERNAL_DOMAIN_SUFFIX_LOGGEDIN}";
    //TODO NewAccount return host + "." + StringEncoding.encode(hostTld) + "-" usr.encodedTld + ".${INTERNAL_DOMAIN_SUFFIX_LOGGEDIN}";
  }

};



var UserUtils = {

  NewAccount: "",

  equalsUser: function(user1, user2) {
    if ((user1 === null) && (user2 === null)) {
      return true;
    }
    if ((user1 !== null) && (user2 !== null)) {
      return user1.equals(user2);
    }
    return false;
  },


  _getLabels: function(internalHost) {
    if (hasRootDomain("${INTERNAL_DOMAIN_SUFFIX_LOGGEDIN}", internalHost) === false) {
      return null;
    }

    // internalHost = .youtube.com.[youtube.com]-[user@foo]-[google.com].multifox-auth-X
    // [0] multifox-auth-X
    // [1] [youtube.com]-[user@gmail.com]-[google.com]
    // [2] com
    // [3] youtube
    // [4] (empty?)
    var labels = internalHost.split(".").reverse();
    console.assert(labels[0] === "${INTERNAL_DOMAIN_SUFFIX_LOGGEDIN}", "_getLabels", internalHost);
    return labels;
  },


  // returns ".example.com", "example.com" ...
  getRealHost: function(internalHost) {
    var labels = this._getLabels(internalHost);
    return labels === null ? null // normal host
                           : labels.slice(2).reverse().join(".");
  },


  getEncodedLogin: function(internalHost) {
    var labels = this._getLabels(internalHost);
    if (labels === null) {
      return null;
    }
    var strip = labels[1].split("-");
    if (strip.length !== 3) {
      return null;
    }
    return {
      rawData:   labels[1],
      tabTld:    strip[0], // TODO could be replaced by labels[3]+[4]...
      loginUser: strip[1],
      loginTld:  strip[2]
    };
  }

};
