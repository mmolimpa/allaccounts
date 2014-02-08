/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


function InnerWindow(msgData) {
  console.assert(typeof msgData.inner === "number", "InnerWindow id invalid type", msgData.inner);
  console.assert(typeof msgData.parentInner === "number", "InnerWindow parent invalid type", msgData.parentInner);
  console.assert(typeof msgData.openerInnerId === "number", "InnerWindow opener invalid type", msgData.openerInnerId);
  console.assert(typeof msgData.outer === "number", "InnerWindow outer invalid type", msgData.outer);
  console.assert(typeof msgData.origin === "string", "InnerWindow origin invalid type", msgData.origin);
  console.assert(typeof msgData.url === "string", "InnerWindow url invalid type", msgData.url);

  console.assert(msgData.inner !== WindowUtils.WINDOW_ID_NONE, "InnerWindow id invalid value", msgData.inner);
  console.assert(msgData.outer !== WindowUtils.WINDOW_ID_NONE, "InnerWindow outer invalid value", msgData.outer);
  console.assert(msgData.url.length > 0, "empty url");

  if (msgData.origin.length === 0) {
    console.log("origin empty", this);
  }

  this._id = msgData.inner;
  this._parent = msgData.parentInner;
  this._opener = msgData.openerInnerId;
  this._outer = msgData.outer;

  this._uri = Services.io.newURI(msgData.url, null, null);
  this._tld = getTldFromUri(this._uri);
  this._origin = msgData.origin;

  //this._data = Object.create(null);
  //this._data["${CHROME_NAME}"] = Object.create(null);
}


InnerWindow.prototype = {
  _id:     WindowUtils.WINDOW_ID_NONE,
  _topId:  WindowUtils.WINDOW_ID_NONE,
  _parent: WindowUtils.WINDOW_ID_NONE,
  _opener: WindowUtils.WINDOW_ID_NONE,
  _outer:  WindowUtils.WINDOW_ID_NONE,
  _uri:    null,
  _tld:    null,
  _origin: null,

  //_data: null,


  get innerId() {
    return this._id;
  },


  get eTld() {
    return this._tld;
  },


  get origin() {
    return this._origin;
  },


  // url may change due to pushState/fragment; origin never changes
  get originalUri() {
    return this._uri;
  },


  get openerId() {
    return this._opener;
  },


  get parentId() {
    return this._parent;
  },


  get outerId() {
    return this._outer;
  },


  get isTop() {
    return this._parent === WindowUtils.WINDOW_ID_NONE;
  },


  // true even if it is inside a 3rd-party window
  get isFirstParty() {
    if (this.isTop) {
      return true;
    }
    var top = this.topWindow;
    var tld1 = this._tld;
    var tld2 = top.eTld;
    if ((tld1 !== null) && (tld2 !== null)) {
      return tld1 === tld2;
    }
    if ((tld1 === null) && (tld2 === null)) {
      // about:
      return this.originalUri.prePath === top.originalUri.prePath;
    }
    return false; // only one of them is null
  },


  get topWindow() {
    return WinMap.getInnerWindowFromId(this.topId);
  },


  get topId() {
    if (this._topId === WindowUtils.WINDOW_ID_NONE) {
      this._topId = this._getTopInnerId(this._id);
      console.assert(this._topId !== WindowUtils.WINDOW_ID_NONE, "top id not found?");
    }
    return this._topId;
  },


  _getTopInnerId: function(id) {
    var all = WinMap._inner;
    if ((id in all) === false) {
      WinMap._update();
    }
    console.assert(id in all, "_getTopInnerId not found", this);
    var win = all[id];
    if (!win) console.trace("win undefined");
    while (WinMap.isFrameId(win.parentId)) {
      id = win.parentId;
      win = all[id];
    }
    return id;
  },


  /*
  getData: function(appId) {
    console.assert(appId in this._data, "data not found", appId);
    return this._data[appId]; // "allaccounts"
  },*/


  toJSON: function() {
    var rv = {
      innerId: this._id,
      outerId: this._outer,
      url:     this._uri.spec,
      origin:  this._origin,
      eTld:    this._tld
    };
    if (this._id !== this._topId) {
      rv.topId = this._topId;
    }
    if (this._parent !== WindowUtils.WINDOW_ID_NONE) {
      rv.parentId = this._parent;
    }
    if (this._opener !== WindowUtils.WINDOW_ID_NONE) {
      rv.openerId = this._opener;
    }
    return rv;
  },


  toString: function() {
    return "[object InnerWindow]";
  }

};
