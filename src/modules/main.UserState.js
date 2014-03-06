/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var UserState = {

  _thirdPartyGlobalDefault: Object.create(null),


  getTabDefaultFirstPartyUser: function(tld, tabId) {
    return this._getTabDefault(tabId, "firstParty", tld);
  },


  getTabDefaultThirdPartyUser: function(tld, topData) {
    // tld already requested by the top document?
    if ("thirdPartyUsers" in topData) {
      if (tld in topData.thirdPartyUsers) {
        return topData.thirdPartyUsers[tld]; // can be null (anon tld)
      }
    }

    // tld already requested by this tab?
    // can be different default from the one used by topInnerId (due to bfcache)
    var userId = this._getTabDefault(topData.outerId, "thirdParty", tld);
    if (userId !== null) {
      return userId;
    }

    // 3rd-party global default?
    if (tld in this._thirdPartyGlobalDefault) {
      return this._thirdPartyGlobalDefault[tld];
    }

    var encTld = StringEncoding.encode(tld);
    return LoginDB.isLoggedIn(encTld)
         ? new UserId(UserUtils.NewAccount, encTld)
         : null;
  },


  _getTabDefault: function(tabId, key, tld) {
    var tabData = WinMap.getOuterEntry(tabId);
    if ("tabLogins" in tabData) {
      if (key in tabData.tabLogins) {
        if (tld in tabData.tabLogins[key]) {
          return tabData.tabLogins[key][tld];
        }
      }
    }
    return null;
  },


  // save currently used login by a tld in a given tab
  setTabDefaultFirstParty: function(tldDoc, tabId, userId) { // TODO use docUser instead of tldDoc + userId + tabId?
    // update global default for new tabs - current tabs will keep their internal defaults
    LoginDB.setDefaultUser(StringEncoding.encode(tldDoc), userId);

    var tabData = WinMap.getOuterEntry(tabId);
    this._setTabDefault(tabData, "firstParty", tldDoc, userId);
    this.updateSessionStore(tabId);

    var tab = findTabById(tabId);
    if (tab.hasAttribute("${BASE_DOM_ID}-tab-error")) {
      // reset error icon
      tab.removeAttribute("${BASE_DOM_ID}-tab-error");
    }
  },


  setTabDefaultThirdParty: function(tldDoc, tabId, userId) {
    this._thirdPartyGlobalDefault[tldDoc] = userId;

    var tabData = WinMap.getOuterEntry(tabId);
    this._setTabDefault(tabData, "thirdParty", tldDoc, userId);
    this.updateSessionStore(tabId);
  },


  updateSessionStore: function(tabId) {
    var tabData = WinMap.getOuterEntry(tabId);
    var hasData = false;
    if ("tabLogins" in tabData) {
      if ("firstParty" in tabData.tabLogins) {
        hasData = hasData || Object.keys(tabData.tabLogins.firstParty).length > 0;
      }
      if ("thirdParty" in tabData.tabLogins) {
        hasData = hasData || Object.keys(tabData.tabLogins.thirdParty).length > 0;
      }
    }

    var tab = findTabById(tabId);
    var loginsAttr = "${PERSIST_TAB_LOGINS}";
    if (hasData) {
      var data = JSON.stringify(tabData.tabLogins);
      tab.setAttribute(loginsAttr, data);
    } else {
      if (tab.hasAttribute(loginsAttr)) {
        tab.removeAttribute(loginsAttr);
      }
    }
  },


  _setTabDefault: function(tabData, key, tldDoc, userId) {
    console.assert(tabData.parentOuter === WindowUtils.WINDOW_ID_NONE, "tabData is not a top outer frame", tabData);
    var replace = true;
    if ("tabLogins" in tabData) {
      if (key in tabData.tabLogins) {
        if (tldDoc in tabData.tabLogins[key]) {
          // replace?
          if (userId.equals(tabData.tabLogins[key][tldDoc])) {
            replace = false;
          }
        }
      } else {
        tabData.tabLogins[key] = Object.create(null);
      }
    } else {
      tabData.tabLogins = Object.create(null);
      tabData.tabLogins[key] = Object.create(null);
    }

    if (replace) {
      tabData.tabLogins[key][tldDoc] = userId;
    }

    if (tldDoc !== userId.plainTld) {
      // docUser=twitpic/youtube? make twitter.com/google.com default as well
      tabData.tabLogins[key][userId.plainTld] = userId;
    }
  },


  setGlobalDefault: function(tab) {
    // TODO just set topInnerId as the default source
    // TODO default for new tab:
    //   from bookmarks/urlbar=>last selected via menu
    //   from link=>inherit from source tab
    var topData = WinMap.getInnerWindowFromObj(tab.linkedBrowser.contentWindow);
    if ("docUserObj" in topData) {
      var docUser = topData.docUserObj;
      LoginDB.setDefaultUser(docUser.encodedDocTld, docUser.user);
    }

    // default third-party users are modified only via menu
  },


  hasUsers: function(topInnerId) {
    var topData = WinMap.getInnerWindowFromId(topInnerId);
    if ("docUserObj" in topData) {
      return true;
    }

    if (("thirdPartyUsers" in topData) === false) {
      return false;
    }

    var thirdParty = topData.thirdPartyUsers;
    for (var tld in thirdParty) {
      if (thirdParty[tld] !== null) {
        return true;
      }
    }

    return false;
  },


  // Save, for the top document, its iframes, and resources.
  //
  // thirdPartyUsers["facebook.com"]=null
  //   Keep 3rd-party anonymous TLDs for tab consistency.
  //   There is no login for facebook (yet).
  //   A login may eventually happen in another tab.
  //
  // thirdPartyUsers["facebook.com"]=UserId
  //   User will be displayed in the Multifox menu.
  //   It is just a log, it is not used by findUser
  //
  addRequest: function(uri, myChannel, usr) {
    if (myChannel.isTopLevelBrowsingContext) {
      return;
    }

    // myChannel refers to a resource (*iframes*, images etc)

    var tldRequest = getTldFromUri(uri);
    if (tldRequest === null) {
      return; // about: ftp:
    }

    var channelWindow = myChannel.linkedWindow;
    var topData = channelWindow.topWindow;
    var firstPartyRequest = tldRequest === topData.eTld; // about: => topData.eTld=null
    if (firstPartyRequest) {
      return;
    }

    console.assert((usr !== null) || (LoginDB.isLoggedIn(StringEncoding.encode(tldRequest)) === false),
                   "addRequest usr=null loggedin tld", tldRequest, myChannel.isWindow ? "window" : "resource", usr, uri.prePath, channelWindow);

    // user=null => null or anon window/asset request using an inherited user
    if ("thirdPartyUsers" in topData) {
      if (tldRequest in topData.thirdPartyUsers) {
        var current = topData.thirdPartyUsers[tldRequest];
        if (UserUtils.equalsUser(current, usr) === false) {
          // previous user removed. usr is probably NewAccount
          console.warn("replacing user?", current, usr);
          topData.thirdPartyUsers[tldRequest] = usr;
        }
      } else {
        topData.thirdPartyUsers[tldRequest] = usr;
      }
    } else {
      topData.thirdPartyUsers = Object.create(null);
      topData.thirdPartyUsers[tldRequest] = usr;
    }
  }

};



