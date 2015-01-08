/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */

"use strict";


function createMsgPanel(doc) {
  var panel = doc.getElementById("${BASE_DOM_ID}-popup");
  if (panel) {
    //bug
    console.trace("createMsgPanel dup popup " + panel.state);
    panel.hidePopup();
    return panel;
  }

  panel = doc.getElementById("mainPopupSet").appendChild(doc.createElement("panel"));
  panel.setAttribute("id", "${BASE_DOM_ID}-popup");
  panel.setAttribute("type", "arrow");

  var container = panel.appendChild(doc.createElement("vbox"));
  container.style.width = "50ch";

  appendContent(container, panel);

  panel.addEventListener("popuphidden", function(evt) {
    panel.parentNode.removeChild(panel);
    initIconNormal(doc);
  }, false);

  return panel;
}


function appendContent(container, panel) {
  var tab = UIUtils.getSelectedTab(container.ownerDocument.defaultView);
  var errorId = tab.getAttribute("${BASE_DOM_ID}-tab-error");
  if (errorId.length === 0) {
    return null;
  }

  var ns = util.loadSubScript("${PATH_MODULE}/error.js");
  return ns.appendErrorToPanel(container, panel);
}


function createLoginsMenu(menupopup) {
  menupopup.addEventListener("popuphidden", onHideLoginsMenu, false);
  menupopup.addEventListener("command", onLoginCommand, false);
  menupopup.addEventListener("click", onLoginMiddleClick, false);

  var chromeWin = menupopup.ownerDocument.defaultView;
  var browser = UIUtils.getSelectedTab(chromeWin).linkedBrowser;
  var topInnerData = WinMap.getInnerWindowFromObj(browser.contentWindow);

  // list all accounts
  var docUser = "docUserObj" in topInnerData ? topInnerData.docUserObj : null;
  if (docUser !== null) {
    populateUsers(docUser, menupopup);
    populateNewAccount(docUser, menupopup);
  }

  // list 3rd-party users
  if ("thirdPartyUsers" in topInnerData) {
    populate3rdPartyUsers(topInnerData.thirdPartyUsers, menupopup, docUser !== null);
  }
}


function onHideLoginsMenu(evt) {
  if (evt.currentTarget !== evt.target) { // bubbled event?
    return;
  }
  var menupopup = evt.originalTarget;
  menupopup.removeEventListener("popuphidden", onHideLoginsMenu, false);
  menupopup.removeEventListener("command", onLoginCommand, false);
  menupopup.removeEventListener("click", onLoginMiddleClick, false);
  menupopup.parentNode.removeChild(menupopup);
  initIconNormal(menupopup.ownerDocument);
}


function populateNewAccount(docUser, menupopup) {
  var newAccount = menupopup.appendChild(menupopup.ownerDocument.createElement("menuitem"));
  newAccount.setAttribute("label", util.getText("icon.user.new.label"));
  newAccount.setAttribute("accesskey", util.getText("icon.user.new.accesskey"));
  newAccount.setAttribute("cmd", "new account");
  newAccount.setAttribute("login-user16", docUser.user.toNewAccount().encodedName);
  newAccount.setAttribute("login-tld", docUser.user.toNewAccount().encodedTld);
  if (docUser.user.isNewAccount) {
    newAccount.setAttribute("image", "${PATH_CONTENT}/favicon.ico");
    newAccount.className = "menuitem-iconic";
  }
}


function populateUsers(docUser, menupopup) {
  var users = LoginDB.getUsers(docUser.encodedDocTld);
  if (users.length === 0) {
    return;
  }

  var doc = menupopup.ownerDocument;

  for (var idx = users.length - 1; idx > -1; idx--) {
    var myUser = users[idx];

    if (docUser.user.equals(myUser)) {
      // current user
      var userMenu = menupopup.appendChild(doc.createElement("menu"));
      userMenu.className = "menu-iconic";
      userMenu.setAttribute("image", "${PATH_CONTENT}/favicon.ico");
      userMenu.setAttribute("label", myUser.plainName);
      if (myUser.encodedTld !== docUser.encodedDocTld) {
        userMenu.setAttribute("tooltiptext", myUser.plainTld);
      }
      var userPopup = userMenu.appendChild(doc.createElement("menupopup"));
      var delItem = userPopup.appendChild(doc.createElement("menuitem"));

      delItem.setAttribute("label", util.getText("icon.user.current.remove.label"));
      delItem.setAttribute("accesskey", util.getText("icon.user.current.remove.accesskey"));
      delItem.setAttribute("cmd", "del user");
      delItem.setAttribute("login-user16", myUser.encodedName);
      delItem.setAttribute("login-tld", myUser.encodedTld);

    } else {
      var usernameItem = menupopup.appendChild(doc.createElement("menuitem"));
      usernameItem.setAttribute("type", "radio");
      usernameItem.setAttribute("label", myUser.plainName);
      usernameItem.setAttribute("cmd", "switch user");
      usernameItem.setAttribute("login-user16", myUser.encodedName);
      usernameItem.setAttribute("login-tld", myUser.encodedTld);
      if (myUser.encodedTld !== docUser.encodedDocTld) {
        usernameItem.setAttribute("tooltiptext", myUser.plainTld);
      }
    }
  }

  menupopup.appendChild(doc.createElement("menuseparator"));
}


