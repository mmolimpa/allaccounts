/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var NewDocUser = {

  addNewDocument: function(msgData, innerWinParent) {
    var outerEntry = {
      __proto__: null,
      type: "domcreated",
      "inner-id": msgData.inner,
      "original-url": msgData.url
    };

    var parentOuterId = WindowUtils.WINDOW_ID_NONE;
    var parentInnerId = WindowUtils.WINDOW_ID_NONE;
    if (innerWinParent !== null) {
      parentOuterId = innerWinParent.outerId;
      parentInnerId = innerWinParent.innerId;
      outerEntry.parent = innerWinParent.originalUri.spec;
    }

    var outerData = WinMap.addToOuterHistory(outerEntry, msgData.outer, parentOuterId);

    LoginCopy.fromOpener(msgData, outerData, "domcreated");

    var innerObj = WinMap.addInner(msgData);

    var docUser = WinMap.findUser(innerObj.originalUri, innerObj.topId); // TODO reuse it from req/resp
    if (docUser !== null) {
      // logged in tld
      innerObj.docUserObj = docUser; // used by assets/iframes
    } else {
      // anon tld: inherit it from a parent
      docUser = WinMap.getNextSavedUser(parentInnerId);
    }

    return docUser !== null;
  },


  addDocumentRequest: function(msgData, requestURI) {
    var isTop = WinMap.isTabId(msgData.parentInner);
    var tldPrev = isTop ? CrossTldLogin.getPrevDocTld(msgData.outer) : null; // should be called before addToOuterHistory

    var entry = {
      __proto__: null,
      type: "request-doc", // "request"
      visibleInnerId: msgData.visibleInner, // currentInnerId / "previous" inner document
      url:  requestURI.spec // TODO useless?
    };

    var parentOuterId = msgData.parentInner === WindowUtils.WINDOW_ID_NONE
                      ? WindowUtils.WINDOW_ID_NONE
                      : WinMap.getInnerWindowFromId(msgData.parentInner).outerId;

    var outerData = WinMap.addToOuterHistory(entry, msgData.outer, parentOuterId);

    LoginCopy.fromOpener(msgData, outerData, "request");

    var topInnerId;
    var docUser;
    if (WinMap.isTabId(msgData.parentInner)) {
      // topInnerId is not valid, it doesn't exist (yet)
      // requestURI is the new top document (or a download/redir, it is undefined)
      topInnerId = WindowUtils.WINDOW_ID_NONE;
      docUser = WinMap.findUser(requestURI, topInnerId, msgData.outer);
    } else {
      topInnerId = WinMap.getInnerWindowFromId(msgData.visibleInner).topId;
      docUser = WinMap.findUser(requestURI, topInnerId);
    }

    if (docUser === null) {
      // anon request: inherit it from a parent
      docUser = WinMap.getNextSavedUser(msgData.parentInner);
    }


    if (isTop && (docUser === null)) {
      // BUG docUser from a logged in iframe never will be != null
      docUser = CrossTldLogin.parse(tldPrev, requestURI, msgData.outer, topInnerId);
      if (docUser !== null) {
        entry["x-tld-login"] = true;
      }
    }

    if (docUser !== null) {
      entry.reqDocUserObj = docUser; // used by response
    }
    return docUser;
  },


  // getLoginForDocumentResponse
  // currentInnerId (possibly) is going to be replaced by a new document
  addDocumentResponse: function(channel, currentInnerId, outerId) {
    var stat = channel.responseStatus;
    var entry = {
      __proto__:   null,
      type:        "response-doc",
      http_status: stat,
      contentType: channel.contentType,
      visibleInnerId: currentInnerId,
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

    WinMap.addToOuterHistory(entry, outerId);

    // should fetch login from request, because it could be a not logged in iframe
    // (which should inherit login from parent)
    var log = this._findDocRequest(currentInnerId, outerId);
    console.assert(log !== null, "reponse without a request");
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


  viewSourceRequest: function(sourceWin, uri) { // sourceWin = viewSource.xul
    var chromeWin = UIUtils.getTopLevelWindow(sourceWin);
    if (chromeWin && chromeWin.opener) {
      if (UIUtils.isMainWindow(chromeWin.opener)) {
        var selTab = UIUtils.getSelectedTab(chromeWin.opener);
        return WinMap.findUser(uri, getCurrentTopInnerId(selTab), getIdFromTab(selTab));
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
      console.assert((id in this._waitingRemoval) === false, "id already in _waitingRemoval", id);
      this._waitingRemoval[id] = true;
      return;
    }

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
  },


  getOuterEntry: function(id) {
    console.assert(typeof id === "number", "getOuterEntry invalid param", id);
    if (id in this._outer) {
      return this._outer[id];
    }
    this._update();
    console.assert(id in this._outer, "getOuterEntry - outerId not found", id);
    return this._outer[id];
  },


  getInnerWindowFromId: function(id) {
    console.assert(typeof id === "number", "getInnerWindowFromId invalid type", id);
    console.assert(id !== WindowUtils.WINDOW_ID_NONE, "inner id - invalid value", id);
    if (id in this._inner) {
      return id in this._waitingRemoval ? null : this._inner[id];
    }
    this._update();
    console.assert(id in this._inner, "getInnerWindowFromId - innerId not found", id);
    return this._inner[id];
  },


  getInnerWindowFromObj: function(win) {
    return WinMap.getInnerWindowFromId(getDOMUtils(win).currentInnerWindowID);
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


  getInnerWindowIterator: function*() {
    for (var id in this._inner) {
      yield this._inner[id];
    }
    return null;
  },


  loginSubmitted: function(win, data, docUser) {
    var entry = {
      __proto__: null,
      type:      "pw-submit",
      submitted: data,
      tld: getTldFromHost(win.location.hostname)
    };

    var innerWin = WinMap.getInnerWindowFromObj(win);
    WinMap.addToOuterHistory(entry, innerWin.outerId);
    if (docUser !== null) {
      UserChange.add(docUser, innerWin.topWindow.outerId);
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
      this._outer[outerId] = outerData;
      outerData["x-history-length"] = 1;
    }
    this._pushHistory(newHistObj, outerData.outerHistory);
    return outerData;
  },


  _pushHistory: function(entry, outerHistory) {
    if (outerHistory.length > 30) {
      var delQty = outerHistory.length - 10;
      outerHistory.splice(0, delQty, entry);
    } else {
      outerHistory.push(entry);
    }
  },


  isFrameId: function(parentId) { // outer/inner
    return parentId !== WindowUtils.WINDOW_ID_NONE;
  },


  isTabId: function(parentId) {
    return parentId === WindowUtils.WINDOW_ID_NONE;
  },


  getTabId: function(outerId) { // used by fromOpener
    console.assert(typeof outerId === "number", "getTabId invalid type", outerId);
    console.assert(outerId !== WindowUtils.WINDOW_ID_NONE, "getTabId invalid param", outerId);
    var all = this._outer;
    if ((outerId in all) === false) {
      this._update();
    }
    console.assert(outerId in all, "getTabId not found", outerId);
    var win = all[outerId];
    while (WinMap.isFrameId(win.parentOuter)) {
      outerId = win.parentOuter;
      win = all[outerId];
    }
    return outerId;
  },


  findUser: function(uriDoc, topInnerId, tabId) { // TODO only tld is necessary
    var tld = getTldFromUri(uriDoc);
    if (tld === null) {
      return null;
    }

    // check if this top document (or its elements) has previous requests to tld
    var userId;
    if (topInnerId === WindowUtils.WINDOW_ID_NONE) {
      // assume uriDoc as a top document
      console.assert(typeof tabId !== "undefined", "topInnerId invalid; tabId not defined");
      userId = UserState.getTabDefaultFirstPartyUser(tld, tabId);
    } else {
      var topData = WinMap.getInnerWindowFromId(topInnerId);
      if (tld === topData.eTld) {
        // uriDoc ==> first-party
        userId = UserState.getTabDefaultFirstPartyUser(tld, topData.outerId);
      } else {
        userId = UserState.getTabDefaultThirdPartyUser(tld, topInnerId);
      }
    }

    if (userId === null) {
      // is the first time tld is used in this tab?
      userId = LoginDB.getDefaultUser(StringEncoding.encode(tld)); // 1st/3rd-party
    }

    return userId === null ? null
                           : new DocumentUser(userId, tld, topInnerId);
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
  getUserForAssetUri: function(innerId, resUri) {
    // parent window docUser
    var docUser = this.getSavedUser(innerId);
    if (docUser !== null) {
      // BUG? facebook img inside twitter ignores facebook id?
      return docUser;
    }

    // owner document is anon

    // resUri could be a logged in tld (different from anonymous innerId)
    var assetUser = this.findUser(resUri, WinMap.getInnerWindowFromId(innerId).topId);
    return assetUser === null ? null : this.getAsAnonUser(innerId, resUri);
  },


  getAsAnonUser: function(innerId, uri) { // TODO remove uri
    var entry = WinMap.getInnerWindowFromId(innerId);
    console.assert(("docUserObj" in entry) === false, "innerId is not anon", uri, innerId, entry);
    var tld = entry.eTld;
    if (tld === null) {
      // "about:"
      tld = getTldForUnsupportedScheme(entry.originalUri);
    }
    return new DocumentUser(null, tld, entry.topId);
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
    var tabId = getIdFromTab(tab);
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
      if (WinMap.isTabId(WinMap.getOuterEntry(intId).parentOuter)) {
        this._debugOuter(intId, output, "", usedOuters, usedInners);
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
        output.unshift("*** inner not displayed " + intId, "---");
      }
    }

    output.push("_waitingRemoval");
    output.push(JSON.stringify(WinMap._waitingRemoval, null, 2));

    output.push("_childrenCount");
    output.push(JSON.stringify(WinMap._childrenCount, null, 2));

    return output.join("\n");
  },


  _debugOuter: function(intOuterId, output, padding, usedOuters, usedInners) {
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

      if (WinMap.isTabId(obj.parentId) === false) { // TODO obj.isTop === false
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
      s += obj.originalUri.spec.substr(0, 140);
      if (obj.originalUri.spec.length === 0) {
        s += "<url empty>";
      }
      if (currentInner === WindowUtils.WINDOW_ID_NONE) {
        s += " <outer removed>";
      } else {
        if (currentInner === obj.innerId) {
          if (win.location.href !== obj.originalUri.spec) {
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
      if (WinMap.getOuterEntry(intId).parentOuter === intOuterId) {
        this._debugOuter(intId, output, padding + "        ", usedOuters, usedInners);
      }
    }
  }

};



var LoginCopy = {  // TODO needed only for new outer wins
  fromOpener: function(msgData, outerData, src) { // TODO still necessary?
    console.assert("openerInnerId" in msgData, "openerInnerId not defined", msgData);
    if (msgData.openerInnerId === WindowUtils.WINDOW_ID_NONE) {
      return;
    }

    console.assert(msgData.parentInner === WindowUtils.WINDOW_ID_NONE, "do frames have an opener? maybe, target=name_iframe");

    if ("x-opener-order" in outerData) {
      outerData["x-opener-order"] += " " + src;
    } else {
      outerData["x-opener-order"] = src;
    }
    if ("opener-logins-migrated" in outerData) {
      return;
    }

    if ("openerOuterId" in outerData) {
      console.assert(outerData.openerOuterId === WinMap.getInnerWindowFromId(msgData.openerInnerId).outerId,
                     "outerData.openerOuterId !== msgData.openerOuter");
    } else {
      outerData.openerOuterId = msgData.openerInnerId === WindowUtils.WINDOW_ID_NONE
                              ? WindowUtils.WINDOW_ID_NONE
                              : WinMap.getInnerWindowFromId(msgData.openerInnerId).outerId;
    }

    outerData["opener-logins-migrated"] = outerData.openerOuterId;

    var openerTabId = WinMap.getTabId(outerData.openerOuterId);
    var targetTabId = WinMap.getTabId(msgData.outer);
    this._copyLogins(targetTabId, openerTabId);
  },


  _copyLogins: function(targetTabId, sourceTabId) {
    console.assert(targetTabId !== sourceTabId, "_copyLogins same tab", sourceTabId);
    var sourceTabData = WinMap.getOuterEntry(sourceTabId);
    if (("tabLogins" in sourceTabData) === false) {
      return; // nothing to copy
    }

    var targetTabData = WinMap.getOuterEntry(targetTabId);
    if (("tabLogins" in targetTabData) === false) {
      targetTabData.tabLogins = {firstParty: Object.create(null)};
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
