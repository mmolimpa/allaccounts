/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var ContentRelatedEvents = {

  init: function() {
    var obs = Services.obs;
    obs.addObserver(this._onOuterDestroyed, "outer-window-destroyed", false);
    obs.addObserver(this._onInnerDestroyed, "inner-window-destroyed", false);
    obs.addObserver(this._onDocCreated, "chrome-document-global-created", false); // about:newtab
    obs.addObserver(this._onDocCreated, "content-document-global-created", false);
    obs.addObserver(this._onDocElementInserted, "document-element-inserted", false);
    obs.addObserver(this._onRemoteMsg, "${BASE_DOM_ID}-remote-msg", false);
  },


  uninit: function() {
    var obs = Services.obs;
    obs.removeObserver(this._onOuterDestroyed, "outer-window-destroyed");
    obs.removeObserver(this._onInnerDestroyed, "inner-window-destroyed");
    obs.removeObserver(this._onDocCreated, "chrome-document-global-created");
    obs.removeObserver(this._onDocCreated, "content-document-global-created");
    obs.removeObserver(this._onDocElementInserted, "document-element-inserted");
    obs.removeObserver(this._onRemoteMsg, "${BASE_DOM_ID}-remote-msg");
  },


  initWindow: function(win) {
    UIUtils.getContentContainer(win)
           .addEventListener("pageshow", this._onPageShow, false);
  },


  uninitWindow: function(win, reason) {
    UIUtils.getContentContainer(win)
           .removeEventListener("pageshow", this._onPageShow, false);
    if (reason === "closing window") {
      return;
    }
    // disabling Multifox
    /*
    var srcCode = this._loadResetCode();
    var mm = win.messageManager;
    mm.removeDelayedFrameScript("${PATH_MODULE}/remote-browser.js");
    mm.removeMessageListener("${BASE_DOM_ID}-remote-msg", this._onRemoteBrowserMessage);
    mm.sendAsyncMessage("${BASE_DOM_ID}-parent-msg", {msg: "disable-extension", src: srcCode});
    */
  },


  /*
  _loadResetCode: function() {
    var src = null;
    var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.onload = function() {
      src = xhr.responseText;
    };
    xhr.open("GET", "${PATH_CONTENT}/content-injection-reset.js", false);
    xhr.overrideMimeType("text/plain");
    xhr.send(null); // synchronous
    return src;
  },
  */


  _onInnerDestroyed: {
    observe: function(subject, topic, data) {
      var id = subject.QueryInterface(Ci.nsISupportsPRUint64).data;
      WinMap.removeInner(id);
    }
  },


  _onOuterDestroyed: {
    observe: function(subject, topic, data) {
      var id = subject.QueryInterface(Ci.nsISupportsPRUint64).data;
      WinMap.removeOuter(id);
    }
  },


  _onDocCreated: {
    observe: function(win, topic, data) {
      NewDocUser.registerWindow(WinMap.populateWinData(win), false); // location unknown
    }
  },


  _onRemoteMsg: {
    observe: function(subject, topic, data) {
      var parentBrowser = subject;
      console.assert(parentBrowser.localName === "browser", "not a browser element");

      var rv = ContentRelatedEvents._onRemoteBrowserMessage({
        target: parentBrowser,
        json:   JSON.parse(data)
      });
      // send the return value to remote-browser
      m_remote.setRemoteValue(rv);
    }
  },


  _onRemoteBrowserMessage: function(message) {
    // this = nsIChromeFrameMessageManager
    try {
      var msgData = message.json;
      var browser = message.target;
      var innerWin = null;
      if (msgData.from !== "new-doc") {
        innerWin = WinMap.getInnerWindowFromId(msgData.inner);
        console.assert(innerWin.isInsideTab, "command from invalid window", msgData);
      }
      return RemoteBrowserMethod[msgData.from](msgData, innerWin, browser);

    } catch (ex) {
      console.error(ex);
    }
  },


  // OBS: document-element-inserted is not triggered by about:blank / xul docs
  _onDocElementInserted: {
    observe: function(subject, topic, data) {
      var win = subject.defaultView;
      if (win === null) {
        return; // xsl/xbl chrome://....xml
      }

      if (UIUtils.isPrivateWindow(win)) {
        return;
      }

      m_remote.onNewDocument(win);
    }
  },


  // pageshow event => call updateUIAsync for bfcache or non http/https protocols
  _onPageShow: function(evt) {
    try {
      var doc = evt.target; // pageshow handler
      var win = doc.defaultView;

      if (isSupportedScheme(win.location.protocol)) {
        // BUG rightclick>show image ==> evt.persisted=false
        // BUG google login persists: google => br.mozdev=>back=>fw
        var fromCache = evt.persisted;
        if (fromCache) {
          // http top doc from cache: update icon
          var innerWin = WinMap.getInnerWindowFromObj(win);
          if (innerWin.isInsideTab) {
            if ("docUserObj" in innerWin) {
              var tabId = innerWin.topWindow.outerId;
              var docUser = innerWin.docUserObj;
              UserState.setTabDefaultFirstParty(docUser.ownerTld, tabId, docUser.user); // BUG [?] a 3rd party iframe may become the default
            }
            updateUIAsync(UIUtils.getParentBrowser(win), innerWin.isTop);
          }
        }

      } else { // ftp:, about:, chrome: etc. request/response listener may not be called
        var innerWin = WinMap.getInnerWindowFromObj(win);
        console.assert(innerWin !== null, "win null", win,
                       getDOMUtils(win).currentInnerWindowID);
        if (innerWin.isInsideTab) {
          updateUIAsync(UIUtils.getParentBrowser(win), innerWin.isTop);
        }
      }


    } catch (ex) {
      console.error(ex);
    }
  }

};



