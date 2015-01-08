/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */


function InnerWindow(msgData) {
  console.assert(typeof msgData.inner === "number", "InnerWindow id invalid type", msgData.inner);
  console.assert(typeof msgData.parentInner === "number", "InnerWindow parent invalid type", msgData.parentInner);
  console.assert(typeof msgData.openerInnerId === "number", "InnerWindow opener invalid type", msgData.openerInnerId);
  console.assert(typeof msgData.outer === "number", "InnerWindow outer invalid type", msgData.outer);
  console.assert(typeof msgData.topId === "number", "InnerWindow top invalid type", msgData.topId);

  console.assert(msgData.inner !== WindowUtils.WINDOW_ID_NONE, "InnerWindow id invalid value", msgData.inner);
  console.assert(msgData.outer !== WindowUtils.WINDOW_ID_NONE, "InnerWindow outer invalid value", msgData.outer);
  console.assert(msgData.topId !== WindowUtils.WINDOW_ID_NONE, "InnerWindow top invalid value", msgData.topId);

  console.assert((msgData.parentInner === WindowUtils.WINDOW_ID_NONE) ||
                 (msgData.parentInner !== msgData.inner), "parent=id", msgData);
  console.assert((msgData.openerInnerId === WindowUtils.WINDOW_ID_NONE) ||
                 (msgData.openerInnerId !== msgData.inner), "opener=id", msgData);
  console.assert((msgData.parentInner === WindowUtils.WINDOW_ID_NONE) ||
                 (msgData.parentInner !== msgData.openerInnerId), "parent=opener", msgData);


  this._id = msgData.inner;
  this._topId = msgData.topId;
  this._parent = msgData.parentInner;
  this._opener = msgData.openerInnerId;
  this._outer = msgData.outer;

  var topWin = this.topWindow;
  if (topWin !== null) {
    // cache the value
    this._isInsideTab = WinMap.getOuterEntry(topWin.outerId).isInsideTab;
  } else {
    this._isInsideTab = false;
    console.trace("topWin null", this);
  }

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
  _isInsideTab: true,

  //_data: null,


  get innerId() {
    return this._id;
  },


  setLocation: function(url, origin) {
    console.assert(typeof url === "string", "InnerWindow url invalid type", url);
    if (url.length === 0) {
      return;
    }

    this._origin = origin;
    this._uri = Services.io.newURI(url, null, null);
    this._tld = getTldFromUri(this._uri);
  },


  get documentElementInserted() {
    return this._uri !== null; // location has been defined
  },


  get eTld() {
    if (this.documentElementInserted) {
      return this._tld;
    }
    console.trace("eTld - documentElementInserted=false");
    throw new Error("eTld not defined", this.innerId);
  },


  get origin() {
    if (this.documentElementInserted) {
      return this._origin;
    }
    console.trace("origin - documentElementInserted=false");
    throw new Error("Origin not defined", this.innerId);
  },


  // url may change due to pushState/fragment; origin never changes
  get originalUri() {
    if (this.documentElementInserted) {
      return this._uri;
    }
    console.trace("originalUri - documentElementInserted=false");
    throw new Error("originalUri not defined", this.innerId);
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


  get isInsideTab() {
    return this._isInsideTab;
  },


  // true even if it is inside a 3rd-party window
  get isFirstParty() {
    if (this.isTop) {
      return true;
    }

    console.assert(this.documentElementInserted, "Location not defined", this);

    // TODO what about src="javascript:\"<html><body></body></html>\""?
    //                      data:text/html;charset=utf-8,<html>Hi</html>

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
    return this._topId === this._id
         ? this
         : WinMap.getInnerWindowFromId(this._topId);
  },


  /*
  getData: function(appId) {
    console.assert(appId in this._data, "data not found", appId);
    return this._data[appId]; // "allaccounts"
  },*/


  toJSON: function() {
    var rv = {};
    for (var p in this) {
      if (p === "_uri") {
        rv[p] = this._uri ? this._uri.spec : "null";
      } else {
        switch (p) {
          case "eTld":
          case "origin":
          case "originalUri":
          case "isFirstParty":
          case "topWindow":
            break;
          default:
            rv[p] = this[p];
        }
      }
    }
    return rv;
  },


  toString: function() {
    return "[object InnerWindow]";
  }

};
