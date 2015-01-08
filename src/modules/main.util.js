/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */


var StringEncoding = {
  _conv: null,

  init: function() {
    this._conv = Cc["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Ci.nsIScriptableUnicodeConverter);
    this._conv.charset = "UTF-8";
  },


  encode: function(str) {
    // chars are > 8bits ("€".charCodeAt(0) = 8364)
    var bin = this._conv.convertToByteArray(str, {});
    var len = bin.length;
    var hex = new Array(len * 2);

    var j = 0;
    var alphabet = "abcdefghijklmnop";

    for (var idx = 0; idx < len; idx++) {
      var myByte = bin[idx];
      var nibble1 = (myByte & 0xf0) >> 4;
      var nibble0 =  myByte & 0x0f;
      hex[j++] = alphabet[nibble1];
      hex[j++] = alphabet[nibble0];
    }

    return hex.join("");
  },


  decode: function(hex) {
    console.assert(typeof hex === "string", "StringEncoding.decode val =", hex);
    var len = hex.length / 2;
    if (len === 0) {
      return "";
    }

    console.assert((len % 1) === 0, "invalid hex string:", hex);
    var bin = new Array(len);

    var j = 0;
    var offset = 97; // "abcdefghijklmnop".charCodeAt(0)=97

    for (var idx = 0; idx < len; idx++) {
      var nibble1 = hex.charCodeAt(j++) - offset;
      var nibble0 = hex.charCodeAt(j++) - offset;
      bin[idx] = (nibble1 << 4) | nibble0;
    }

    return this._conv.convertFromByteArray(bin, bin.length);
  }
};


function findTabById(tabId) { // TODO keep a weakref list of tabs tabList[tabId]
  var enumWin = UIUtils.getWindowEnumerator();
  while (enumWin.hasMoreElements()) {
    var tabList = UIUtils.getTabList(enumWin.getNext());
    for (var idx = tabList.length - 1; idx > -1; idx--) {
      if (getTabIdFromBrowser(tabList[idx].linkedBrowser) === tabId) {
        return tabList[idx];
      }
    }
  }
  return null;
}


function getTabIdFromBrowser(browser) {
  return getDOMUtils(browser.contentWindow).outerWindowID;
}


function getCurrentTopInnerId(tab) {
  var win = tab.linkedBrowser.contentWindow;
  return getDOMUtils(win).currentInnerWindowID;
}


function getTldForUnsupportedScheme(uri) {
  return uri.prePath;
}


function isSupportedScheme(scheme) { // TODO check nsIStandardURL
  return (scheme === "http") || (scheme === "https") || (scheme === "http:") || (scheme === "https:");
}


function getDOMUtils(win) {
  console.assert(typeof win === "object", "win should be an object", win);
  return win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
}


function isTopWindow(win) {
  return win === win.top;
}


function getTldFromUri(uri) {
  return isSupportedScheme(uri.scheme) ? getTldFromHost(uri.host) : null;
}


function getTldFromHost(hostname) {
  console.assert(typeof hostname === "string", "invalid hostname argument");
  console.assert(hostname.length > 0, "empty hostname");
  try {
    return Services.eTLD.getBaseDomainFromHost(hostname);
  } catch (ex) {
    var Cr = Components.results;
    switch (ex.result) {
      case Cr.NS_ERROR_INSUFFICIENT_DOMAIN_LEVELS: // "localhost"?
      case Cr.NS_ERROR_HOST_IS_IP_ADDRESS:         // literal ipv6? 3ffe:2a00:100:7031::1
        return hostname;                           // literal ipv4? 127.0.0.1, 0x7f.0.0.1
      case Cr.NS_ERROR_ILLEGAL_VALUE:              // ".foo.tld"?
        break;
      default:
        console.log(ex, hostname);                 // ???
        return hostname;
    }
  }

  // NS_ERROR_ILLEGAL_VALUE
  var firstDot = hostname.indexOf(".");
  //  "local.host" ==> >0 OK
  // ".localhost"  ==>  0 exception
  // ".loc.al.ho.st" ==> 0 exception
  //  "localhost" ==> -1 exception
  if (firstDot === -1) {
    console.log("NS_ERROR_ILLEGAL_VALUE firstDot=-1", hostname);
    return hostname; // ???
  }

  // firstDot=0 ("...local.host") (e.g. from cookies)
  // OBS "..local.host" returns "localhost"
  if (firstDot === 0) {
    return getTldFromHost(hostname.substr(1)); // recursive
  }
  return hostname;
}


function hasRootDomain(domain, host) {
  if (host === domain) {
    return true;
  }

  var idx = host.lastIndexOf(domain);
  if (idx === -1) {
    return false;
  }

  if ((host.length - domain.length) === idx) {
    return host[idx - 1] === ".";
  }

  return false;
}


function enableErrorMsg(browser, innerId, notSupportedFeature, err = undefined) {
  var innerWin = WinMap.getInnerWindowFromId(innerId);
  var msg = ["ERROR: " + notSupportedFeature];
  msg.push(JSON.stringify(innerWin, null, 2));

  if (notSupportedFeature === "sandbox") {
    var entry = {
      __proto__: null,
      type: "sandbox-error",
      "inner-id": innerWin.innerId,
      "error": err
    };
    if (innerWin.isTop === false) {
      entry.isFrame = true;
    }
    WinMap.addToOuterHistory(entry, innerWin.outerId);
  }

  if (err !== undefined) {
    msg.push("Desc: " + err);
  }
  console.log(msg.join("\n"));

  var tab = UIUtils.getLinkedTabFromBrowser(browser);
  tab.setAttribute("${BASE_DOM_ID}-tab-error", notSupportedFeature);
  updateUIAsync(browser, true);
}


function enableErrorMsgLocal(notSupportedFeature, win) {
  enableErrorMsg(UIUtils.getParentBrowser(win),
                 getDOMUtils(win).currentInnerWindowID,
                 notSupportedFeature);
}


var util = {
  loadSubScript: function(path) {
    var ns = {};
    Services.scriptloader.loadSubScript(path, ns);
    return ns;
  },

  reloadTab: function(browser) {
    if (isSupportedScheme(browser.currentURI.scheme) === false) {
      browser.reload(); // about:
      return;
    }

    var channel = browser.contentWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIWebNavigation).QueryInterface(Ci.nsIDocShell)
                    .currentDocumentChannel.QueryInterface(Ci.nsIHttpChannel);

    if (channel.requestMethod === "POST") {
      browser.loadURI(browser.currentURI.spec); // avoid POST prompt
    } else {
      browser.reload();
    }
  },

  getText: function(name) {
    return this._getTextCore("general.properties", name, arguments, 1);
  },

  getTextFrom: function(filename, name) {
    return this._getTextCore(filename, name, arguments, 2);
  },

  _getTextCore: function(filename, name, args, startAt) {
    var bundle = Services.strings.createBundle("${PATH_LOCALE}/" + filename);

    if (args.length === startAt) {
      return bundle.GetStringFromName(name);
    } else {
      var args2 = Array.prototype.slice.call(args, startAt, args.length);
      console.assert(args2.length > 0, "_getTextCore");
      return bundle.formatStringFromName(name, args2, args2.length)
    }
  }
};



