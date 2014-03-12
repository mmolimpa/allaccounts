/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var NewDocUser = {

  onDocElementInserted: function(msgData) {
    this.registerWindow(msgData, true);

    var innerWin = WinMap.getInnerWindowFromId(msgData.inner);
    if (isSupportedScheme(innerWin.originalUri.scheme) === false) {
      // about: javascript: chrome:
      return false;
    }

    var topWin = innerWin.topWindow;
    var docUser = WinMap.findUser(innerWin.originalUri, topWin.innerId, topWin.outerId);
    if (docUser !== null) {
      // logged in tld
      innerWin.docUserObj = docUser; // used by assets/iframes
    } else {
      // anon tld: inherit it from a parent
      docUser = WinMap.getNextSavedUser(msgData.parentInner);
    }

    if (docUser !== null) {
      innerWin.customizeReason = "docUser";
      return true;
    }

    if (innerWin.isFirstParty) {
      return false;
    }

    innerWin.customizeReason = "3rd-party";
    return WinMap.getAsAnonUserJs(innerWin.topWindow, innerWin.eTld);
  },


  registerWindow: function(msgData, hasLocation) {
    // as of Firefox 29, media documents (image/video) fire
    // "document-element-inserted" before "content-document-global-created"
    // observer
    var outerEntry = {
      __proto__: null,
      type: hasLocation ? "document-element-inserted" : "document-global-created",
      "inner-id": msgData.inner,
      "original-url": msgData.url
    };

    var innerWinParent = null;
    if (msgData.parentInner !== WindowUtils.WINDOW_ID_NONE) {
      innerWinParent = WinMap.getInnerWindowFromId(msgData.parentInner);
    }

    var parentOuterId = WindowUtils.WINDOW_ID_NONE;
    if (innerWinParent !== null) {
      parentOuterId = innerWinParent.outerId;
      if (innerWinParent.documentElementInserted) {
        outerEntry.parent = innerWinParent.originalUri.spec;
      } else {
        outerEntry.parent = "<undefined>";
      }
    }

    WinMap.addToOuterHistory(outerEntry, msgData.outer, parentOuterId);

    var innerWin;
    if (msgData.inner in WinMap._inner) {
      innerWin = WinMap.getInnerWindowFromId(msgData.inner);

    } else {
      innerWin = new InnerWindow(msgData);
      console.assert((innerWin.parentId in WinMap._waitingRemoval) === false, "addInner: parent doesn't exist anymore", innerWin);
      WinMap._inner[innerWin.innerId] = innerWin;

      console.assert(WinMap._getChildrenCount(innerWin.innerId) === 0, "new window should not have children", innerWin);
      if (innerWin.parentId !== WindowUtils.WINDOW_ID_NONE) {
        WinMap._incChildrenCount(innerWin.parentId);
      }

      LoginCopy.fromOpener("domcreated", innerWin);
    }

    innerWin.setLocation(msgData.url, msgData.origin);
  },


  addWindowRequest: function(channelWin, requestURI) {
    // TODO separate logic for channelWin.isTop
    var tldPrev = channelWin.isTop
                ? CrossTldLogin.getPrevDocTld(channelWin.outerId) // should be called before addToOuterHistory
                : null;

    var entry = {
      __proto__: null,
      type: "request-doc", // "request"
      visibleInnerId: channelWin.innerId, // currentInnerId / "previous" inner document
      url:  requestURI.spec // TODO useless?
    };

    var parentOuterId = channelWin.isTop
                      ? WindowUtils.WINDOW_ID_NONE
                      : WinMap.getInnerWindowFromId(channelWin.parentId).outerId;

    WinMap.addToOuterHistory(entry, channelWin.outerId, parentOuterId);

    LoginCopy.fromOpener("request", channelWin);

    // requestURI might define a new top-level browsing context, so
    // channelWin.topWindow.innerId is invalid, as it refers to the current top window
    // (which may be replaced). requestURI can be a download/redir, we don't know yet.
    var topInnerId = channelWin.isTop ? WindowUtils.WINDOW_ID_NONE
                                      : channelWin.topWindow.innerId;
    var docUser = WinMap.findUser(requestURI, topInnerId, channelWin.topWindow.outerId);
    if (docUser === null) {
      // anon request: inherit it from a parent
      docUser = WinMap.getNextSavedUser(channelWin.parentId);
    }

    if (channelWin.isTop) {
      if (docUser === null) {
        // BUG docUser from a logged in iframe never will be != null
        docUser = CrossTldLogin.parse(tldPrev, requestURI, channelWin.outerId, topInnerId);
        if (docUser !== null) {
          entry["x-tld-login"] = true;
        }
      }

      if (docUser !== null) {
        UserState.setTabDefaultFirstParty(docUser.ownerTld, channelWin.outerId, docUser.user);
      }
    }

    if (docUser !== null) {
      entry.reqDocUserObj = docUser; // used by response
    }
    return docUser;
  },


  // getLoginForDocumentResponse
  // currentInnerId (possibly) is going to be replaced by a new document
  addDocumentResponse: function(channel, channelWin) {
    var stat = channel.responseStatus;
    var entry = {
      __proto__:   null,
      type:        "response-doc",
      http_status: stat,
      contentType: channel.contentType,
      visibleInnerId: channelWin.innerId,
      url:            channel.URI.spec
    };
    if (stat !== 200) {
      // 301, 302, 303?
      try {
        var locat = channel.getResponseHeader("location");
        entry.x_redir = locat;
      } catch (ex) {
      }
    }

    WinMap.addToOuterHistory(entry, channelWin.outerId);

    // should fetch login from request, because it could be a not logged in iframe
    // (which should inherit login from parent)
    var log = this._findDocRequest(channelWin.innerId, channelWin.outerId);
    console.assert(log !== null, "response without a request", channelWin.innerId, channel.URI.spec, channelWin, WinMap.getOuterEntry(channelWin.outerId).outerHistory);
    return "reqDocUserObj" in log ? log.reqDocUserObj : null;
  },


  _findDocRequest: function(innerId, outerId) {
    var outerDataLog = WinMap.getOuterEntry(outerId).outerHistory;
    for (var idx = outerDataLog.length - 1; idx > -1; idx--) {
      var req = outerDataLog[idx];
      if (req.type === "request-doc") {
        if (req.visibleInnerId === innerId) {
          return req;
        }
      }
    }
    return null;
  },


  viewSourceRequest: function(sourceWinId, uri) { // sourceWin = viewSource.xul
    var sourceWin = Services.wm.getCurrentInnerWindowWithId(sourceWinId);
    var chromeWin = UIUtils.getTopLevelWindow(sourceWin);
    if (chromeWin && chromeWin.opener) {
      if (UIUtils.isMainWindow(chromeWin.opener)) {
        var selTab = UIUtils.getSelectedTab(chromeWin.opener);
        return WinMap.findUser(uri, getCurrentTopInnerId(selTab), getTabIdFromBrowser(selTab.linkedBrowser));
      }
    }
    // BUG null for anon iframes (we would need to know its parent). find focused frame?
    console.log("viewSourceRequest null", sourceWin, uri);
    return null;
  }

};



