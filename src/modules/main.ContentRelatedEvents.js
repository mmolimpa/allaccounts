/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var ContentRelatedEvents = {

  init: function() {
    var obs = Services.obs;
    obs.addObserver(this._onOuterDestroyed, "outer-window-destroyed", false);
    obs.addObserver(this._onInnerDestroyed, "inner-window-destroyed", false);
    obs.addObserver(this._onDocElementInserted, "document-element-inserted", false);
    obs.addObserver(this._onRemoteMsg, "${BASE_DOM_ID}-remote-msg", false);
  },


  uninit: function() {
    var obs = Services.obs;
    obs.removeObserver(this._onOuterDestroyed, "outer-window-destroyed");
    obs.removeObserver(this._onInnerDestroyed, "inner-window-destroyed");
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


  _onRemoteMsg: {
    observe: function(subject, topic, data) {
      var parentBrowser = subject;

      console.assert((parentBrowser.tagName === "xul:browser") || (parentBrowser.tagName === "browser"),
                     "not a browser element");

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
      var browser = message.target;
      if (UIUtils.isContentBrowser(browser) === false) {
        console.assert(msgData.from !== "new-doc", "not a content new window");
        return null; // social-sidebar-browser etc
      }

      var msgData = message.json;
      if ("url" in msgData) {
        if (msgData.url.length > 0) {
          msgData.uri = Services.io.newURI(msgData.url, null, null);
        } else {
          msgData.uri = null;
        }
      }
      return RemoteBrowserMethod[msgData.from](msgData, browser);

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
          var browser = UIUtils.getParentBrowser(win);
          if (UIUtils.isContentBrowser(browser)) {
            var innerId = getDOMUtils(win).currentInnerWindowID;
            var data = WinMap.getInnerEntry(innerId);
            if ("docUserObj" in data) {
              var tabId = WinMap.getTabId(data.outerId);
              var docUser = data.docUserObj;
              UserState.setTabDefaultFirstParty(docUser.ownerTld, tabId, docUser.user); // BUG [?] a 3rd party iframe may become the default
            }
            var tab = UIUtils.getLinkedTabFromBrowser(browser);
            updateUIAsync(tab, isTopWindow(win));
          }
        }

      } else { // ftp:, about:, chrome: etc. request/response listener may not be called
        var browser = UIUtils.getParentBrowser(win);
        if (UIUtils.isContentBrowser(browser)) {
          var tab = UIUtils.getLinkedTabFromBrowser(browser);
          updateUIAsync(tab, isTopWindow(win));
        }
      }


    } catch (ex) {
      console.error(ex);
    }
  }

};



var RemoteBrowserMethod = {

  cookie: function(msgData) {
    var docUser = WinMap.getSavedUser(msgData.inner);
    console.assert(docUser !== null, "docUser should be valid");

    switch (msgData.cmd) {
      case "set":
        Cookies.setCookie(docUser, msgData.uri, msgData.value, true);
        return null;

      case "get":
        var val = "foo@documentCookie";
        try {
          var cookie = Cookies.getCookie(true, docUser.wrapUri(msgData.uri));
          val = cookie === null ? "" : cookie;
        } catch (ex) {
          console.trace(ex);
        }
        return {responseData: val};

      default:
        throw new Error("documentCookie " + msgData.cmd);
    }
  },


  localStorage: function(msgData) {
    var docUser = WinMap.getSavedUser(msgData.inner);
    console.assert(docUser !== null, "docUser should be valid");

    var uri = docUser.wrapUri(msgData.uri);
    var principal = Services.scriptSecurityManager.getNoAppCodebasePrincipal(uri);
    var storage; // nsIDOMStorage

    if (docUser.is1stParty(getTldFromHost(msgData.uri.host))) {
      storage = Services.domStorageManager.createStorage(principal, "");
    } else {
      // TODO one storage per doc document
      console.log("localStorage 3rd-party", msgData.uri.host, msgData.cmd);
      storage = Cc["@mozilla.org/dom/sessionStorage-manager;1"]
                  .createInstance(Ci.nsIDOMStorageManager)
                  .createStorage(principal, "");
    }

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
      this._localStorageEvent(eventData, docUser, msgData.inner);
    }

    return rv;
  },


  _localStorageEvent: function(data, srcDocUser, srcInnerId) {
    var srcWin = Services.wm.getCurrentInnerWindowWithId(srcInnerId);
    var srcOrigin = srcWin.location.origin;
    var evt = null;

    var enumWin = WinMap.getInnerIdEnumerator();
    for (var innerStr in enumWin) {
      var innerId = parseInt(innerStr, 10);
      var docUser = WinMap.getSavedUser(innerId);
      if (docUser === null) {
        continue;
      }
      if (UserUtils.equalsUser(srcDocUser.user, docUser.user) === false) {
        continue;
      }
      var win = Services.wm.getCurrentInnerWindowWithId(innerId); // null=>bfcached?
      if ((win === null) || (win.location === null) ||
         (win.location.origin !== srcOrigin) || (srcInnerId === innerId)) {
        continue;
      }
      if (evt === null) {
        evt = srcWin.document.createEvent("StorageEvent");
        evt.initStorageEvent("storage", false, false, data[0], data[1], data[2], srcWin.location.href, null);
      }
      win.dispatchEvent(evt);
    }
  },


  "new-doc": function(msgData, browser) {
    var isTop = WinMap.isTabId(msgData.parentOuter);
    var customize = NewDocUser.addNewDocument(msgData);
    var tab = UIUtils.getLinkedTabFromBrowser(browser);
    updateUIAsync(tab, isTop);
    if (customize) {
      // tell remote browser to apply script to document
      return "initBrowser" in msgData ? DocOverlay.getInitBrowserData() : {};
    } else {
      return null; // ignore document
    }
  },


  "error": function(msgData, browser) {
    //console.assert(message.sync === false, "use sendAsyncMessage!");
    var tab = UIUtils.getLinkedTabFromBrowser(browser);
    enableErrorMsg(msgData.cmd, msgData, tab);
    return null;
  }

};
