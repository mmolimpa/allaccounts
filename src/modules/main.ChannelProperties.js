/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://www.mozilla.org/MPL/2.0/. */


function ChannelProperties(httpChannel) {
  this._channel = Cu.getWeakReference(httpChannel);
  this._isWindow = this._isWindowChannel(httpChannel);

  var ctx = this._getLoadContext(httpChannel)
  if (ctx === null) {
    // CA, sync, favicon, update, wpad
    /*
    try {
      httpChannel.requestSucceeded;
      console.log("RESPONSE - context=null", httpChannel.URI);
    } catch (ex) {
      console.log("request  - context=null", httpChannel.URI);
    }*/
    return;
  }

  if (ctx.usePrivateBrowsing) {
    return;
  }

  var frame;
  try {
    frame = ctx.topFrameElement;
  } catch (ex) {
    frame = null;
  }

  var win;
  try{
    win = ctx.associatedWindow;
  } catch (ex) {
    win = null;
    // safebrowsing
    try {
      httpChannel.requestSucceeded;
      console.log("RESPONSE - associatedWindow error");
    } catch (ex) {
      console.log("request  - associatedWindow error");
    }
  }

  if (win === null) {
    var isResponse = true;
    try {
      httpChannel.requestSucceeded;
    } catch (ex) {
      isResponse = false;
    }
    console.log(isResponse ? "RESPONSE" : "request", "win=null",
                httpChannel.URI.prePath, ctx.isContent, ctx.isInBrowserElement, frame, ctx);
    return;
  }

  this._innerWindow = WinMap.getInnerWindowFromObj(win);

  if (this._innerWindow.isInsideTab === false) {
    try {
      httpChannel.requestSucceeded;
      console.log("RESPONSE - tab not found", httpChannel.URI, win, this._innerWindow);
    } catch (ex) {
      //console.log("request  - tab not found", httpChannel.URI, win);
    }
  }
}


ChannelProperties.prototype = {
  _innerWindow: null,
  _channel: null,
  _isWindow: false,

  _DOCUMENT_URI: Ci.nsIChannel.LOAD_DOCUMENT_URI,
  _isWindowChannel: function(channel) {
    // window/redir/download
    return (channel.loadFlags & this._DOCUMENT_URI) !== 0;
  },


  get underlyingChannel() {
    return this._channel.get();
  },


  get isWindow() {
    return this._isWindow;
  },


  get isTopLevelBrowsingContext() {
    return this._isWindow &&
           this._innerWindow.isTop &&
           this._innerWindow.isInsideTab;
  },


  get isFirstParty() {
    if (this.isTopLevelBrowsingContext) {
      // linkedWindow.originalUri must be ignored
      return true;
    }
    var tld = getTldFromHost(this.underlyingChannel.URI.host);
    return this.linkedWindow.topWindow.eTld === tld;
  },


  get linkedWindow() {
    return this._innerWindow;
  },


  _getLoadContext: function(channel) {
    if (channel.notificationCallbacks) {
      try {
        return channel.notificationCallbacks.getInterface(Ci.nsILoadContext);
      } catch (ex) {
        //console.trace("channel.notificationCallbacks " + "/" + channel.notificationCallbacks + "/" + channel.URI + "/" + ex);
      }
    }

    if (channel.loadGroup && channel.loadGroup.notificationCallbacks) {
      try {
        return channel.loadGroup.notificationCallbacks
                      .getInterface(Ci.nsILoadContext);
      } catch (ex) {
        console.trace("channel.loadGroup " + channel.loadGroup + "/" + channel.URI.spec + "/" + ex);
      }
    }

    //var isChrome = context.associatedWindow instanceof Ci.nsIDOMChromeWindow;
    //return context.isContent ? context.associatedWindow : null;
    //console.log("LOAD CONTEXT FAIL " + channel.URI);
    return null; // e.g. <link rel=prefetch> <link rel=next> ...
  },


  _visitLoop: {
    values: null,
    visitHeader: function(name, value) {
      var n = name.toLowerCase();
      if (n in this.values) {
        this.values[n] = value;
      }
    }
  },


  headersFromRequest: function() {
    var nameValues = {
      "cookie": null, // for debug only
      "authorization": null
    }
    this._visitLoop.values = nameValues;
    this._channel.get().visitRequestHeaders(this._visitLoop);
    return nameValues;
  },


  headersFromResponse: function() {
    var nameValues = {
      "set-cookie": null,
      "www-authenticate": null
    }
    this._visitLoop.values = nameValues;
    this._channel.get().visitResponseHeaders(this._visitLoop);
    return nameValues;
  }

};
