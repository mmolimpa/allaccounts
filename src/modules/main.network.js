/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


var NetworkObserver = {

  start: function() {
    var obs = Services.obs;
    obs.addObserver(this._request, "http-on-modify-request", false);
    obs.addObserver(this._response, "http-on-examine-response", false);
  },


  stop: function() {
    var obs = Services.obs;
    obs.removeObserver(this._request, "http-on-modify-request");
    obs.removeObserver(this._response, "http-on-examine-response");
  },


  _request: {
    // nsIObserver
    observe: function HttpListeners_request(subject, topic, data) {
      var httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
      var myChannel = new ChannelProperties(httpChannel);
      if (myChannel.linkedWindow === null) {
        var cookies = myChannel.headersFromRequest()["cookie"];
        if (cookies !== null) {
          //console.log("request  - no window + Cookie", httpChannel.URI, cookies);
        }
      }


      if (myChannel.channelType !== myChannel.CHANNEL_CONTENT_WIN) {
        var innerWin = myChannel.linkedWindow;
        if (innerWin && (innerWin.documentElementInserted === false) && innerWin.isInsideTab) {
          var win = Services.wm.getCurrentInnerWindowWithId(innerWin.innerId);
          if (win.location.href === "about:blank") {
            console.log("request resource about:blank", win, httpChannel.URI, innerWin);
            return;
          }
        }
      }



      var docUser = NetworkObserver._request._getUser(myChannel, httpChannel.URI);
      if (docUser === null) {
        return; // send default cookies
      }

      var userUri = httpChannel.URI.clone();
      userUri.host = docUser.wrapHost(userUri.host);
      var cookie = Cookies.getCookie(false, userUri);
      httpChannel.setRequestHeader("Cookie", cookie, false);
    },


    _getUser: function(myChannel, uri) {
      var docUser;

      switch (myChannel.channelType) {
        case myChannel.CHANNEL_CONTENT_ASSET:
          docUser = WinMap.getUserForAssetUri(myChannel.linkedWindow, uri);
          break;
        case myChannel.CHANNEL_CONTENT_WIN:
          docUser = NewDocUser.addWindowRequest(myChannel.linkedWindow, uri);
          break;
        case myChannel.CHANNEL_VIEW_SOURCE:
          console.log("REQUEST - viewsource", uri, myChannel.linkedWindow);
          return NewDocUser.viewSourceRequest(myChannel.linkedWindow.innerId, uri);
        default: // myChannel.CHANNEL_UNKNOWN
          // request from chrome (favicon, updates, <link rel="next"...)
          // safebrowsing, http://wpad/wpad.dat
          // private window
          return null;
      }

      if (docUser !== null) {
        // log to topData.thirdPartyUsers
        UserState.addRequest(uri, myChannel, docUser.findHostUser(getTldFromHost(uri.host)));
        return docUser;
      }

      // log to topData.thirdPartyUsers
      UserState.addRequest(uri, myChannel, null);
      return NetworkObserver._getAnonUser(myChannel);
    }
  },

  _response: {
    // nsIObserver
    observe: function HttpListeners_response(subject, topic, data) {
      var httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
      var myChannel = new ChannelProperties(httpChannel);
      if (myChannel.linkedWindow === null) {
        var setCookies2 = myChannel.headersFromResponse()["set-cookie"];
        if (setCookies2 !== null) {
          console.log("RESPONSE - no window + SetCookie", httpChannel.URI, setCookies2);
        }
      }
      var docUser = NetworkObserver._response._getUser(myChannel);
      if (docUser === null) {
        return; // set default cookies
      }

      var myHeaders = myChannel.headersFromResponse();
      var setCookies = myHeaders["set-cookie"];
      if (setCookies === null) {
        return null;
      }

      if (myHeaders["www-authenticate"] !== null) {
        // docUser + www-authenticate = not supported
        enableErrorMsgLocal("www-authenticate", win);
      }

      // remove "Set-Cookie"
      httpChannel.setResponseHeader("Set-Cookie", null, false);
      // save to a wrapped host
      Cookies.setCookie(docUser, httpChannel.URI, setCookies, false);
    },


    _getUser: function(myChannel) {
      var uri = myChannel.underlyingChannel.URI;
      var docUser;

      switch (myChannel.channelType) {
        case myChannel.CHANNEL_CONTENT_ASSET:
          docUser = WinMap.getUserForAssetUri(myChannel.linkedWindow, uri);
          break;
        case myChannel.CHANNEL_CONTENT_WIN:
          docUser = NewDocUser.addDocumentResponse(myChannel.underlyingChannel, myChannel.linkedWindow);
          break;
        case myChannel.CHANNEL_VIEW_SOURCE:
          throw new Error("_response => CHANNEL_VIEW_SOURCE");
        default:
          return null;
      }


      if (docUser !== null) {
        return docUser;
      }
      return NetworkObserver._getAnonUser(myChannel);
    }
  },


  _getAnonUser: function(myChannel) {
    var uri = myChannel.underlyingChannel.URI;
    if (LoginDB.isLoggedIn(StringEncoding.encode(getTldFromHost(uri.host)))) {
      console.log("channel err - login found but not used!", uri,
                  myChannel.channelType === myChannel.CHANNEL_CONTENT_WIN,
                  myChannel.linkedWindow.originalUri,
                  myChannel.linkedWindow.innerId);
    }

    if (myChannel.isFirstParty || myChannel.isTopLevelBrowsingContext) {
      return null;
    }
    return WinMap.getAsAnonUserUri(myChannel.linkedWindow.topWindow, uri, myChannel.channelType === myChannel.CHANNEL_CONTENT_WIN);
  }
};
