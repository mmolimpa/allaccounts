/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var SubmitObserver = {
  start: function() {
    Services.obs.addObserver(this, "earlyformsubmit", false);
  },

  stop: function() {
    Services.obs.removeObserver(this, "earlyformsubmit");
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFormSubmitObserver]),

  notify: function (form, win, actionURI, cancelSubmit) {
    console.assert(form.ownerDocument.defaultView === win, "form.ownerDocument.defaultView != win");
    this._notify(form, win);
    return true;
  },

  _notify: function(form, win) {
    if (form.method.toUpperCase() !== "POST") {
      return;
    }

    var innerWin = WinMap.getInnerWindowFromObj(win);
    if (innerWin.documentElementInserted === false) {
      console.trace("earlyformsubmit", form, win, innerWin);
      return;
    }
    if (isSupportedScheme(innerWin.originalUri.scheme) === false) {
      return;
    }

    if (innerWin.isInsideTab === false) {
      return null; // chrome form?
    }

    if (countPasswordFields(form, true) === 0) {
      return; // no password provided => not a login form
    }

    var browser = UIUtils.getParentBrowser(win);
    if (UIUtils.isPrivateWindow(win)) {
      // obs: do not call WinMap.loginSubmitted for private windows
      // they should not be registered by WinMap
      showPrivateWinMsg(browser);
      return true;
    }

    var username = findUserName(form);
    if (username === null) {
      console.log("SubmitObserver: NOP, username not found, confirm pw form?");
      WinMap.loginSubmitted(innerWin, "pw", null); // just add to outer history
      return; // TODO username = "random" or error message (icon);
    }

    if (skipLogin(innerWin.eTld)) {
      WinMap.loginSubmitted(innerWin, "submit-skip", null);
      return;
    }

    var topWin = innerWin.topWindow;
    var currentDocUser = WinMap.findUser(innerWin.originalUri, topWin.innerId, topWin.outerId);

    var userId = new UserId(StringEncoding.encode(username),
                            StringEncoding.encode(innerWin.eTld));
    var docUser = new DocumentUser(userId, innerWin.eTld, topWin.innerId, topWin.outerId);
    WinMap.loginSubmitted(innerWin, "login", docUser);

    if (currentDocUser === null) {
      // TODO apply sandbox right now (all iframes)
      // TODO clear 3rd party?
      // TODO copy cookies from topData.thirdPartyUsers
      // Two new users: NewAccount & userId
      var newUser = new DocumentUser(docUser.user.toNewAccount(), innerWin.eTld, topWin.innerId, topWin.outerId);
      copyData_fromDefault(innerWin.eTld, docUser); // copy current cookies to new user

      // currently useless, "new account" command will remove all cookies
      // BUG first login? default cookies need to be copied (other tabs will be moved to NewAccount, they could be using default cookies)
      //copyData_fromDefault(innerWin.eTld, newUser); // copy current cookies to NewAccount
    } else {
      copyDataToAnotherUser(innerWin.eTld, docUser, currentDocUser);
    }
    var tab = UIUtils.getLinkedTabFromBrowser(browser);
    tab.setAttribute("${BASE_DOM_ID}-logging-in", "true"); // activate transition
  }

};


function showPrivateWinMsg(browser) {
  var val = "${BASE_DOM_ID}-privwin";
  var msg = util.getText("infobar.private-window.label", "${EXT_NAME}");
  var icon = "chrome://global/skin/icons/information-16.png";

  var barBox = browser.getTabBrowser().getNotificationBox(browser);
  barBox.appendNotification(msg, val, icon, barBox.PRIORITY_WARNING_MEDIUM)
        .persistence = 1;
}