var WinMap = { // stores all current outer/inner windows
  _outer: Object.create(null),
  _inner: Object.create(null),


  removeOuter: function(id) {
    // TODO check remaining inners?
    delete this._outer[id];
  },


  // when a window is loading, iframes from previous window may still be
  // active (i.e. running code). we don't remove it until all children have
  // been removed. Otherwise, children will refer to a non-existent window.
  _waitingRemoval: Object.create(null),
  _childrenCount: Object.create(null),


  _getChildrenCount: function(id) {
    var counter = this._childrenCount;
    return id in counter ? counter[id] : 0;
  },


  _incChildrenCount: function(id) {
    console.assert(id in this._inner, "parent id not found", id);
    if (id in this._childrenCount) {
      this._childrenCount[id]++;
    } else {
      this._childrenCount[id] = 1;
    }
  },


  _decChildrenCount: function(id) {
    var counter = this._childrenCount;
    console.assert(id in counter, "id not found in _decChildrenCount", id);
    console.assert(counter[id] > 0, "invalid state in _decChildrenCount", id, counter[id]);
    counter[id]--;
    if (counter[id] === 0) {
      delete counter[id];
    }
  },


  removeInner: function(id) {
    if ((id in this._inner) === false) {
      // id does not exist (as a content window).
      return;
    }

    // Do not remove if there is still an iframe
    if (this._getChildrenCount(id) > 0) {
      /*
      // for some reason, it may happen
      console.log((id in this._waitingRemoval) === false,
                  "removed twice? id already in _waitingRemoval",
                  id, this._waitingRemoval, this._childrenCount, this._inner[id]);
      */
      this._waitingRemoval[id] = true;

      this.addToOuterHistory({
        type:    "removeInner/waitingRemoval",
        innerId: id
      }, this._inner[id].outerId);
      return;
    }

    this.addToOuterHistory({
      type:    "removeInner/done",
      innerId: id
    }, this._inner[id].outerId);

    // id has no children
    console.assert((id in this._childrenCount) === false, "id should not exist in _childrenCount at this point", this._childrenCount[id]);
    var parent = this._inner[id].parentId;
    delete this._inner[id];
    delete this._waitingRemoval[id];

    // dec counter of parent
    if (parent !== WindowUtils.WINDOW_ID_NONE) {
      console.assert(this._getChildrenCount(parent) > 0, "invalid child counter", parent, this._childrenCount);
      this._decChildrenCount(parent);
    }

    // [removed]
    //    [removed]
    //       [removed] <parent>
    //          <id>   <===
    if (parent in this._waitingRemoval) {
      if (this._getChildrenCount(parent) === 0) {
        this.removeInner(parent);
      }
    }
  },


  /* useless until restaless mode be activated

  _addWindow: function(win) { // called recursively by _update for all documents in a tab
    var parentOuterId;
    var parentInnerId;
    if (isTopWindow(win)) {
      parentOuterId = WindowUtils.WINDOW_ID_NONE;
      parentInnerId = WindowUtils.WINDOW_ID_NONE;
    } else {
      var parent = getDOMUtils(win.parent);
      parentOuterId = parent.outerWindowID;
      parentInnerId = parent.currentInnerWindowID;
    }

    var utils = getDOMUtils(win);
    var outerId = utils.outerWindowID;
    var innerId = utils.currentInnerWindowID;

    if (outerId in WinMap._outer === false) {
      WinMap.addToOuterHistory({
        __proto__: null,
        type: "enable/update"
      }, outerId, parentOuterId);
    }

    if (innerId in WinMap._inner === false) {
      var openerId = win.opener === null
                   ? WindowUtils.WINDOW_ID_NONE
                   : getDOMUtils(win.opener).currentInnerWindowID;
      WinMap.addInner({
        openerInnerId: openerId,
        origin: win.location.origin,
        url: win.location.href,
        inner: innerId,
        outer: outerId,
        parentInner:parentInnerId
      });
    }
  },


  _update: function() {
    console.log("WinMap._update triggered");
    function forEachWindow(fn, win) {
      fn(win);
      for (var idx = win.length - 1; idx > -1; idx--) {
        forEachWindow(fn, win[idx]);
      }
    }

    var enumWin = UIUtils.getWindowEnumerator();
    while (enumWin.hasMoreElements()) {
      var tabList = UIUtils.getTabList(enumWin.getNext());
      for (var idx = tabList.length - 1; idx > -1; idx--) {
        forEachWindow(WinMap._addWindow, tabList[idx].linkedBrowser.contentWindow);
      }
    }
    // TODO a "up-to-date" flag
  },


  addInner: function(msgData) {
    var innerObj = new InnerWindow(msgData);
    console.assert((innerObj.parentId in this._waitingRemoval) === false, "addInner: parent doesn't exist anymore", innerObj);

    // current entry may be a "placeholder" doc (from an unloaded tab)
    // added by WinMap._update. The real document may have the same id.
    if (innerObj.innerId in this._inner) {
      var entry = this._inner[innerObj.innerId];
      console.assert(entry.parentId === innerObj.parentId, "different parentId", innerObj.parentId, entry.parentId);
      console.assert(entry.outerId === innerObj.outerId, "different outer id");
      console.assert((entry.originalUri.spec === "about:blank") || (entry.originalUri.spec === innerObj.originalUri.spec), "different url");
    } else {
      // new inner window
      console.assert(this._getChildrenCount(innerObj.innerId) === 0, "new window should not have children", innerObj);
      if (innerObj.parentId !== WindowUtils.WINDOW_ID_NONE) {
        this._incChildrenCount(innerObj.parentId);
      }
    }

    // all inner windons should be preserved to allow a page from bfcache to use its original login
    this._inner[innerObj.innerId] = innerObj;
    return innerObj;
  },
  */


  getOuterEntry: function(id) {
    console.assert(typeof id === "number", "getOuterEntry invalid param", id);
    console.assert(id !== WindowUtils.WINDOW_ID_NONE, "outer id - invalid value", id);
    if (id in this._outer) {
      return this._outer[id];
    }
    //this._update();
    return id in this._outer ? this._outer[id] : null;
  },


  getInnerWindowFromId: function(id) {
    console.assert(typeof id === "number", "getInnerWindowFromId invalid type", id);
    console.assert(id !== WindowUtils.WINDOW_ID_NONE, "inner id - invalid value", id);
    // ignoring _waitingRemoval
    if (id in this._inner) {
      return this._inner[id];
    }
    //this._update();
    // resource://gre-resources/hiddenWindow.html
    console.trace("getInnerWindowFromId - innerId not found", id,
                  Services.wm.getCurrentInnerWindowWithId(id));
    return id in this._inner ? this._inner[id] : null;
  },


  getInnerWindowFromObj: function(win) {
    return WinMap.getInnerWindowFromId(getDOMUtils(win).currentInnerWindowID);
  },


  populateWinData: function(win) {
    var utils = getDOMUtils(win);

    var msgData = {
      inner:       utils.currentInnerWindowID,
      outer:       utils.outerWindowID,
      url:         win.location.href,
      origin:      null,
      topId:         WindowUtils.WINDOW_ID_NONE,
      parentInner:   WindowUtils.WINDOW_ID_NONE,
      openerInnerId: WindowUtils.WINDOW_ID_NONE
    };

    if (win !== win.top) {
      console.assert(win.opener === null, "is an iframe supposed to have an opener?");
      console.assert(win.parent !== null, "iframe without a parent element");
      msgData.parentInner = getDOMUtils(win.parent).currentInnerWindowID;
      msgData.topId = getDOMUtils(win.top).currentInnerWindowID;
    } else {
      msgData.topId = msgData.inner;
    }

    if (win.opener !== null) {
      // OBS opener=null for middle clicks. It works for target=_blank links, even for different domains
      msgData.openerInnerId = getDOMUtils(win.opener).currentInnerWindowID;
    }

    if (msgData.url.length > 0) { // avoid exception, not necessary for Fx30
      msgData.origin = win.location.origin;
    }

    return msgData;
  },


  getContentInnerWindowIterator: function*() {
    var windows = this._inner;
    for (var id in windows) {
      if (id in this._waitingRemoval) {
        continue;
      }
      var innerWin = windows[id];
      if (innerWin.documentElementInserted === false) {
        continue;
      }
      if (innerWin.isInsideTab) {
        yield innerWin;
      }
    }
    return null;
  },


  loginSubmitted: function(innerWin, data, docUser) {
    var entry = {
      __proto__: null,
      type:      "pw-submit",
      submitted: data,
      tld: innerWin.eTld
    };

    WinMap.addToOuterHistory(entry, innerWin.outerId);
    if (docUser !== null) {
      UserChange.add(docUser, innerWin.topWindow);
    }
  },


  addToOuterHistory: function(newHistObj, outerId, parentOuterId = undefined) {
    var outerData;
    if (outerId in this._outer) {
      outerData = this._outer[outerId];
      outerData["x-history-length"]++;
    } else {
      console.assert(typeof parentOuterId !== "undefined", "missing parentOuterId", outerId, parentOuterId);
      outerData = {
        __proto__: null,
        parentOuter: parentOuterId, // TODO parentId
        outerHistory: []
      };


      if (parentOuterId === WindowUtils.WINDOW_ID_NONE) {
        var win = Services.wm.getOuterWindowWithId(outerId).top;
        var browser = UIUtils.getParentBrowser(win);
        outerData.isInsideTab = browser === null
                              ? false : UIUtils.isContentBrowser(browser);
      }

      this._outer[outerId] = outerData;
      outerData["x-history-length"] = 1;
    }
    this._pushHistory(newHistObj, outerData.outerHistory);
  },


  _pushHistory: function(entry, outerHistory) {
    if (outerHistory.length > 30) {
      var delQty = outerHistory.length - 10;
      outerHistory.splice(0, delQty, entry);
    } else {
      outerHistory.push(entry);
    }
  },


  findUser: function(uriDoc, topInnerId, tabId) { // TODO only tld is necessary
    var tld = getTldFromUri(uriDoc);
    if (tld === null) {
      return null;
    }

    // TODO Could we save 1st-party user to topData (like
    // topData.thirdPartyUsers) and avoid completely the use of docUser?

    // check if this top document (or its elements) has previous requests to tld
    var userId;
    if (topInnerId === WindowUtils.WINDOW_ID_NONE) {
      // assume uriDoc as a top document
      userId = UserState.getTabDefaultFirstPartyUser(tld, tabId);
    } else {
      var topData = WinMap.getInnerWindowFromId(topInnerId);
      if (tld === topData.eTld) {
        // uriDoc ==> first-party
        userId = UserState.getTabDefaultFirstPartyUser(tld, topData.outerId);
      } else {
        userId = UserState.getTabDefaultThirdPartyUser(tld, topData);
      }
    }

    if (userId === null) {
      // is the first time tld is used in this tab?
      userId = LoginDB.getDefaultUser(StringEncoding.encode(tld)); // 1st/3rd-party
    }

    return userId === null ? null
                           : new DocumentUser(userId, tld, topInnerId, tabId);
  },


  getNextSavedUser: function(id) {
    var entry;
    var innerId = id;
    while (innerId !== WindowUtils.WINDOW_ID_NONE) {
      entry = this.getInnerWindowFromId(innerId);
      if ("docUserObj" in entry) {
        return entry.docUserObj;
      }
      innerId = entry.parentId;
    }
    return null;
  },


  // called by request/response: <img>, <script>, <style>, XHR... (but not <iframe>)
  getUserForAssetUri: function(innerWin, resUri) {
    // parent window docUser
    var docUser = this.getSavedUser(innerWin.innerId);
    if (docUser !== null) {
      // BUG? facebook img inside twitter ignores facebook id?
      return docUser;
    }

    // owner document is anon

    // resUri could be a logged in tld (different from anonymous innerId)
    var topWin = innerWin.topWindow;
    var isAnon = this.findUser(resUri, topWin.innerId, topWin.outerId) === null;
    return isAnon ? null
                  : this.getAsAnonUserUri(topWin, resUri, false);
  },


  getAsAnonUserUri: function(topWin, uri, uriIsWin) {
    // uri refers to a window|element channel
    var tld = uriIsWin ? getTldFromUri(uri) : topWin.eTld;
    if (tld === null) {
      // "about:"
      tld = getTldForUnsupportedScheme(uriIsWin ? uri : topWin.originalUri);
    }
    return this.getAsAnonUserJs(topWin, tld);
  },


  getAsAnonUserJs: function(topWin, tld) {
    console.assert(topWin.isTop, "topWin must be a top window");
    return new DocumentUser(null, tld, topWin.innerId, topWin.outerId);
  },


  getSavedUser: function(innerId) {
    var entry = this.getInnerWindowFromId(innerId);
    return "docUserObj" in entry
              ? entry.docUserObj // identity used by document
              : this.getNextSavedUser(entry.parentId);
  },


  restoreTabDefaultUsers: function(tab) {
    var loginsAttr = "${PERSIST_TAB_LOGINS}";
    if (tab.hasAttribute(loginsAttr) === false) {
      return;
    }
    console.log("restoreDefaultLogins", tab.getAttribute(loginsAttr));

    var tabLogins;
    try {
      // TODO delay until tab is actually loaded (@ findUser?)
      tabLogins = JSON.parse(tab.getAttribute(loginsAttr));
    } catch (ex) {
      console.error(ex, "restoreTabDefaultUsers - buggy json", tab.getAttribute(loginsAttr));
      return;
    }

    if (("firstParty" in tabLogins) === false) {
      return;
    }

    var logins = tabLogins.firstParty;
    var tabId = getTabIdFromBrowser(tab.linkedBrowser);
    var obj;
    var userId;
    for (var tld in logins) {
      obj = logins[tld];
      userId = new UserId(obj.encodedUser, obj.encodedTld);
      UserState.setTabDefaultFirstParty(tld, tabId, userId);
    }
  }

};



