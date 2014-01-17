/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


function InnerWindow(id, parent, outer, url) {
  console.assert(typeof id === "number", "InnerWindow invalid param id", id);
  console.assert(typeof parent === "number", "InnerWindow invalid param parent", parent);
  console.assert(typeof outer === "number", "InnerWindow invalid param outer", outer);
  console.assert(typeof url === "string", "InnerWindow invalid param url", url);

  this._id = id;
  this._parent = parent;
  this._outer = outer;

  this._uri = Services.io.newURI(url, null, null);
  this._tld = getTldFromUri(this._uri);

  //this._data = Object.create(null);
  //this._data["${CHROME_NAME}"] = Object.create(null);
}


InnerWindow.prototype = {
  _id: 0,
  _parent: 0,
  _outer: 0,
  _uri: null,
  _tld: null,

  _topId: -1,
  //_data: null,


  get innerId() {
    return this._id;
  },


  get eTld() {
    return this._tld;
  },

  // url may change due to pushState/fragment; origin never changes
  get originalUri() {
    return this._uri;
  },


  get parentId() {
    return this._parent;
  },


  get outerId() {
    return this._outer;
  },


  get isTop() {
    return this._parent === WinMap.TopWindowFlag;
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
    if (this._topId === -1) {
      this._topId = this._getTopInnerId(this._id);
      console.assert(this._topId > -1, "top id not found?");
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
    return {
      innerId:     this._id,
      topId:       this._topId,
      parentId:    this._parent,
      outerId:     this._outer,
      eTld:        this._tld,
      originalUri: this._uri.spec
    };
  }

};