function debugData() {
  var logins = Object.create(null);
  var enumWin = UIUtils.getWindowEnumerator();
  var loginsAttr = "${PERSIST_TAB_LOGINS}";
  while (enumWin.hasMoreElements()) {
    var tabList = UIUtils.getTabList(enumWin.getNext());
    for (var idx = tabList.length - 1; idx > -1; idx--) {
      var tab = tabList[idx];
      if (tab.hasAttribute(loginsAttr)) {
        // TODO compare attr & WinMap
        logins[getTabIdFromBrowser(tab.linkedBrowser)] = JSON.parse(tab.getAttribute(loginsAttr));
      }
    }
  }

  var sep = "\n--------------------";
  Services.console.logStringMessage(
    "\nLoginDB._auths: " + JSON.stringify(LoginDB._auths, null, 2) +
    sep +
    "\nLoginDB._loggedInTabs: " + JSON.stringify(LoginDB._loggedInTabs, null, 2) +
    sep +
    "\nLoginDB._tldCookieCounter: " +
    JSON.stringify(LoginDB._tldCookieCounter, null, 2) +
    sep +
    "\nPersisted Logins (from " + loginsAttr + "):" +
    JSON.stringify(logins, null, 2) +
    sep +
    "\nUserState._thirdPartyGlobalDefault: " +
    JSON.stringify(UserState._thirdPartyGlobalDefault, null, 2) +
    sep +
    "\nWinMap:\n" +
    DebugWinMap.toString() + "\n\n\n" +
    sep +
    "\nWinMap._outer, len=" + Object.keys(WinMap._outer).length + "\n" +
    JSON.stringify(WinMap._outer, null, 2) +
    sep +
    "\nWinMap._inner, len=" + Object.keys(WinMap._inner).length + "\n" +
    JSON.stringify(WinMap._inner, null, 2));
}
