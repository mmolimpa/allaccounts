/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */


var PREF_COOKIE_BEHAVIOR = "network.cookie.cookieBehavior";

var Cookies = {
  _service: null,
  _prefs: null,

  start: function() {
    this._service = Cc["@mozilla.org/cookieService;1"].getService().QueryInterface(Ci.nsICookieService);
    this._prefs = Services.prefs;
    this._prefListener.behavior = this._prefs.getIntPref(PREF_COOKIE_BEHAVIOR);
    this._prefs.addObserver(PREF_COOKIE_BEHAVIOR, this._prefListener, false);
  },

  stop: function() {
    this._service = null;
    this._prefs.removeObserver(PREF_COOKIE_BEHAVIOR, this._prefListener);
    this._prefs = null;
  },


  _prefListener: {
    behavior: -1,

    // nsIObserver
    // topic=nsPref:changed data=network.cookie.cookieBehavior
    observe: function(subject, topic, data) {
      this.behavior = subject
                      .QueryInterface(Ci.nsIPrefBranch)
                      .getIntPref(PREF_COOKIE_BEHAVIOR);
      console.log("pref! " + subject + topic + data + this.behavior);
    }

  },

  setCookie: function(docUser, originalUri, originalCookie, fromJs) {
    var val = this._convertCookieDomain(originalUri.host, originalCookie, docUser);
    var uri = docUser.wrapUri(originalUri);

    if (this._prefListener.behavior === 0) {
      this._setCookie(fromJs, uri, val);
      return;
    }

    var p = this._prefs;
    p.removeObserver(PREF_COOKIE_BEHAVIOR, this._prefListener);
    p.setIntPref(PREF_COOKIE_BEHAVIOR, 0);
    this._setCookie(fromJs, uri, val);
    p.setIntPref(PREF_COOKIE_BEHAVIOR, this._prefListener.behavior);
    p.addObserver(PREF_COOKIE_BEHAVIOR, this._prefListener, false);
  },

  getCookie: function(fromJs, uri) {

    if (this._prefListener.behavior === 0) {
      return this._getCookie(fromJs, uri);
    }

    var p = this._prefs;
    p.removeObserver(PREF_COOKIE_BEHAVIOR, this._prefListener);
    p.setIntPref(PREF_COOKIE_BEHAVIOR, 0);
    var cookie = this._getCookie(fromJs, uri);
    p.setIntPref(PREF_COOKIE_BEHAVIOR, this._prefListener.behavior);
    p.addObserver(PREF_COOKIE_BEHAVIOR, this._prefListener, false);
    return cookie;
  },

  _setCookie: function(fromJs, uri, val) {
    if (fromJs) {
      this._service.setCookieString(uri,
                                    null,
                                    val,
                                    null);
    } else {
      //setCookieString doesn't work for httponly cookies
      this._service.setCookieStringFromHttp(uri,   // aURI
                                            null,  // aFirstURI
                                            null,  // aPrompt
                                            val,   // aCookie
                                            null,  // aServerTime
                                            null); // aChannel
    }
  },

  _getCookie: function(fromJs, uri) {
    if (fromJs) {
      return this._service.getCookieString(uri,
                                           null);
    } else {
      return this._service.getCookieStringFromHttp(uri,   // aURI
                                                   null,  // aFirstURI
                                                   null); // aChannel
    }
  },


  _convertCookieDomain: function(host, cookieHeader, docUser) {
    var objCookies = new SetCookieParser(cookieHeader);
    var len = objCookies.length;
    var newCookies = new Array(len);

    for (var idx = 0; idx < len; idx++) {
      var myCookie = objCookies.getCookieByIndex(idx);
      if (myCookie.hasMeta("domain")) {
        var realDomain = myCookie.getMeta("domain");
        myCookie.defineMeta("domain", docUser.wrapHost(realDomain));
      } else {
        realDomain = host;
      }

      if (docUser.isAnonWrap(realDomain)) {
        // 3rd-party
        if (this._shouldConvertToSession(myCookie)) {
          // avoid past dates or short expiry
          myCookie.removeMeta("expires");
          myCookie.removeMeta("max-age");
        }
      }
      newCookies[idx] = myCookie.toString();
    }

    return newCookies.join("\n");
  },


  _SHORT_EXPIRY_SEC: 28800,
  _SHORT_EXPIRY_MS:  28800 * 1000, // 8h

  _shouldConvertToSession: function(myCookie) {
    if (myCookie.hasMeta("max-age")) {
      // ignoring expires
      var max = parseInt(myCookie.getMeta("max-age"), 10);
      return Number.isNaN(max)
             ? true
             : max > this._SHORT_EXPIRY_SEC;
    }

    if (myCookie.hasMeta("expires")) {
      var expires = myCookie.getExpires();
      return Number.isNaN(expires)
             ? true
             : (expires - Date.now()) > this._SHORT_EXPIRY_MS;
    }

    return false;
  }

};



