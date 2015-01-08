/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = ["onNewDocument", "setRemoteValue"];

var Ci = Components.interfaces;
var Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");

#include "console.js"
  console.setAsRemote();


function populateWinData(win) {
  var utils = getDOMUtils(win);
  var msgData = {
    inner:       utils.currentInnerWindowID,
    outer:       utils.outerWindowID,
    url:         win.location.href,
    origin:      win.location.origin,
    topId:         -1, // WindowUtils.WINDOW_ID_NONE
    parentInner:   -1, // WindowUtils.WINDOW_ID_NONE
    openerInnerId: -1  // WindowUtils.WINDOW_ID_NONE
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

  return msgData;
}


function onNewDocument(win) {
  var chromeWin = UIUtils.getTopLevelWindow(win);
  if (UIUtils.isMainWindow(chromeWin) === false) {
    return;
  }

  var browser = UIUtils.getParentBrowser(win);
  if (browser === null) {
    return;
  }

  var msgData = populateWinData(win);
  msgData.from = "new-doc";

  if (m_src !== null) {
    // TODO sendSyncMessage=undefined ==> disabled extension or exception in the parent process
    if ((sendSyncMessageShim("${BASE_DOM_ID}-remote-msg", msgData, browser)[0]) !== null) {
      // TODO check if multifox should be disabled for this browser
      initDoc(win);
    }
    return;
  }

  // ask for source
  msgData["initBrowser"] = true; // TODO "init-tab"
  var rv = sendSyncMessageShim("${BASE_DOM_ID}-remote-msg", msgData, browser)[0];
  if (rv !== null) {
    startTab(rv);
    initDoc(win);
  }
}


function startTab(msgData) { // BUG it's being called by a non-tab browser
  m_src = msgData.src;
}


/*
function stopTab(src) {
  function forEachWindow(fn, win) {
    fn(win, src);
    for (var idx = win.length - 1; idx > -1; idx--) {
      forEachWindow(fn, win[idx]);
    }
  }

  forEachWindow(resetDoc, content);
  removeMessageListener("${BASE_DOM_ID}-parent-msg", onParentMessage);
  removeEventListener("DOMWindowCreated", onNewDocument, false);
  m_src = null;
  console.assert("initMultifox" in m_global, "stopTab fail m_global")
  var removed = delete m_global["initMultifox"];
  console.assert(removed, "stopTab fail")
  console.log("stopTab OK", getDOMUtils(content).currentInnerWindowID, content);
}
*/


function initDoc(win) {
  var sandbox = Cu.Sandbox(win, {wantXrays:false, wantComponents:false});
  sandbox.window   = XPCNativeWrapper.unwrap(win);
  sandbox.document = XPCNativeWrapper.unwrap(win.document);
  sandbox.sendCmd = function(obj) {
    return cmdContent(obj, win);
  };

  try {
    // window.localStorage will be replaced by a Proxy object.
    // It seems it's only possible using a sandbox.
    Cu.evalInSandbox(m_src, sandbox);
  } catch (ex) {
    var msgData = {
      from: "error",
      cmd:  "sandbox",
      err: ex.toString(),
      inner: getDOMUtils(win).currentInnerWindowID,
      url: win.location.href
    };
    sendAsyncMessageShim("${BASE_DOM_ID}-remote-msg", msgData, UIUtils.getParentBrowser(win));
  }
}

/*
function resetDoc(win, src) {
  var sandbox = Cu.Sandbox(win, {sandboxName: "${BASE_DOM_ID}-content-reset"});
  sandbox.window = XPCNativeWrapper.unwrap(win);
  sandbox.document = XPCNativeWrapper.unwrap(win.document);

  try {
    Cu.evalInSandbox(src, sandbox);
  } catch (ex) {
    var msgData = {
      from:    "error",
      cmd:     "sandbox",
      err:     ex.toString(),
      inner:   getDOMUtils(win).currentInnerWindowID,
      url:     win.location.href
    };
    msgData.topUrl = win !== win.top ? win.top.location.href : "";
    sendAsyncMessageShim("${BASE_DOM_ID}-remote-msg", msgData, UIUtils.getParentBrowser(win));
  }
}
*/


// cmd = localStorage, cookie, error
function cmdContent(obj, win) {
  var msgData = obj;
  msgData.inner = getDOMUtils(win).currentInnerWindowID;
  var remoteObj = sendSyncMessageShim("${BASE_DOM_ID}-remote-msg", msgData, UIUtils.getParentBrowser(win))[0];
  if (remoteObj !== null) {
    // send remote data to page (e.g. cookie value)
    return remoteObj.responseData;
  }
  return undefined;
}

/*
function onParentMessage(message) {
  try { // detect silent exceptions
    switch (message.json.msg) {
      case "disable-extension":
        stopTab(message.json.src);
        break;
      case "tab-data":
        startTab(message.json);
        break;
      default:
        throw new Error("onParentMessage " + message.json.msg);
    }
  } catch(ex) {
    console.error(ex);
  }
}
*/

function getDOMUtils(win) {
  console.assert(typeof win === "object", "win should be an object", win);
  return win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
}


// sendAsyncMessage() {
function sendAsyncMessageShim(messageName, msgData, parentBrowser) {
  parentBrowser.ownerDocument.defaultView.requestAnimationFrame(function() {
    sendSyncMessageShim(null, msgData, parentBrowser);
  });
}


// sendSyncMessage
function sendSyncMessageShim(messageName, msgData, parentBrowser) {
  m_rv = null; // setRemoteValue will update m_rv
  Services.obs.notifyObservers(parentBrowser, "${BASE_DOM_ID}-remote-msg", JSON.stringify(msgData));
  return [m_rv];
}


function setRemoteValue(rv) {
  console.assert(rv !== undefined, "undefined rv");
  m_rv = rv;
}


var m_rv;
var m_src = null;


var UIUtils = {

  isMainWindow: function(chromeWin) {
    return this._getWindowType(chromeWin) === "navigator:browser";
  },


  _getWindowType: function(chromeWin) {
    return chromeWin.document.documentElement.getAttribute("windowtype");
  },


  getTabList: function(chromeWin) {
    console.assert(this.isMainWindow(chromeWin), "Not a browser window", chromeWin);
    return chromeWin.gBrowser.tabs; // <tab> NodeList
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
    if (browser.localName === "browser") {
      return browser;
    }
    // e.g. <iframe> chrome://browser/content/devtools/cssruleview.xhtml
    console.log("not a browser element", browser.localName, win, win.parent);
    return null;
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
