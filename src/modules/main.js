/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = ["Main"]; // bootstrap.js

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");


#include "console.js"
#include "main.util.js"
#include "main.UIUtils.js"
#include "main.window.js"
#include "main.network.js"
#include "main.ChannelProperties.js"
#include "main.script-source.js"
#include "main.ContentRelatedEvents.js"
#include "main.ChromeRelatedEvents.js"
#include "main.WinMap.js"
#include "main.InnerWindow.js"
#include "main.UserState.js"
#include "main.User.js"
#include "main.CrossTldLogin.js"
#include "main.logindb.js"
#include "main.utils-storage.js"
#include "main.login-submit.js"
#include "main.cookies.js"
#include "main.icon.js"


var m_remote = {};
var m_scriptSource = null;
var m_oldMoz = Services.vc.compare(Services.appinfo.platformVersion, "34.0a") < 0;


var Main = {
  _install: false,
  _timer: null,


  _lazyInit: function(timer) {
    Main._timer = null;
    var ss = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
    try {
      // BUG can attr be ever removed from session?
      ss.persistTabAttribute("${PERSIST_TAB_LOGINS}");
    } catch (ex) {
      console.error(ex);
    }
  },


  install: function() {
    try { // detect silent exceptions
      console.log("Main.install");
      this._install = true;
      var ns = util.loadSubScript("${PATH_MODULE}/maintenance.js");
      ns.install();
    } catch(ex) {
      console.error(ex);
    }
  },

  uninstall: function() {
    try { // detect silent exceptions
      console.log("Main.uninstall");
      var ns = util.loadSubScript("${PATH_MODULE}/maintenance.js");
      ns.uninstall();
    } catch(ex) {
      console.error(ex);
    }
  },

  startup: function(isAppStartup) {
    try { // detect silent exceptions
      this._startup(isAppStartup);
    } catch(ex) {
      console.error(ex);
    }
  },

  _startup: function(isAppStartup) {
    if (this._install) {
      // set localized description (install cannot read locale files)
      var desc = util.getTextFrom("about.properties", "extensions.${EXT_ID}.description");
      Services.prefs.getBranch("extensions.${EXT_ID}.").setCharPref("description", desc);
    }

    // persistTabAttribute would throw an exception if called now
    // resource:///modules/sessionstore/SessionStore.jsm :: ssi_writeFile
    this._timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this._timer.initWithCallback({notify: this._lazyInit}, 5000, Ci.nsITimer.TYPE_ONE_SHOT);

    Cu.import("${PATH_MODULE}/remote-browser.js", m_remote);
    StringEncoding.init();
    SubmitObserver.start();
    NetworkObserver.start();
    Cookies.start();
    LoginDB.init();
    ContentRelatedEvents.init();
    WindowWatcher.init();
    if (isAppStartup === false) {
      MainWindow.initAll();
    }

    LoginDB._ensureValid(); // BUG workaround to display welcome icon
  },

  shutdown: function() {
    try { // detect silent exceptions
      console.log("Main.shutdown");
      Cu.unload("${PATH_MODULE}/remote-browser.js");
      WindowWatcher.uninit();
      SubmitObserver.stop();
      NetworkObserver.stop();
      Cookies.stop();
      LoginDB.uninit();
      ContentRelatedEvents.uninit();
      MainWindow.uninitAll();
    } catch(ex) {
      console.error(ex);
    }
  }
};