var RemoteBrowserMethod = {

  cookie: function(msgData, innerWin) {
    var docUser = WinMap.getSavedUser(innerWin.innerId);
    if (docUser === null) {
      console.assert(innerWin.isFirstParty === false, "anon 1st-party windows are not customized", innerWin);
      docUser = WinMap.getAsAnonUserJs(innerWin.topWindow, innerWin.eTld);
    }

    switch (msgData.cmd) {
      case "set":
        Cookies.setCookie(docUser, innerWin.originalUri, msgData.value, true);
        return null;

      case "get":
        var val = "foo@documentCookie";
        try {
          var cookie = Cookies.getCookie(true, docUser.wrapUri(innerWin.originalUri));
          val = cookie === null ? "" : cookie;
        } catch (ex) {
          console.trace(ex, innerWin);
        }
        return {responseData: val};

      default:
        throw new Error("documentCookie " + msgData.cmd);
    }
  },


  localStorage: function(msgData, innerWin) {
    var docUser = WinMap.getSavedUser(innerWin.innerId);
    if (docUser === null) {
      console.assert(innerWin.isFirstParty === false, "anon 1st-party windows are not customized", innerWin);
      docUser = WinMap.getAsAnonUserJs(innerWin.topWindow, innerWin.eTld);
    }

    var principal = Services.scriptSecurityManager
                   .getNoAppCodebasePrincipal(docUser.wrapUri(innerWin.originalUri));
    var domObj; // nsIDOMStorage

    if (docUser.isAnonWrap(innerWin.originalUri.host)) {
      // TODO one storage per doc document?
      domObj = Cc["@mozilla.org/dom/sessionStorage-manager;1"]
                .createInstance(Ci.nsIDOMStorageManager);
    } else {
      // TODO 1st-party NewAccount should use temp storage
      console.log("localStorage LOGGED IN", msgData.cmd, innerWin.originalUri.host);
      domObj = Services.domStorageManager;
    }

    var storage = m_oldMoz ? domObj.createStorage(principal, "")
                           : domObj.createStorage(null, principal, "");

    var rv = null;
    var oldVal;
    var eventData = null;

    switch (msgData.cmd) {
      case "clear":
        if (storage.length > 0) {
          eventData = ["", null, null];
        }
        storage.clear();
        break;
      case "removeItem":
        oldVal = storage.getItem(msgData.key);
        if (oldVal !== null) {
          eventData = [msgData.key, oldVal, null];
        }
        storage.removeItem(msgData.key);
        break;
      case "setItem":
        oldVal = storage.getItem(msgData.key);
        if (oldVal !== msgData.val) {
          eventData = [msgData.key, oldVal, msgData.val];
        }
        storage.setItem(msgData.key, msgData.val); // BUG it's ignoring https
        break;
      case "getItem":
        rv = {responseData: storage.getItem(msgData.key)};
        break;
      case "key":
        rv = {responseData: storage.key(msgData.index)};
        break;
      case "length":
        rv = {responseData: storage.length};
        break;
      default:
        throw new Error("localStorage interface unknown: " + msgData.cmd);
    }

    if (eventData !== null) {
      this._localStorageEvent(eventData, docUser, innerWin.innerId);
    }

    return rv;
  },


  _localStorageEvent: function(data, srcDocUser, srcInnerId) {
    var srcWin = Services.wm.getCurrentInnerWindowWithId(srcInnerId);
    var srcOrigin = srcWin.location.origin;
    var evt = null;

    for (var innerWin of WinMap.getContentInnerWindowIterator()) {
      if (innerWin.origin !== srcOrigin) {
        continue;
      }
      var docUser = WinMap.getSavedUser(innerWin.innerId);
      if (docUser === null) {
        continue;
      }
      if (UserUtils.equalsUser(srcDocUser.user, docUser.user) === false) {
        continue;
      }
      if (innerWin.innerId === srcInnerId) {
        continue;
      }
      var win = Services.wm.getCurrentInnerWindowWithId(innerWin.innerId);
      if ((win === null) || (win.document === null)) { // bfcached?
        console.trace("_localStorageEvent win doc null", win, innerWin);
        continue;
      }

      // event from srcWin *sometimes* has permission issues.
      // (properties from event cannot be read)
      var evt = win.document.createEvent("StorageEvent");
      evt.initStorageEvent("storage", false, false, data[0], data[1], data[2], srcWin.location.href, null);
      try {
        win.dispatchEvent(evt);
      } catch (ex) {
        // [nsIException: [Exception... "Component returned failure code:
        // 0x80004005 (NS_ERROR_FAILURE) [nsIDOMEventTarget.dispatchEvent]"
        console.trace("_localStorageEvent exception", ex.name, ex.message, srcInnerId, innerWin);
      }
    }
  },


  "new-doc": function(msgData, innerWinNull, browser) {
    var customize = NewDocUser.onDocElementInserted(msgData); // may create InnerWindow
    var innerWin = WinMap.getInnerWindowFromId(msgData.inner);
    if (innerWin.isInsideTab) {
      updateUIAsync(browser, innerWin.isTop);
    }

    if (customize) {
      // tell remote browser to apply script to document
      if (!("initBrowser" in msgData)) {
        return {};
      }
      if (m_scriptSource === null) {
        m_scriptSource = new ScriptSource();
      }
      return m_scriptSource.getSource();
    } else {
      return null; // ignore document
    }
  },


  "error": function(msgData, innerWinNotUsed, browser) {
    //console.assert(message.sync === false, "use sendAsyncMessage!");
    enableErrorMsg(browser, msgData.inner, msgData.cmd, msgData.err);
    return null;
  }

};