function populate3rdPartyUsers(thirdParty, menupopup, addSeparator) {
  var loggedinTLDs = [];
  for (var tld3rd in thirdParty) {
    var encTld = StringEncoding.encode(tld3rd);
    if (LoginDB.isLoggedIn(encTld)) {
      console.assert(thirdParty[tld3rd] !== null, "tld has users, should not be null", tld3rd);
      loggedinTLDs.push(tld3rd);
    }
  }
  if (loggedinTLDs.length === 0) {
    return;
  }

  loggedinTLDs.sort(function(a, b) {
    return b.localeCompare(a);
  });

  var doc = menupopup.ownerDocument;

  if (addSeparator) {
    menupopup.appendChild(doc.createElement("menuseparator"));
  }

  for (var idx = 0, len = loggedinTLDs.length; idx < len; idx++) {
    var tld = loggedinTLDs[idx];
    var userId = thirdParty[tld];
    var username = userId.isNewAccount ? util.getText("icon.3rd-party.anon.label")
                                       : userId.plainName;

    var userMenu = menupopup.appendChild(doc.createElement("menu"));
    userMenu.setAttribute("label", username + " / " + tld);

    var userPopup = userMenu.appendChild(doc.createElement("menupopup"));
    var nameItem = insertItem(userPopup, userId.toNewAccount(), tld);
    nameItem.setAttribute("label", util.getText("icon.3rd-party.anon.label"));
    if (userId.isNewAccount) {
      nameItem.setAttribute("checked", "true");
    }

    userPopup.appendChild(doc.createElement("menuseparator"));
    var users = LoginDB.getUsers(StringEncoding.encode(tld));
    for (var idx2 = users.length - 1; idx2 > -1; idx2--) {
      var myUser = users[idx2];
      nameItem = insertItem(userPopup, myUser, tld);
      if (userId.equals(myUser)) {
        nameItem.setAttribute("checked", "true");
      }
    }

  }
}


function insertItem(userPopup, myUser, tld) {
  var item = userPopup.ownerDocument.createElement("menuitem");
  userPopup.appendChild(item);
  item.setAttribute("label", myUser.plainName);
  item.setAttribute("type", "radio");
  item.setAttribute("cmd", "set 3rd-party");
  item.setAttribute("login-doc", tld);
  item.setAttribute("login-user16", myUser.encodedName);
  item.setAttribute("login-tld", myUser.encodedTld);
  return item;
}


function onLoginMiddleClick(evt) {
  if ((evt.button !== 1) || (evt.detail !== 1)) {
    // allow only middle clicks/single clicks
    return;
  }

  var menuItem = evt.target;
  switch (menuItem.getAttribute("cmd")) {
    case "switch user":
    case "new account":
      break;
    default:
      return;
  }

  if (menuItem.hasAttribute("disabled") && (menuItem.getAttribute("disabled") === "true")) {
    // ignore disabled items
    return;
  }

  menuItem.parentNode.hidePopup();
  loginCommandCore(menuItem, true);
}


function onLoginCommand(evt){
  loginCommandCore(evt.target, evt.ctrlKey);
}


function loginCommandCore(menuItem, newTab) {
  var win = menuItem.ownerDocument.defaultView;
  var browser = UIUtils.getSelectedTab(win).linkedBrowser;
  var topWin = WinMap.getInnerWindowFromObj(browser.contentWindow);
  var userId = null;

  if (menuItem.hasAttribute("login-tld")) {
    userId = new UserId(menuItem.getAttribute("login-user16"),
                        menuItem.getAttribute("login-tld"));
  }

  switch (menuItem.getAttribute("cmd")) {
    case "new account":
      removeCookies(CookieUtils.getUserCookies(userId));
      removeTldData_LS(topWin.eTld);
      loadTab(newTab, browser, topWin.eTld, userId);
      break;

    case "switch user":
      loadTab(newTab, browser, topWin.eTld, userId);
      break;

    case "del user":
      var users = LoginDB.getUsers(StringEncoding.encode(topWin.eTld));
      removeCookies(CookieUtils.getUserCookies(userId));
      if (users.length === 1) {
        // removing the last user
        removeCookies(CookieUtils.getUserCookies(userId.toNewAccount()));
        UserChange.remove(topWin.eTld, true, userId); // BUG? unload will need the user
        util.reloadTab(browser);
      } else {
        UserChange.remove(topWin.eTld, false, userId);
        loadTab(newTab, browser, topWin.eTld, userId.toNewAccount());
      }
      break;

    case "set 3rd-party":
      UserState.setTabDefaultThirdParty(menuItem.getAttribute("login-doc"), topWin.outerId, userId);
      util.reloadTab(browser);
      // TODO handle middle click
      break;

    default:
      console.trace();
      throw new Error("loginCommandCore:" + menuItem.getAttribute("cmd"));
  }
}


function loadTab(newTab, browser, tldDoc, user) {
  // update global default for new tabs - current tabs will keep their internal defaults
  LoginDB.setDefaultUser(StringEncoding.encode(tldDoc), user); // BUG should youtube set google as well?

  if (newTab) {
    // TODO inherit default users
    openNewTab(browser.currentURI.spec, browser.ownerDocument.defaultView);
  } else {
    UserState.setTabDefaultFirstParty(tldDoc, getTabIdFromBrowser(browser), user);
    updateUIAsync(browser, true); // show new user now, don't wait for new dom // BUG it doesn't working
    util.reloadTab(browser);
  }
}


function openNewTab(url, win) {
  var uri = Services.io.newURI(url, null, null);
  var where = Ci.nsIBrowserDOMWindow.OPEN_NEWTAB;
  var win2 = win.browserDOMWindow.openURI(uri, null, where, 0); // TODO open tab at the right
}