function copyDataToAnotherUser(tabTld, newLogin, prevLogin) {
  console.assert(prevLogin.user.encodedTld === newLogin.user.encodedTld, "copyDataToAnotherUser tld"); // BUG encodedTld actually could be different
  console.assert(tabTld === prevLogin._ownerDocTld, "anon");
  if (prevLogin.user.equals(newLogin.user)) {
    return; // same user, do nothing
  }

  var tld = prevLogin.wrapHost(tabTld);
  // don't remove data from current user, it may contain data used by other apps
  // or by the same app in a different tab
  // some cookies may be unrelated to this login
  var all = getAllCookiesFromHost(tld); // BUG ignore anon cookies?
  //var all = removeTldData_cookies(tld);

  console.log("copyDataToAnotherUser", tld, tabTld, all.length, "cookies.", prevLogin.toString(), newLogin.toString());
  var cookie;
  var realHost;
  for (var idx = all.length - 1; idx > -1; idx--) {
    cookie = all[idx];
    realHost = UserUtils.getRealHost(cookie.host);
    if (realHost !== null) {
      copyCookieToNewHost(cookie, newLogin.wrapHost(realHost));
    }
  }

  //var all2 = removeTldData_LS(tld);
}


// isolate cookies from domain
function copyData_fromDefault(domain, docUser) { // BUG if tabLogin.plainUser="" -> NewAccount // TODO domain=>tld
  var all = getAllCookiesFromHost(domain);
  //var all = removeTldData_cookies(domain);

  console.log("copyData_fromDefault 1", domain, docUser, "cookies:", all.length);
  var cookie;
  for (var idx = all.length - 1; idx > -1; idx--) {
    cookie = all[idx];
    copyCookieToNewHost(cookie, docUser.wrapHost(cookie.host));
  }

  console.log("copyData_fromDefault 3");
  var all2 = removeTldData_LS(domain);
  console.log("/copyData_fromDefault");
}


function countPasswordFields(form, populatedOnly) {
  var qty = 0;
  var all = form.elements;
  var INPUT = Ci.nsIDOMHTMLInputElement;
  for (var idx = all.length - 1; idx > -1; idx--) {
    var elem = all[idx];
    if ((elem instanceof INPUT) && (elem.type === "password")) {
      if (isElementVisible(elem) && (elem.readOnly === false)) {
        if (populatedOnly && (elem.value.trim().length === 0)) {
          continue;
        }
        qty++;
      }
    }
  }
  return qty;
}


function findUserName(form) {
  console.log("findUserName");
  var INPUT = Ci.nsIDOMHTMLInputElement;
  var lastTextField = null;
  var all = form.elements;
  var elem;

  for (var idx = 0, len = all.length; idx < len; idx++) {
    elem = all[idx];
    if ((elem instanceof INPUT) === false) {
      continue;
    }
    switch (elem.type) {
      case "text":
      case "email":
      case "url":
      case "tel":
      case "number":
      case "password":
        break;
      default:
        continue;
    }
    if (elem.readOnly) {
      console.log("findUserName", "readOnly", elem.name);
      continue;
    }
    if ((elem.value.trim().length === 0) || isElementVisible(elem) === false) {
      // ignore empty/hidden fields
      console.log("findUserName", "element ignored", elem.name);
      continue;
    }
    if (elem.type === "password") {
      if (lastTextField !== null) {
        return lastTextField;
      }
    } else {
      lastTextField = elem.value;
      console.log("findUserName", "found", lastTextField);
    }
  }
  return lastTextField;
}


// https://bugzilla.mozilla.org/show_bug.cgi?id=595451#c10
function isElementVisible(elem) {
  return elem.getClientRects().length > 0;
}


function skipLogin(tldDoc) {
  var whitelist = getTldWhiteList();
  if (whitelist === null) {
    return false;
  }
  console.log("whitelistMode:", tldDoc, whitelist);
  return whitelist.indexOf(tldDoc) === -1;
}


function getTldWhiteList() {
  // about:config => new string pref => "google.com facebook.com"
  // extensions.{42f25d10-4944-11e2-96c0-0b6a95a8daf0}.tldWhitelistMode
  var branch = Services.prefs.getBranch("extensions.${EXT_ID}.");
  var prefName = "tldWhitelistMode";
  if (branch.prefHasUserValue(prefName)) {
    try {
      return spaceDelimitedToArray(branch.getCharPref(prefName));
    } catch (ex) {
      console.error(ex);
    }
  }
  return null;
}


// eg. "google.com   foo.bar  " => ["google.com", "foo.bar"]
function spaceDelimitedToArray(txt) {
  return txt.trim().split(/\s* \s*/);
}
