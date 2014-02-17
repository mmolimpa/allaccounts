/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


function ChannelProperties(httpChannel) {
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

  try{
    var win = ctx.associatedWindow;
  } catch (ex) {
    // safebrowsing
    try {
      httpChannel.requestSucceeded;
      console.log("RESPONSE - associatedWindow error", httpChannel.URI.prePath, ctx);
    } catch (ex) {
      console.log("request  - associatedWindow error", httpChannel.URI.prePath, ctx);
    }
    return;
  }

  if (win === null) {
    try {
      httpChannel.requestSucceeded;
      console.trace("RESPONSE - win=null", httpChannel.URI.prePath, ctx);
    } catch (ex) {
      console.log("request  - win=null", httpChannel.URI.prePath, ctx);
    }
    return;
  }

  this._innerId = getDOMUtils(win).currentInnerWindowID;
  this._innerWindow = WinMap.getInnerWindowFromId(this._innerId);

  if (this._innerWindow !== null) {
    this._type = this._isWindow(httpChannel) ? this.CHANNEL_CONTENT_WIN
                                             : this.CHANNEL_CONTENT_ASSET;
    return;
  }


  var chromeWin = UIUtils.getTopLevelWindow(win);
  if (chromeWin && UIUtils.isSourceWindow(chromeWin)) {
    this._type = this.CHANNEL_VIEW_SOURCE;
  } else {
    try {
      httpChannel.requestSucceeded;
      console.log("RESPONSE - tab not found", httpChannel.URI, win);
    } catch (ex) {
      //console.log("request  - tab not found", httpChannel.URI, win);
    }
  }
}


ChannelProperties.prototype = {
  _innerId: WindowUtils.WINDOW_ID_NONE,
  _innerWindow: null,
  _channel: null,

  _type: 0,
  CHANNEL_UNKNOWN: 0,
  CHANNEL_CONTENT_WIN: 1,
  CHANNEL_CONTENT_ASSET: 2,
  CHANNEL_VIEW_SOURCE: 3,


  _DOCUMENT_URI: Ci.nsIChannel.LOAD_DOCUMENT_URI,
  _isWindow: function(channel) {
    // window/redir/download
    return (channel.loadFlags & this._DOCUMENT_URI) !== 0;
  },


  get underlyingChannel() {
    return this._channel.get();
  },


  get channelType() {
    return this._type;
  },


  get isTopLevelBrowsingContext() {
    return (this.channelType === this.CHANNEL_CONTENT_WIN) &&
            this.linkedWindow.isTop;
  },


  get isFirstParty() {
    if (this.isTopLevelBrowsingContext) {
      // linkedWindow.originalUri must be ignored
      return true;
    }
    var tld = getTldFromHost(this.underlyingChannel.URI.host);
    return this.linkedWindow.topWindow.eTld === tld;
  },


  get linkedWindowId() {
    return this._innerId;
  },


  get linkedWindow() {
    return this._innerWindow;
  },


  _getLoadContext: function(channel) {
    this._channel = Cu.getWeakReference(channel);
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