function SetCookieParser(cookieHeader) {
  this._allCookies = [];
  var lines = this._toLines(cookieHeader);
  for (var idx = 0, len = lines.length; idx < len; idx++) {
    this._parseLine(lines[idx]);
  }
}

SetCookieParser.prototype = {
  _allCookies: null,


  _toLines: function(txt) {
    return txt.split(/\r\n|\r|\n/);
  },


  _parseLine: function(rawSetCookie) {
    var items = rawSetCookie.split(";");
    var unit = new CookieBuilder(items[0]); // [0] "foo=bar"
    var len = items.length;
    if (len > 1) {
      for (var idx = 1; idx < len; idx++) {
        var pair = this._splitValueName(items[idx]);
        unit.defineMeta(pair[0], pair[1]);
      }
    }

    this._allCookies.push(unit);
  },


  _splitValueName: function(cookie) {
    var idx = cookie.indexOf("=");
    if (idx === -1) {
      return [cookie, null];
    }

    // "a=bcd=e".split("=",2) returns [a,bcd]
    //   "abcde".split("=",2) returns [abcde]

    // MY =
    // 012^-----idx=3 length=4

    // MY =a:1=6
    // 012^-----idx=3 length=9

    var nameValue = [cookie.substring(0, idx), ""];
    idx++;
    if (idx < cookie.length) {
      nameValue[1] = cookie.substring(idx);
    }

    return nameValue;
  },


  get length() {
    return this._allCookies.length;
  },

  getCookieByIndex: function(idx) {
    return this._allCookies[idx];
  }
};


function CookieBuilder(cookie) {
  this._cookie = cookie;
  this._meta = Object.create(null);
}

CookieBuilder.prototype = {
  _cookie: null,
  _meta: null,


  removeMeta: function(name) {
    delete this._meta[name];
  },


  hasMeta: function(name) {
    return name in this._meta;
  },


  getMeta: function(name) {
    return name in this._meta ? this._meta[name] : null;
  },


  getExpires: function() {
    console.assert(this.hasMeta("expires"), "expires not defined");
    var dateExp1 = this.getMeta("expires");

    // Date.parse doesn't recognize "31-Oct-2015"
    var dateExp2 = dateExp1.replace("-", "  ", "g");

    var dl = dateExp2.length - dateExp1.length;
    if ((dl !== 0) && (dl !== 2)) {
      // bug: there are dashes we don't expect
      return Number.NaN;
    }

    // BUG 31-Oct-15 => NaN
    return Date.parse(dateExp2);
  },


  defineMeta: function(name, val) {
    console.assert(name !== null, "_splitValueName doesn't return null names");
    name = name.trim();
    if (name.length === 0) {
      return; // Set-Cookie:foo=bar;;;
    }
    // val=null ==> name=HttpOnly, secure etc
    this._meta[name.toLowerCase()] = val;
  },


  toString: function() {
    var buf = [this._cookie];
    for (var name in this._meta) {
      var val = this._meta[name];
      buf.push(val === null ? name : name + "=" + val);
    }
    return buf.join(";");
  }
};
