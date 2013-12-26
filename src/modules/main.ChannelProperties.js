/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


function ChannelProperties(httpChannel) {
  var ctx = this._getLoadContext(httpChannel)
  if ((ctx === null) || ctx.usePrivateBrowsing) {
    // safebrowsing, http://wpad/wpad.dat
    return;
  }

  try{
    var win = ctx.associatedWindow;
  } catch (ex) {
    // background thumbnailing? [nsIException: [Exception...
    // "Component returned failure code: 0x8000ffff (NS_ERROR_UNEXPECTED)
    console.log("associatedWindow exception", httpChannel.URI.spec, ex);
    return;
  }

  if (win === null) {
    console.trace("request win=null", httpChannel.URI.spec);
    return;
  }

  this._win = Cu.getWeakReference(win);

  if (UIUtils.isContentWindow(win)) {
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
      console.log("response - tab not found", httpChannel.URI, win);
    } catch (ex) {
      console.log("request  - tab not found", httpChannel.URI, win);
    }
  }
}


ChannelProperties.prototype = {
  _win:  null,
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


  get channelType() {
    return this._type;
  },


  get linkedWindow() {
    return this._win === null ? null : this._win.get();
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

  /*
  headersFromRequest: function() {
    var nameValues = {
      //"cookie": null, //for debug only
      "authorization": null
    }
    this._visitLoop.values = nameValues;
    this._channel.get().visitRequestHeaders(this._visitLoop);
    return nameValues;
  },
  */

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
