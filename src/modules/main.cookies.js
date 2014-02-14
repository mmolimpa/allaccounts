/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


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
    var val = convertCookieDomain(originalUri.host, originalCookie, docUser);
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
  }
};


function convertCookieDomain(host, cookieHeader, docUser) {
  var objCookies = new SetCookieParser(cookieHeader);
  var len = objCookies.length;
  var newCookies = new Array(len);

  for (var idx = 0; idx < len; idx++) {
    var myCookie = objCookies.getCookieByIndex(idx);
    var realDomain = myCookie.getStringProperty("domain");
    if (realDomain.length > 0) {
      myCookie.defineMeta("domain", docUser.wrapHost(realDomain));
    } else {
      realDomain = host;
    }

    if (myCookie.getStringProperty("expires").length > 0) {
      if (docUser.is1stParty(getTldFromHost(realDomain)) === false) {
        myCookie.defineMeta("expires", "");
      }
    }
    newCookies[idx] = myCookie.toHeaderLine();
  }

  return newCookies.join("\n");//objCookies.toHeader();
}


function toLines(txt) {
  return txt.split(/\r\n|\r|\n/);
}


function SetCookieParser(cookieHeader) {
  this._allCookies = [];
  if (cookieHeader !== null) {
    var lines = toLines(cookieHeader);
    var len = lines.length;
    for (var idx = 0; idx < len; idx++) {
      this._parseLineSetCookie(lines[idx]);
    }
  }
}

SetCookieParser.prototype = {
  _allCookies: null,

  _parseLineSetCookie: function(headerLine) {
    var unit = new CookieBuilder();
    var items = headerLine.split(";");

    for (var idx = 0, len = items.length; idx < len; idx++) {
      var pair = this._splitValueName(items[idx]);
      var name = pair[0];
      var value = pair[1]; // null ==> name=HttpOnly, secure etc

      if (idx === 0) {
        if (name.length > 0 && value !== null) {
          unit.defineValue(name, value);
        } else {
          console.trace("_allCookies invalid " + name + "/" + value + "/" + headerLine);
          break;
        }
      } else {
        unit.defineMeta(name, value);
      }
    }

    this._allCookies.push(unit);
  },


  _splitValueName: function(cookie) {
    var idx = cookie.indexOf("=");
    if (idx === -1) {
      return [cookie.trim(), null];
    }

    // "a=bcd=e".split("=",2) returns [a,bcd]
    //   "abcde".split("=",2) returns [abcde]

    // MY =
    // 012^-----idx=3 length=4

    // MY =a:1=6
    // 012^-----idx=3 length=9

    var pair = ["", ""];
    pair[0] = cookie.substring(0, idx).trim(); // TODO ???
    idx++;
    if (idx < cookie.length) {
      pair[1] = cookie.substring(idx);
    }

    return pair;
  },


  /*
  toHeader: function() {
    var allCookies = this._allCookies;
    var len = allCookies.length;
    //var buf = [];
    var buf = new Array(len);
    for (var idx = 0; idx < len; idx++) {
      //if (allCookies[idx].value !== null) {
      buf[idx] = allCookies[idx].toHeaderLine();
      //}
    }
    return this.m_hasMeta ? buf.join("\n") : buf.join(";");
  },
  */

  get length() {
    return this._allCookies.length;
  },

  getCookieByIndex: function(idx) {
    return this._allCookies[idx];
  }
};


function CookieBuilder() {
  this._data = Object.create(null); // instance value
}

CookieBuilder.prototype = {
  _data: null,

  get name() {
    var rv = this._data["_name"];
    return rv ? rv : "";
  },

  get value() {
    var rv = this._data["_value"];
    return rv ? rv : "";
  },

  defineValue: function(name, val) {
    this._data["_name"] = name;
    this._data["_value"] = val;
  },

  //"secure":
  //"httponly":
  _hasBooleanProperty: function(name) {
    //name = name.toLowerCase();
    return name in this._data;
  },

  //"expires":
  //"domain":
  //"path":
  getStringProperty: function(name) {
    var rv = this._data[name];
    return rv ? rv : "";
    //return rv || "";
  },

  defineMeta: function(name, val) {
    name = name.toLowerCase();
    switch (name) {
      case "expires":
      case "domain":
      case "path":
      case "secure":
      case "httponly":
        this._data[name] = val;
        break;
    }
  },

  toHeaderLine: function() {//toString()
    var buf = [this.name + "=" + this.value];
    var props;

    props = ["secure", "httponly"];
    for (var idx = props.length - 1; idx > -1; idx--) {
      var propName = props[idx];
      if (this._hasBooleanProperty(propName)) {
        buf.push(propName.toUpperCase());
      }
    }

    props = ["expires", "path", "domain"];
    for (var idx = props.length - 1; idx > -1; idx--) {
      var propName = props[idx];
      var val = this.getStringProperty(propName);
      if (val.length > 0) {
        buf.push(propName.toUpperCase() + "=" + val);
      }
    }

    return buf.join(";");
  }
};