var UserChange = {

  // docData.docUserObj
  //   current top doc/iframes: update TLD docs to new docUser
  //   other docs (from current (not visible/bfcached docs) and other tabs):
  //     update TLD docs to NewAccount
  //
  // 1st-party default
  //   current tab: add docUser.user
  //   different tabs/topdocs:
  //     tld+doc is anon (is docUser.user the first user for tld)?
  //       n: do nothing
  //       y: replace null by NewAccount
  //
  // 3rd-party default
  //   current tab: add docUser.user to 1st-party defaults
  //   current topdoc: add docUser.user to thirdPartyUsers
  //   other tabs/topdocs:
  //     tld+doc is anon (is docUser.user the first user for tld)?
  //       n: do nothing
  //       y: add NewAccount
  add: function(docUser, topWindow) {
    var loginTabId = topWindow.outerId;
    console.assert(WinMap.getOuterEntry(loginTabId).parentOuter === WindowUtils.WINDOW_ID_NONE, "not a top outer id");
    var newAccount = docUser.user.toNewAccount();


    for (var docData of WinMap.getContentInnerWindowIterator()) {
      if (docData.eTld !== docUser.ownerTld) {
        // ignore windows different of docUser.ownerTld
        continue;
      }

      var tabId      = docData.topWindow.outerId;
      var topInnerId = docData.topWindow.innerId;

      // same tab, doc from visible/login tab
      if (topInnerId === topWindow.innerId) {
        if ("thirdPartyUsers" in docData) { // login could be a 3rd-party iframe
          if (docUser.ownerTld in docData.thirdPartyUsers) {
            docData.thirdPartyUsers[docUser.ownerTld] = docUser.user;
          }
        }

        docData.docUserObj = docUser; // the doc/iframe we are logging in

        if (docData.isFirstParty) {
          UserState.setTabDefaultFirstParty(docUser.ownerTld, tabId, docUser.user);
        } else {
          UserState.setTabDefaultThirdParty(docUser.ownerTld, tabId, docUser.user);
        }

      // same tab, doc from bfcache
      } else if (loginTabId === tabId) {
        if ("thirdPartyUsers" in docData) { // thirdPartyUsers => it's a topdoc
          if (docUser.ownerTld in docData.thirdPartyUsers) {
            if (docData.thirdPartyUsers[docUser.ownerTld] === null) {
              docData.thirdPartyUsers[docUser.ownerTld] = newAccount;
            }
          }
        }

        if (("docUserObj" in docData) === false) {
          docData.docUserObj = new DocumentUser(newAccount, docUser.ownerTld, topInnerId, tabId);
        }


      // other tabs
      } else {
        if ("thirdPartyUsers" in docData) { // thirdPartyUsers => it's a topdoc
          if (docUser.ownerTld in docData.thirdPartyUsers) {
            if (docData.thirdPartyUsers[docUser.ownerTld] === null) {
              docData.thirdPartyUsers[docUser.ownerTld] = newAccount;
              UserState.setTabDefaultFirstParty(docUser.ownerTld, tabId, newAccount);
            }
          }
        }

        if (("docUserObj" in docData) === false) {
          docData.docUserObj = new DocumentUser(newAccount, docUser.ownerTld, topInnerId, tabId);
          if (docData.isFirstParty) {
            UserState.setTabDefaultFirstParty(docUser.ownerTld, tabId, newAccount);
          } else {
            UserState.setTabDefaultThirdParty(docUser.ownerTld, tabId, newAccount);
          }
        }
      }


      UserState.updateSessionStore(tabId);
    }

    this._updateUIAllWindows();
  },


  remove: function(tldDoc, isTldEmpty, delUserId) {
    console.log("UserChange.remove", tldDoc, isTldEmpty, delUserId);
    var newUser = delUserId.toNewAccount();

    for (var id in WinMap._inner) {
      var docData = WinMap._inner[id];

      if ("docUserObj" in docData) {
        if (docData.eTld === tldDoc) {
          if (isTldEmpty) {
            delete docData.docUserObj; // tldDoc is now anon
          } else {
            // replace delUserId by NewAccount
            if (delUserId.equals(docData.docUserObj.user)) {
              var topWin = docData.topWindow;
              docData.docUserObj = new DocumentUser(newUser, tldDoc, topWin.innerId, topWin.outerId);
            }
          }
        }
      }


      // change defaults
      if (docData.isTop === false) {
        continue;
      }

      // docData = topData
      if ("thirdPartyUsers" in docData) {
        if (tldDoc in docData.thirdPartyUsers) {
          console.assert(docData.thirdPartyUsers[tldDoc] !== null, "thirdPartyUsers should have an user", tldDoc);
          if (isTldEmpty) {
            delete docData.thirdPartyUsers[tldDoc];
          } else {
            docData.thirdPartyUsers[tldDoc] = newUser;
          }
        }
      }

      var tabData = WinMap.getOuterEntry(docData.outerId);
      console.assert(tabData.parentOuter === WindowUtils.WINDOW_ID_NONE, "docData.outerId is not a tabId", tabData);
      if (isTldEmpty) {
        this._removeTldFromTabDefaults(tldDoc, tabData); // tldDoc is now anon
      } else {
        // replace delUserId by NewAccount
        this._replaceTldTabDefaults(tldDoc, tabData, delUserId, newUser);
      }

      UserState.updateSessionStore(docData.topWindow.outerId);
    }

    this._updateUIAllWindows();
  },


  _updateUIAllWindows: function() {
    var enumWin = UIUtils.getWindowEnumerator();
    while (enumWin.hasMoreElements()) {
      var tab = UIUtils.getSelectedTab(enumWin.getNext());
      updateUIAsync(tab, true);
    }
  },


  _replaceTldTabDefaults: function(tldDoc, tabData, delUserId, newUser) {
    if ("tabLogins" in tabData) {
      var users = tabData.tabLogins;
      if ("firstParty" in users) {
        if (tldDoc in users.firstParty) {
          if (delUserId.equals(users.firstParty[tldDoc])) {
            users.firstParty[tldDoc] = newUser;
          }
        }
      }
      if ("thirdParty" in users) {
        if (tldDoc in users.thirdParty) {
          if (delUserId.equals(users.thirdParty[tldDoc])) {
            users.thirdParty[tldDoc] = newUser;
          }
        }
      }
    }

    if (tldDoc in UserState._thirdPartyGlobalDefault) {
      if (delUserId.equals(UserState._thirdPartyGlobalDefault[tldDoc])) {
        UserState._thirdPartyGlobalDefault[tldDoc] = newUser;
      }
    }
  },


  _removeTldFromTabDefaults: function(tldDoc, tabData) {
    if ("tabLogins" in tabData) {
      var users = tabData.tabLogins;
      if ("firstParty" in users) {
        if (tldDoc in users.firstParty) {
          delete users.firstParty[tldDoc];
        }
      }
      if ("thirdParty" in users) {
        if (tldDoc in users.thirdParty) {
          delete users.thirdParty[tldDoc];
        }
      }
    }
    if (tldDoc in UserState._thirdPartyGlobalDefault) {
      delete UserState._thirdPartyGlobalDefault[tldDoc];
    }
  }

};