var DebugWinMap = {

  toString: function() {
    var usedInners = [];
    var usedOuters = [];
    var output = [];
    var intId;

    for (var id in WinMap._outer) {
      intId = parseInt(id, 10);
      var outerWin = WinMap.getOuterEntry(intId);
      if (outerWin.parentOuter === WindowUtils.WINDOW_ID_NONE) {
        this._debugOuter(intId, output, "", usedOuters, usedInners, outerWin);
      }
    }

    for (var id in WinMap._outer) {
      intId = parseInt(id, 10);
      if (usedOuters.indexOf(intId) === -1) {
        output.unshift("*** outer not displayed " + intId, "---");
      }
    }

    for (var id in WinMap._inner) {
      intId = parseInt(id, 10);
      if (usedInners.indexOf(intId) === -1) {
        var win = Services.wm.getCurrentInnerWindowWithId(intId);
        output.unshift("*** inner not displayed " + intId + " " + (win ? win.location : win), "---");
      }
    }

    output.push("--------------------");
    output.push("_waitingRemoval");
    output.push(JSON.stringify(WinMap._waitingRemoval, null, 2));

    output.push("--------------------");
    output.push("_childrenCount");
    output.push(JSON.stringify(WinMap._childrenCount, null, 2));

    return output.join("\n");
  },


  _debugOuter: function(intOuterId, output, padding, usedOuters, usedInners, outerWin) {
    var win = Services.wm.getOuterWindowWithId(intOuterId);

    // removed outer window?
    var currentInner = (win === null) || (win.location === null)
                     ? WindowUtils.WINDOW_ID_NONE
                     : getDOMUtils(win).currentInnerWindowID;
    var ok = false;

    for (var id in WinMap._inner) {
      var obj = WinMap._inner[id];
      if (obj.outerId !== intOuterId) {
        continue;
      }
      ok = true;
      usedInners.push(obj.innerId);
      var s = padding;

      s += " " + intOuterId + "[" + obj.innerId + "] ";
      if (outerWin.parentOuter === WindowUtils.WINDOW_ID_NONE) {
        if (outerWin.isInsideTab === false) {
          s += "<outside tab>";
        }
      }


      if (obj.isTop === false) {
        if ((obj.parentId in WinMap._inner) === false) {
          s += "<parent " + obj.parentId + " not found!>";
        }
      }

      if (obj.innerId in WinMap._waitingRemoval) {
        s += "<waitingRemoval>";
      }

      if (obj.openerId !== WindowUtils.WINDOW_ID_NONE) {
        s += "[opener=" + obj.openerId + "] ";
      }

      var win2 = Services.wm.getCurrentInnerWindowWithId(obj.innerId);
      if (!win2) {
        s += "[win=" + win2 + "] ";
      }

      if ("docUserObj" in obj) {
        var docUser = obj.docUserObj;
        s += "{" + docUser.user.plainName + "/" + docUser.user.plainTld + "}  ";
      }
      var urlObj = obj.documentElementInserted ? obj.originalUri.spec : "";
      s += urlObj.substr(0, 140);
      if (urlObj.length === 0) {
        s += "<url empty>";
      }
      if (currentInner === WindowUtils.WINDOW_ID_NONE) {
        s += " <outer removed>";
      } else {
        if (currentInner === obj.innerId) {
          if (win.location.href !== urlObj) {
            s += " - actual URL: " + win.location.href.substr(0, 140);
          }
        } else {
          s += " <not visible>";
        }
      }
      output.push(s);
    }
    if (ok === false) {
      output.unshift("*** outer without an innerId=" + obj.innerId + " obj.outerId=" + obj.outerId + " intOuterId=" + intOuterId, "---");
    }

    usedOuters.push(intOuterId);
    for (var id in WinMap._outer) {
      var intId = parseInt(id, 10);
      var outerWin = WinMap.getOuterEntry(intId);
      if (outerWin.parentOuter === intOuterId) {
        this._debugOuter(intId, output, padding + "        ", usedOuters, usedInners, outerWin);
      }
    }
  }

};



