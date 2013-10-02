/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Add hooks to documents (cookie, localStorage, ...)

var DocOverlay = {
  _loader: null,

  init: function() {
    this._loader = new ScriptSourceLoader();
  },


  getInitBrowserData: function() {
    var me = this;
    return {
      src: me._loader.getScript()
    };
  }
};


function ScriptSourceLoader() { // TODO move to DocOverlay
  this._src = null;
  this._load(true);
}


ScriptSourceLoader.prototype = {
  getScript: function() {
    if (this._src === null) {
      this._load(false);
    }
    return this._src;
  },

  _load: function(async) {
    var me = this;
    var xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.onload = function() {
      me._src = xhr.responseText;
    };
    xhr.open("GET", "${PATH_CONTENT}/content-injection.js", async);
    xhr.overrideMimeType("text/plain");
    xhr.send(null);
  }
};
