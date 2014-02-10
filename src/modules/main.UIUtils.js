/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var UIUtils = {

  getWindowEnumerator: function() {
    return Services.wm.getEnumerator("navigator:browser");
  },


  getMostRecentWindow: function() {
    return Services.wm.getMostRecentWindow("navigator:browser");
  },


  isMainWindow: function(chromeWin) {
    return this._getWindowType(chromeWin) === "navigator:browser";
  },


  isSourceWindow: function(chromeWin) {
    return this._getWindowType(chromeWin) === "navigator:view-source";
  },


  _getWindowType: function(chromeWin) {
    return chromeWin.document.documentElement.getAttribute("windowtype");
  },


  getContentContainer: function(chromeWin) {
    console.assert(this.isMainWindow(chromeWin), "Not a browser window", chromeWin);
    return chromeWin.gBrowser; // <tabbrowser>
  },


  getTabStripContainer: function(chromeWin) {
    console.assert(this.isMainWindow(chromeWin), "Not a browser window", chromeWin);
    return chromeWin.gBrowser.tabContainer; // <tabs>
  },


  getTabList: function(chromeWin) {
    console.assert(this.isMainWindow(chromeWin), "Not a browser window", chromeWin);
    return chromeWin.gBrowser.tabs; // <tab> NodeList
  },


  getSelectedTab: function(chromeWin) {
    console.assert(this.isMainWindow(chromeWin), "Not a browser window", chromeWin);
    return chromeWin.gBrowser.selectedTab; // <tab>
  },


  // browser.xul has browser elements all over the place
  isContentBrowser: function(browser) {
    console.assert(browser !== null, "browser should not be null");
    // edge case: browser (and tab) already removed from DOM
    //            (browser.parentNode === null)
    var t = browser.getAttribute("type");
    return (t === "content-primary") || (t === "content-targetable");
  },


  getLinkedTabFromBrowser: function(browser) { // TODO tabList[getDOMUtils(browser.contentWindow).outerWindowID]
    var win = this.getTopLevelWindow(browser.ownerDocument.defaultView);
    if (UIUtils.isMainWindow(win)) {
      var tabList = this.getTabList(win);
      for (var idx = tabList.length - 1; idx > -1; idx--) {
        if (tabList[idx].linkedBrowser === browser) {
          return tabList[idx]; // <tab>
        }
      }
    }
    throw new Error("getLinkedTabFromBrowser: tab not found");
  },


  getParentBrowser: function(win) {
    console.assert(win !== null, "getParentBrowser win=null");
    var browser = win.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShell)
                     .chromeEventHandler;
    if (browser === null) {
      return null;
    }
    if (browser.tagName === "xul:browser") {
      return browser;
    }
    if (browser.tagName === "browser") {
      return browser;
    }
    // e.g. <iframe> chrome://browser/content/devtools/cssruleview.xhtml
    console.log("not a browser element", browser.tagName, win, win.parent);
    return null;
  },


  isPrivateWindow: function(win) {
    var ns = {};
    Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm", ns);
    return ns.PrivateBrowsingUtils.isWindowPrivate(win);
  },


  getTopLevelWindow: function(win) { // content or chrome windows
    if ((!win) || (!win.QueryInterface)) {
      console.trace("getTopLevelWindow win=" + win);
      return null;
    }

    var topwin = win.QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIWebNavigation)
                    .QueryInterface(Ci.nsIDocShellTreeItem)
                    .rootTreeItem
                    .QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIDOMWindow);

    console.assert(topwin !== null, "getTopLevelWindow null", win);
    console.assert(topwin !== undefined, "getTopLevelWindow undefined", win);
    console.assert(topwin === topwin.top, "getTopLevelWindow should return a top window");
    // unwrapped object allows access to gBrowser etc
    return XPCNativeWrapper.unwrap(topwin);
  }

};


var WindowUtils = {
  WINDOW_ID_NONE: -1
};