var LoginCopy = {  // TODO needed only for new outer wins
  fromOpener: function(src, targetWin) { // TODO still necessary?
    if (targetWin.openerId === WindowUtils.WINDOW_ID_NONE) {
      return;
    }

    var sourceWin = WinMap.getInnerWindowFromId(targetWin.openerId);
    var sourceOuter = WinMap.getOuterEntry(sourceWin.topWindow.outerId);
    var targetOuter = WinMap.getOuterEntry(targetWin.topWindow.outerId);

    if ("x-opener-order" in targetOuter) {
      targetOuter["x-opener-order"] += " " + src;
    } else {
      targetOuter["x-opener-order"] = src;
    }
    if ("opener-logins-migrated" in targetOuter) {
      return;
    }

    targetOuter["opener-logins-migrated"] = true;
    this._copyLogins(targetOuter, sourceOuter);
  },


  _copyLogins: function(targetTabData, sourceTabData) {
    if (("tabLogins" in sourceTabData) === false) {
      return; // nothing to copy
    }

    if (("tabLogins" in targetTabData) === false) {
      targetTabData.tabLogins = {firstParty: Object.create(null)};
      // TODO remove targetTabData.tabLogins if it's empty
    }

    var targetLogins = targetTabData.tabLogins.firstParty;
    var openerLogins = sourceTabData.tabLogins.firstParty;

    // copy defaults logins to (new?) tab
    for (var tld in openerLogins) {
      // do not overwrite existing logins
      if ((tld in targetLogins) === false) {
        console.log("_copyLogins", tld, openerLogins[tld]);
        targetLogins[tld] = openerLogins[tld];
      }
    }
  }

};
